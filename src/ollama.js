import { MODEL_NAME, OLLAMA_URL } from "./config.js";

export async function callOllama(messages) {
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

  const data = await response.json();
  const content = data?.message?.content;

  if (!content) {
    throw new Error("Ollama response did not include message content.");
  }

  return content;
}
