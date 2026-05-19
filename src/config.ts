export const MODEL_NAME = "qwen3.5-9b-32k" as const;
export const OLLAMA_URL = "http://127.0.0.1:11434/api/chat" as const;
export const MAX_STEPS = 100 as const;
export const OUTPUT_ROOT = "generated-apps" as const;
export const USAGE_TEXT =
  'Usage: npm start -- "Create a simple calculator app in ./generated-apps/calculator"' as const;
