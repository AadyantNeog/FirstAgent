export const MODEL_NAME = "qwen3.5-9b-32k" as const;
export const OLLAMA_URL = "http://127.0.0.1:11434/api/chat" as const;
export const MAX_STEPS = 100 as const;
export const OUTPUT_ROOT = "generated-apps" as const;
export const TRACE_ROOT = ".agent-runs" as const;
export const USAGE_TEXT =
  [
    'Usage: npm start -- [--trace] [--max-steps <number>] [--output-root <path>] "Create a simple calculator app in ./generated-apps/calculator"',
    "",
    "Options:",
    "  --trace                 Write a structured JSON trace under .agent-runs/",
    "  --max-steps <number>    Override the default agent loop limit",
    "  --output-root <path>    Change the default generated artifact root"
  ].join("\n");
