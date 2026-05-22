# Ollama Agentic Loop Walkthrough

This project is intentionally small so you can trace the full agent flow without framework noise.

## What this project does

It builds a basic coding agent in Node.js and TypeScript that:

- receives a user goal from the command line
- sends that goal plus tool definitions to an Ollama model
- forces the model to answer in JSON
- interprets the JSON as either:
  - a plan
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
- validates model output with `zod`
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
- `replace_in_file`
- `make_directory`
- `run_command`

This is enough for a small code-writing agent to create a simple app like a calculator.

`run_command` is intentionally allowlisted. It can run project commands such as `npm run build` and `npm test`, but it does not provide unrestricted shell access.

## Why this counts as tool calling

The model does not execute code directly. It only proposes an action in structured JSON, for example:

```json
{
  "type": "plan",
  "steps": ["Inspect the app folder", "Write the HTML, CSS, and JavaScript"]
}
```

or:

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

This is intentionally minimal, so it still has some real limitations:

- it depends on the model returning JSON
- it validates JSON shapes with `zod`, but does not use a full formal protocol
- it can do exact text replacement, but not general patch application
- it cannot run the created app automatically
- it only allows a small set of shell commands
- it does not persist memory between runs

These limitations are useful because each one suggests a natural next step.

## Good next improvements

If you want to evolve this project, these are strong next additions:

1. Add a browser preview tool so the agent can visually inspect generated apps.
2. Add a patch-style editing tool for multi-line changes.
3. Add better evaluation fixtures for known app-building tasks.
4. Add model/config selection from the CLI.
5. Add persistent memory for repeated project work.

## Prompt and token logging

This version prints token usage, a short per-step console trace, and can optionally write a structured JSON trace file.

It reads the counts from the Ollama chat response fields:

- `prompt_eval_count` for input tokens
- `eval_count` for output tokens

Flow:

1. `src/ollama.ts` returns both the model content and token usage metadata.
2. `src/agent.ts` accumulates usage for each loop step and records:
   - the latest request context sent into the model
   - the model response type
   - plan steps when the model returns a plan
   - the tool name and reason when a tool is selected
   - a short preview of the JSON output
3. `src/index.ts` prints that step-by-step trace plus the overall token totals after completion.

This makes runs easier to inspect because you can now see not just how many tokens were used, but also what each prompt was about and what the model decided to output.

To write a full trace file under `.agent-runs/`, add `--trace`:

```bash
npm start -- --trace "Create a simple calculator app in ./generated-apps/calculator"
```

## How to run

Install dependencies first, then build the TypeScript sources.

Start Ollama separately so the local API is available, then run:

```bash
npm install
npm run build
npm start -- "Create a simple calculator app in ./generated-apps/calculator"
```

Useful CLI options:

```bash
npm start -- --trace "Create a simple app"
npm start -- --max-steps 20 "Create a simple app"
npm start -- --output-root generated-apps/custom "Create a simple app"
```

## Mental model to keep

An agent is not magic. In this project it is just:

- a model
- a loop
- tools
- memory of previous steps
- stopping conditions

That is the cleanest starting point for understanding agentic AI.
