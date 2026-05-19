# Ollama Agentic Loop Walkthrough

This project is intentionally small so you can trace the full agent flow without framework noise.

## What this project does

It builds a basic coding agent in Node.js and TypeScript that:

- receives a user goal from the command line
- sends that goal plus tool definitions to an Ollama model
- forces the model to answer in JSON
- interprets the JSON as either:
  - a tool call
  - a final answer
- runs the requested tool
- feeds the tool result back to the model
- repeats until the model returns a final answer

That repeated think -> act -> observe -> think cycle is the core agentic loop.

## File map

### `src/index.ts`

This is the TypeScript CLI entry point.

Responsibilities:

- reads the user goal from the command line
- handles `--help`
- starts the agent
- prints the final result

The compiled runtime entry point is `dist/index.js`, which is what the npm scripts execute.

### `src/agent.ts`

This is the heart of the project.

Responsibilities:

- builds the system prompt
- keeps the conversation history
- calls the model
- parses model output
- runs tools
- sends tool results back into the conversation
- stops when the model returns a final answer

The important pattern is:

1. Ask the model what to do next.
2. If it asks for a tool, run the tool.
3. Give the tool result back to the model.
4. Repeat.

### `src/ollama.ts`

This file contains the raw Ollama API call.

It uses:

- `POST http://127.0.0.1:11434/api/chat`
- the model configured in `src/config.ts` such as `qwen3.5-9b-32k`
- `format: "json"` so the model is pushed toward valid JSON output

This keeps the Ollama integration isolated from the agent logic.

### `src/tools.ts`

This file defines the tool system.

There are two layers:

1. `toolDefinitions`
   These are shown to the model so it knows which tools exist.

2. `toolHandlers`
   These are the actual runtime functions that run on the machine.

Current tools:

- `list_files`
- `read_file`
- `write_file`
- `make_directory`

This is enough for a small code-writing agent to create a simple app like a calculator.

## Why this counts as tool calling

The model does not execute code directly. It only proposes an action in structured JSON, for example:

```json
{
  "type": "tool_call",
  "tool": "write_file",
  "input": {
    "path": "generated-apps/calculator/index.html",
    "content": "<html>...</html>"
  },
  "reason": "Create the calculator UI"
}
```

Your Node program decides whether to allow that tool, runs it, and returns the result.

That separation is the key idea behind tool calling:

- model decides
- runtime executes
- runtime returns observation

## Why the tools are restricted

The agent only writes inside the current project workspace, and it is nudged to use `./generated-apps`.

`generated-apps/` is treated as generated output, not maintained runtime source. The TypeScript migration excludes that folder from compilation, but the runtime still reads and writes there by default.

That matters because agentic systems become unsafe very quickly if they can write anywhere on disk or run arbitrary shell commands too early.

For learning, constrained tools are better than maximal power.

## How a calculator app would be created

If you run:

```bash
npm run example:calculator
```

The model will usually do some variation of this:

1. create `generated-apps/calculator`
2. write `index.html`
3. write `style.css`
4. write `script.js`
5. return a final message saying the app is complete

The exact sequence depends on model behavior, but the loop stays the same.

## Why this project does not use advanced function-calling frameworks

You asked for something useful for learning. Frameworks can hide the important mechanics.

This project keeps the core ideas visible:

- prompt design
- structured outputs
- tool registry
- action loop
- safety boundaries

Once this is clear, you can later compare it against:

- OpenAI tool calling
- LangChain agents
- AutoGen style loops
- shell/tool execution agents

## Limitations of this version

This is intentionally minimal, so it has some real limitations:

- it depends on the model returning valid JSON
- it has no schema validator beyond basic parsing
- it does not diff or patch files, it overwrites them
- it cannot run the created app automatically
- it only has filesystem tools
- it does not persist memory between runs

These limitations are useful because each one suggests a natural next step.

## Good next improvements

If you want to evolve this project, these are strong next additions:

1. Add JSON schema validation for tool inputs.
2. Add a `run_command` tool with strict allowlists.
3. Add a `replace_in_file` tool so the agent can edit large files more safely.
4. Expand the token usage logging into persistent step-by-step logs on disk.
5. Add a planning phase before tool use.
6. Add evaluation tasks to test whether the agent can reliably build simple apps.

## Prompt and token logging

This version now prints both token usage and a short per-step trace of what the model was working on.

It reads the counts from the Ollama chat response fields:

- `prompt_eval_count` for input tokens
- `eval_count` for output tokens

Flow:

1. `src/ollama.ts` returns both the model content and token usage metadata.
2. `src/agent.ts` accumulates usage for each loop step and records:
   - the latest request context sent into the model
   - the model response type
   - the tool name and reason when a tool is selected
   - a short preview of the JSON output
3. `src/index.ts` prints that step-by-step trace plus the overall token totals after completion.

This makes runs easier to inspect because you can now see not just how many tokens were used, but also what each prompt was about and what the model decided to output.

## How to run

Install dependencies first, then build the TypeScript sources.

Start Ollama separately so the local API is available, then run:

```bash
npm install
npm run build
npm start -- "Create a simple calculator app in ./generated-apps/calculator"
```

## Mental model to keep

An agent is not magic. In this project it is just:

- a model
- a loop
- tools
- memory of previous steps
- stopping conditions

That is the cleanest starting point for understanding agentic AI.
