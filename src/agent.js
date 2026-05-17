import { MAX_STEPS } from "./config.js";
import { callOllama } from "./ollama.js";
import { runTool, toolDefinitions } from "./tools.js";

const PREVIEW_LIMIT = 220;

function buildSystemPrompt() {
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

function parseJsonResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Model did not return valid JSON. Raw response: ${raw}`);
  }
}

function createPreview(value, maxLength = PREVIEW_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function describeLatestRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "No user prompt available.";
  }

  const content = latestUserMessage.content;

  try {
    const parsed = JSON.parse(content);

    if (parsed?.type === "tool_result") {
      return createPreview(
        `Tool result for ${parsed.tool}: ${JSON.stringify(parsed.result)}`
      );
    }
  } catch {
    return createPreview(content);
  }

  return createPreview(content);
}

export async function runAgent(userGoal) {
  const messages = [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    {
      role: "user",
      content: userGoal
    }
  ];
  const usage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    prompts: []
  };

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const { content: raw, usage: stepUsage } = await callOllama(messages);
    const promptSummary = describeLatestRequest(messages);
    usage.totalInputTokens += stepUsage.inputTokens;
    usage.totalOutputTokens += stepUsage.outputTokens;

    const action = parseJsonResponse(raw);
    const promptLog = {
      step,
      inputTokens: stepUsage.inputTokens,
      outputTokens: stepUsage.outputTokens,
      requested: promptSummary,
      responseType: action.type ?? "unknown",
      responsePreview: createPreview(raw)
    };

    if (action.type === "tool_call") {
      promptLog.tool = action.tool ?? "unknown";
      promptLog.reason = createPreview(action.reason || "No reason provided.");
      promptLog.toolInput = createPreview(JSON.stringify(action.input ?? {}));
    }

    if (action.type === "final") {
      promptLog.finalMessage = createPreview(action.message || "");
    }

    usage.prompts.push(promptLog);

    if (action.type === "final") {
      return {
        steps: step,
        final: action,
        usage
      };
    }

    if (action.type !== "tool_call" || !action.tool) {
      throw new Error(`Unexpected agent action: ${raw}`);
    }

    let result;

    try {
      result = await runTool(action.tool, action.input);
    } catch (error) {
      result = {
        error: error.message
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
      })
    });
  }

  throw new Error(`Agent stopped after reaching MAX_STEPS=${MAX_STEPS}.`);
}
