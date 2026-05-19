import { MAX_STEPS } from "./config.js";
import { callOllama } from "./ollama.js";
import { runTool, toolDefinitions } from "./tools.js";
import type {
  AgentAction,
  AgentRunResult,
  FinalAction,
  OllamaCallResult,
  PromptLogEntry,
  ToolCallAction,
  ToolResultEnvelope,
  ChatMessage
} from "./types.js";

const PREVIEW_LIMIT = 220;

export class ModelResponseError extends Error {
  constructor(message: string, readonly rawResponse: string) {
    super(message);
    this.name = "ModelResponseError";
  }
}

interface AgentDependencies {
  readonly callModel: (messages: readonly ChatMessage[]) => Promise<OllamaCallResult>;
  readonly executeTool: (name: string, input: unknown) => Promise<unknown>;
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
    '{ "type": "tool_call", "tool": "tool_name", "input": { ... }, "reason": "short reason" }',
    '{ "type": "final", "message": "result for the user", "summary": ["short bullet", "short bullet"] }',
    "Available tools:",
    JSON.stringify(toolDefinitions, null, 2),
    "Rules:",
    "1. Use tools when you need to inspect or change files.",
    "2. Prefer creating apps under ./generated-apps.",
    "3. Keep file contents complete when using write_file.",
    "4. When the task is done, return type=final."
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function createModelResponseError(raw: string): ModelResponseError {
  return new ModelResponseError(`Model did not return valid JSON. Raw response: ${raw}`, raw);
}

function parseToolCallAction(value: Record<string, unknown>, raw: string): ToolCallAction {
  if (typeof value.tool !== "string" || value.tool.trim() === "") {
    throw new ModelResponseError(
      `Model returned an invalid tool_call payload. Raw response: ${raw}`,
      raw
    );
  }

  if (!isRecord(value.input)) {
    throw new ModelResponseError(
      `Model returned a tool_call without an object input. Raw response: ${raw}`,
      raw
    );
  }

  return {
    type: "tool_call",
    tool: value.tool,
    input: value.input,
    reason:
      typeof value.reason === "string" && value.reason.trim() !== ""
        ? value.reason
        : "No reason provided."
  };
}

function parseFinalAction(value: Record<string, unknown>, raw: string): FinalAction {
  if (typeof value.message !== "string") {
    throw new ModelResponseError(
      `Model returned a final payload without a message. Raw response: ${raw}`,
      raw
    );
  }

  if (value.summary !== undefined && !isStringArray(value.summary)) {
    throw new ModelResponseError(
      `Model returned a final payload with a non-string summary. Raw response: ${raw}`,
      raw
    );
  }

  return {
    type: "final",
    message: value.message,
    summary: value.summary ?? []
  };
}

export function parseJsonResponse(raw: string): AgentAction {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createModelResponseError(raw);
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new ModelResponseError(
      `Model returned an invalid action payload. Raw response: ${raw}`,
      raw
    );
  }

  if (parsed.type === "tool_call") {
    return parseToolCallAction(parsed, raw);
  }

  if (parsed.type === "final") {
    return parseFinalAction(parsed, raw);
  }

  throw new ModelResponseError(`Unexpected agent action type. Raw response: ${raw}`, raw);
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

export async function runAgent(
  userGoal: string,
  dependencies: Partial<AgentDependencies> = {}
): Promise<AgentRunResult> {
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

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const { content: raw, usage: stepUsage } = await resolvedDependencies.callModel(messages);
    const promptSummary = describeLatestRequest(messages);
    usage.totalInputTokens += stepUsage.inputTokens;
    usage.totalOutputTokens += stepUsage.outputTokens;

    const action = parseJsonResponse(raw);
    usage.prompts.push(createPromptLogEntry(step, promptSummary, raw, stepUsage, action));

    if (action.type === "final") {
      return {
        steps: step,
        final: action,
        usage
      };
    }

    let result: unknown;

    try {
      result = await resolvedDependencies.executeTool(action.tool, action.input);
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error)
      };
    }

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

  throw new Error(`Agent stopped after reaching MAX_STEPS=${MAX_STEPS}.`);
}
