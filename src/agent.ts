import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MAX_STEPS, OUTPUT_ROOT, TRACE_ROOT } from "./config.js";
import { callOllama } from "./ollama.js";
import { runTool, toolDefinitions } from "./tools.js";
import type {
  AgentAction,
  AgentRunOptions,
  AgentRunResult,
  AgentTrace,
  ChatMessage,
  FinalAction,
  OllamaCallResult,
  PlanAction,
  PromptLogEntry,
  ToolCallAction,
  ToolResultEnvelope,
  ToolRunOptions
} from "./types.js";

const PREVIEW_LIMIT = 220;

const toolCallActionSchema = z
  .object({
    type: z.literal("tool_call"),
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().optional()
  })
  .transform(
    (value): ToolCallAction => ({
      type: "tool_call",
      tool: value.tool,
      input: value.input,
      reason:
        typeof value.reason === "string" && value.reason.trim() !== ""
          ? value.reason
          : "No reason provided."
    })
  );

const planActionSchema = z
  .object({
    type: z.literal("plan"),
    steps: z.array(z.string()).min(1),
    message: z.string().optional()
  })
  .transform(
    (value): PlanAction => ({
      type: "plan",
      steps: value.steps,
      message: value.message
    })
  );

const finalActionSchema = z
  .object({
    type: z.literal("final"),
    message: z.string(),
    summary: z.array(z.string()).default([])
  })
  .transform(
    (value): FinalAction => ({
      type: "final",
      message: value.message,
      summary: value.summary
    })
  );

const agentActionSchema = z.union([
  toolCallActionSchema,
  planActionSchema,
  finalActionSchema
]);

export class ModelResponseError extends Error {
  constructor(message: string, readonly rawResponse: string) {
    super(message);
    this.name = "ModelResponseError";
  }
}

interface AgentDependencies {
  readonly callModel: (messages: readonly ChatMessage[]) => Promise<OllamaCallResult>;
  readonly executeTool: (
    name: string,
    input: unknown,
    options: ToolRunOptions
  ) => Promise<unknown>;
}

const defaultDependencies: AgentDependencies = {
  callModel: callOllama,
  executeTool: runTool
};

function buildSystemPrompt(): string {
  return [
    "You are a local coding agent that can inspect files and create small apps.",
    "You must always respond with strict JSON and nothing else.",
    "Choose exactly one of these shapes:",
    '{ "type": "plan", "steps": ["short step", "short step"], "message": "optional short note" }',
    '{ "type": "tool_call", "tool": "tool_name", "input": { ... }, "reason": "short reason" }',
    '{ "type": "final", "message": "result for the user", "summary": ["short bullet", "short bullet"] }',
    "Available tools:",
    JSON.stringify(toolDefinitions, null, 2),
    "Rules:",
    "1. Use tools when you need to inspect or change files.",
    "2. Prefer creating apps under ./generated-apps unless the user requested another output root.",
    "3. Use replace_in_file for small edits to existing files.",
    "4. Use run_command only for allowlisted verification commands.",
    "5. Keep file contents complete when using write_file.",
    "6. When the task is done, return type=final."
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("; ");
}

function createModelResponseError(raw: string): ModelResponseError {
  return new ModelResponseError(`Model did not return valid JSON. Raw response: ${raw}`, raw);
}

export function parseJsonResponse(raw: string): AgentAction {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createModelResponseError(raw);
  }

  const result = agentActionSchema.safeParse(parsed);

  if (!result.success) {
    throw new ModelResponseError(
      `Model returned an invalid action payload: ${formatZodError(result.error)}. Raw response: ${raw}`,
      raw
    );
  }

  return result.data;
}

function createPreview(value: unknown, maxLength = PREVIEW_LIMIT): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function describeLatestRequest(messages: readonly ChatMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "No user prompt available.";
  }

  const content = latestUserMessage.content;

  try {
    const parsed = JSON.parse(content) as unknown;

    if (
      isRecord(parsed) &&
      parsed.type === "tool_result" &&
      typeof parsed.tool === "string" &&
      "result" in parsed
    ) {
      const envelope: ToolResultEnvelope = {
        type: "tool_result",
        tool: parsed.tool,
        result: parsed.result
      };
      return createPreview(`Tool result for ${envelope.tool}: ${JSON.stringify(envelope.result)}`);
    }
  } catch {
    return createPreview(content);
  }

  return createPreview(content);
}

