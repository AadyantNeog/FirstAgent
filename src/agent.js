import { MAX_STEPS } from "./config.js";
import { callOllama } from "./ollama.js";
import { runTool, toolDefinitions } from "./tools.js";

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

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const raw = await callOllama(messages);
    const action = parseJsonResponse(raw);

    if (action.type === "final") {
      return {
        steps: step,
        final: action
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
