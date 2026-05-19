import { MODEL_NAME, OLLAMA_URL } from "./config.js";
import type { ChatMessage, OllamaCallResult } from "./types.js";

interface OllamaApiResponse {
  readonly message?: {
    readonly content?: unknown;
  };
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
}

function asTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function callOllama(
  messages: readonly ChatMessage[]
): Promise<OllamaCallResult> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      stream: false,
      format: "json",
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OllamaApiResponse;
  const content = data.message?.content;
  const usage = {
    inputTokens: asTokenCount(data.prompt_eval_count),
    outputTokens: asTokenCount(data.eval_count)
  };

  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Ollama response did not include message content.");
  }

  return {
    content,
    usage
  };
}