function createPromptLogEntry(
  step: number,
  requested: string,
  raw: string,
  usage: OllamaCallResult["usage"],
  action: AgentAction
): PromptLogEntry {
  const promptLog: PromptLogEntry = {
    step,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    requested,
    responseType: action.type,
    responsePreview: createPreview(raw)
  };

  if (action.type === "plan") {
    promptLog.planSteps = action.steps;
    promptLog.planMessage = action.message;
  }

  if (action.type === "tool_call") {
    promptLog.tool = action.tool;
    promptLog.reason = createPreview(action.reason);
    promptLog.toolInput = createPreview(JSON.stringify(action.input));
  }

  if (action.type === "final") {
    promptLog.finalMessage = createPreview(action.message);
  }

  return promptLog;
}

function normalizeRunOptions(options: AgentRunOptions): Required<AgentRunOptions> {
  return {
    maxSteps: options.maxSteps ?? MAX_STEPS,
    trace: options.trace ?? false,
    traceDirectory: options.traceDirectory ?? TRACE_ROOT,
    outputRoot: options.outputRoot ?? OUTPUT_ROOT
  };
}

function createTrace(goal: string, options: Required<AgentRunOptions>): AgentTrace {
  return {
    goal,
    startedAt: new Date().toISOString(),
    maxSteps: options.maxSteps,
    outputRoot: options.outputRoot,
    steps: [],
    usage: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      prompts: []
    }
  };
}

async function writeTrace(trace: AgentTrace, traceDirectory: string): Promise<string> {
  const resolvedDirectory = path.resolve(process.cwd(), traceDirectory);
  const timestamp = trace.startedAt.replace(/[:.]/g, "-");
  const tracePath = path.join(resolvedDirectory, `agent-run-${timestamp}.json`);

  await fs.mkdir(resolvedDirectory, { recursive: true });
  await fs.writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  return tracePath;
}

export async function runAgent(
  userGoal: string,
  dependencies: Partial<AgentDependencies> = {},
  options: AgentRunOptions = {}
): Promise<AgentRunResult> {
  const resolvedOptions = normalizeRunOptions(options);
  const resolvedDependencies: AgentDependencies = {
    ...defaultDependencies,
    ...dependencies
  };

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    {
      role: "user",
      content: userGoal
    }
  ];

  const usage: AgentRunResult["usage"] = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    prompts: []
  };
  const trace = resolvedOptions.trace ? createTrace(userGoal, resolvedOptions) : undefined;

  try {
    for (let step = 1; step <= resolvedOptions.maxSteps; step += 1) {
      const { content: raw, usage: stepUsage } = await resolvedDependencies.callModel(messages);
      const promptSummary = describeLatestRequest(messages);
      usage.totalInputTokens += stepUsage.inputTokens;
      usage.totalOutputTokens += stepUsage.outputTokens;

      const action = parseJsonResponse(raw);
      const promptLog = createPromptLogEntry(step, promptSummary, raw, stepUsage, action);
      usage.prompts.push(promptLog);

      if (action.type === "plan") {
        trace?.steps.push({
          step,
          requested: promptSummary,
          rawResponse: raw,
          action,
          usage: stepUsage
        });
        messages.push({
          role: "assistant",
          content: raw
        });
        messages.push({
          role: "user",
          content:
            "Plan received. Continue by choosing the next required tool_call, or return final if no tools are needed."
        });
        continue;
      }

      if (action.type === "final") {
        trace?.steps.push({
          step,
          requested: promptSummary,
          rawResponse: raw,
          action,
          usage: stepUsage
        });
        const finalTrace = trace
          ? {
              ...trace,
              completedAt: new Date().toISOString(),
              final: action,
              usage
            }
          : undefined;
        const tracePath = finalTrace
          ? await writeTrace(finalTrace, resolvedOptions.traceDirectory)
          : undefined;

        return {
          steps: step,
          final: action,
          tracePath,
          usage
        };
      }

      let result: unknown;

      try {
        result = await resolvedDependencies.executeTool(action.tool, action.input, {
          outputRoot: resolvedOptions.outputRoot
        });
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : String(error)
        };
      }

      trace?.steps.push({
        step,
        requested: promptSummary,
        rawResponse: raw,
        action,
        toolResult: result,
        usage: stepUsage
      });

      messages.push({
        role: "assistant",
        content: raw
      });

      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "tool_result",
          tool: action.tool,
          result
        } satisfies ToolResultEnvelope)
      });
    }

    throw new Error(`Agent stopped after reaching MAX_STEPS=${resolvedOptions.maxSteps}.`);
  } catch (error) {
    if (trace) {
      const failedTrace: AgentTrace = {
        ...trace,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        usage
      };
      await writeTrace(failedTrace, resolvedOptions.traceDirectory);
    }

    throw error;
  }
}
