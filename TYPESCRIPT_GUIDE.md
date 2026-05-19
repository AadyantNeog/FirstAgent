# TypeScript Guide for This Agent Runtime

This document explains the TypeScript parts of this project. It is meant to be read alongside the code, especially `src/types.ts`, `src/agent.ts`, `src/tools.ts`, `src/index.ts`, and `tsconfig.json`.

The project is still a normal Node app at runtime. TypeScript is used during development to catch mistakes before the code is compiled into JavaScript under `dist/`.

## 1. How TypeScript Fits Into This Project

The source code now lives in `src/**/*.ts`.

The compiled JavaScript lives in `dist/**/*.js`.

The important scripts are:

```json
{
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "test": "npm run build && node --test test/**/*.test.js"
}
```

That means:

1. You edit TypeScript in `src/`.
2. You run `npm run build`.
3. TypeScript checks the code and emits JavaScript into `dist/`.
4. Node runs the compiled JavaScript from `dist/`.

This project does not use a TypeScript runtime loader. That is intentional: the build step is explicit, so you can clearly see the difference between source code and runtime output.

## 2. The Compiler Config

The TypeScript compiler is configured in `tsconfig.json`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noEmitOnError": true,
    "types": ["node"]
  }
}
```

Key settings:

- `target: "ES2022"` tells TypeScript to output modern JavaScript.
- `module: "NodeNext"` tells TypeScript to follow Node's modern ESM rules.
- `moduleResolution: "NodeNext"` makes imports resolve the same way Node expects.
- `rootDir: "src"` says TypeScript source files start in `src/`.
- `outDir: "dist"` says compiled JavaScript goes into `dist/`.
- `strict: true` enables the important safety checks.
- `noEmitOnError: true` prevents broken JavaScript from being emitted when type errors exist.
- `types: ["node"]` loads Node-specific types like `process`, `Buffer`, and `node:fs/promises`.

The project excludes `generated-apps/` because that folder is output created by the agent, not maintained TypeScript source.

## 3. Why Imports Use `.js` Inside `.ts` Files

You will see imports like this:

```ts
import { runAgent } from "./agent.js";
```

Even though the source file is `agent.ts`, the import uses `.js`.

That looks strange at first, but it is correct for Node ESM with `module: "NodeNext"`. At runtime, Node executes `dist/index.js`, and that file really imports `dist/agent.js`.

TypeScript understands this mapping:

```ts
// source file
src/index.ts imports ./agent.js

// compiled runtime file
dist/index.js imports ./agent.js
```

So the rule for this project is: local ESM imports in TypeScript should use the `.js` extension.

## 4. `src/types.ts`: The Project's Type Vocabulary

Most shared shapes are defined in `src/types.ts`.

Example:

```ts
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}
```

This says every chat message has:

- `role`, which must be exactly one of `"system"`, `"user"`, or `"assistant"`
- `content`, which must be a string

The type `"system" | "user" | "assistant"` is a union of string literals. It is stricter than `string`.

This would compile:

```ts
const message: ChatMessage = {
  role: "user",
  content: "Build a calculator"
};
```

This would fail:

```ts
const message: ChatMessage = {
  role: "developer",
  content: "Build a calculator"
};
```

`"developer"` is a string, but it is not one of the allowed role values.

## 5. `interface` vs `type`

This project uses both.

`interface` is used for object shapes:

```ts
export interface OllamaUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}
```

`type` is used when combining types:

```ts
export type AgentAction = ToolCallAction | FinalAction;
```

That means an `AgentAction` is either a `ToolCallAction` or a `FinalAction`.

A practical rule:

- Use `interface` for named object shapes.
- Use `type` for unions, aliases, and computed type expressions.

## 6. Discriminated Unions

The agent expects the model to return one of two JSON shapes:

```ts
export interface ToolCallAction {
  readonly type: "tool_call";
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly reason: string;
}

export interface FinalAction {
  readonly type: "final";
  readonly message: string;
  readonly summary: string[];
}

export type AgentAction = ToolCallAction | FinalAction;
```

The `type` field is the discriminator. TypeScript uses it to narrow the union.

In `src/agent.ts`:

```ts
if (action.type === "final") {
  return {
    steps: step,
    final: action,
    usage
  };
}
```

Inside that `if` block, TypeScript knows `action` is a `FinalAction`, so `action.message` and `action.summary` are safe to use.

Later, after the final case has returned, TypeScript understands that the remaining action must be a `ToolCallAction`.

This is one of the most useful TypeScript patterns in the project.

## 7. Why `unknown` Is Used for Unsafe Data

Data from these places is not trustworthy:

- model output
- JSON parsing
- tool input
- network responses

So the code often starts with `unknown`.

Example from `src/agent.ts`:

```ts
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
}
```

`unknown` means: "We have a value, but TypeScript will not let us use it until we prove what it is."

This is safer than `any`.

With `any`, TypeScript lets you do anything:

```ts
const parsed: any = JSON.parse(raw);
parsed.this.does.not.exist();
```

With `unknown`, TypeScript forces you to check first:

```ts
const parsed: unknown = JSON.parse(raw);

if (typeof parsed === "object" && parsed !== null) {
  // Now we know it is object-like.
}
```

Use `unknown` at system boundaries. Convert it into trusted application types with validation.

## 8. Type Guards

A type guard is a function that checks a value at runtime and teaches TypeScript about the result.

In `src/agent.ts`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

The return type is special:

```ts
value is Record<string, unknown>
```

That means: if this function returns `true`, TypeScript should treat `value` as a record-like object.

Example:

```ts
const parsed: unknown = JSON.parse(raw);

if (isRecord(parsed)) {
  parsed.type;
}
```

Without the guard, TypeScript would not allow `parsed.type`, because `parsed` might be a number, string, null, or array.

## 9. `Record<string, unknown>`

This type appears in a few places:

```ts
Record<string, unknown>
```

It means an object with string keys and unknown values.

For example:

```ts
const input: Record<string, unknown> = {
  path: "generated-apps/snake-game",
  content: "<html></html>"
};
```

It does not say that `path` is definitely a string. It says only that `path` may exist, and if it does, its value is currently unknown.

That is why `src/tools.ts` has helpers like:

```ts
function getRequiredString(value: unknown, propertyName: string): string {
  const parsed = getOptionalString(value, propertyName);

  if (parsed === undefined) {
    throw new Error(`Tool input "${propertyName}" is required.`);
  }

  return parsed;
}
```

The runtime validates the unknown value. After validation, TypeScript knows the result is a `string`.

## 10. Optional Properties

In `src/types.ts`:

```ts
export interface PromptLogEntry {
  readonly step: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requested: string;
  readonly responseType: AgentAction["type"];
  readonly responsePreview: string;
  tool?: string;
  reason?: string;
  toolInput?: string;
  finalMessage?: string;
}
```

The `?` means the property is optional.

This makes sense because:

- tool calls have `tool`, `reason`, and `toolInput`
- final responses have `finalMessage`
- every log entry does not have every field

Optional properties are common when modeling data that changes shape depending on context.

## 11. Indexed Access Types

This line is worth understanding:

```ts
readonly responseType: AgentAction["type"];
```

`AgentAction["type"]` means: get the type of the `type` property from `AgentAction`.

Since `AgentAction` is:

```ts
ToolCallAction | FinalAction
```

and their `type` fields are:

```ts
"tool_call" | "final"
```

then `AgentAction["type"]` becomes:

```ts
"tool_call" | "final"
```

The benefit is that `PromptLogEntry` stays connected to `AgentAction`. If a third action type is added later, the log type updates automatically.

## 12. `readonly`

Many interfaces use `readonly`:

```ts
export interface OllamaUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}
```

This means TypeScript will prevent reassignment of those properties:

```ts
const usage: OllamaUsage = {
  inputTokens: 10,
  outputTokens: 5
};

usage.inputTokens = 12; // TypeScript error
```

`readonly` is a compile-time rule. It does not freeze objects at runtime. It helps communicate intent: once this object is created, code should not mutate that property.

## 13. Async Return Types and `Promise<T>`

Async functions return promises.

In `src/ollama.ts`:

```ts
export async function callOllama(
  messages: readonly ChatMessage[]
): Promise<OllamaCallResult> {
  // ...
}
```

This says:

- the function receives an array of `ChatMessage`
- callers should not mutate that array through this parameter
- the function eventually resolves to an `OllamaCallResult`

Because it is `async`, the return type must be `Promise<OllamaCallResult>`, not just `OllamaCallResult`.

## 14. `Partial<T>` for Dependency Injection

`runAgent` accepts optional dependencies:

```ts
export async function runAgent(
  userGoal: string,
  dependencies: Partial<AgentDependencies> = {}
): Promise<AgentRunResult> {
  const resolvedDependencies: AgentDependencies = {
    ...defaultDependencies,
    ...dependencies
  };
}
```

`AgentDependencies` is:

```ts
interface AgentDependencies {
  readonly callModel: (messages: readonly ChatMessage[]) => Promise<OllamaCallResult>;
  readonly executeTool: (name: string, input: unknown) => Promise<unknown>;
}
```

`Partial<AgentDependencies>` means every property from `AgentDependencies` becomes optional.

So tests can pass only the dependency they need to replace:

```ts
await runAgent("goal", {
  async callModel(messages) {
    return fakeModelResponse;
  }
});
```

The runtime fills in missing dependencies from `defaultDependencies`.

This is a common TypeScript testing pattern.

## 15. The Tool Registry and `satisfies`

The most advanced type in the project is in `src/tools.ts`:

```ts
const toolRegistry = {
  list_files: {
    definition: { ... },
    parseInput: parseListFilesInput,
    handler: listFiles
  },
  read_file: {
    definition: { ... },
    parseInput: parseReadFileInput,
    handler: readFile
  }
} satisfies {
  [Name in ToolName]: {
    readonly definition: ToolDefinition<Name>;
    readonly parseInput: (input: unknown) => ToolInputByName[Name];
    readonly handler: (input: ToolInputByName[Name]) => Promise<ToolResultByName[Name]>;
  };
};
```

There are two important ideas here.

First, `[Name in ToolName]` is a mapped type. It says: for every valid tool name, the registry must have a matching entry.

`ToolName` comes from:

```ts
export type ToolName = keyof ToolInputByName;
```

So if `ToolInputByName` has these keys:

```ts
list_files
read_file
write_file
make_directory
```

then `toolRegistry` must also have exactly those tool entries.

Second, `satisfies` checks that the object matches the required shape without erasing the specific details of the object.

That means TypeScript can catch mistakes like:

- adding a tool input type but forgetting the handler
- giving a tool definition the wrong name
- wiring a handler to the wrong input type
- returning the wrong result shape from a tool handler

This is the main place where TypeScript prevents the tool definitions and executable handlers from drifting apart.

## 16. Why `runTool` Uses a `switch`

The runtime receives a tool name as a plain string:

```ts
export async function runTool(name: string, input: unknown): Promise<unknown>
```

That is because model output is dynamic. The model might ask for `"write_file"`, or it might ask for a tool that does not exist.

The function first checks whether the tool exists:

```ts
if (!Object.hasOwn(toolRegistry, name)) {
  throw new Error(`Unknown tool: ${name}`);
}
```

Then it dispatches with a `switch`:

```ts
switch (name as ToolName) {
  case "list_files":
    return toolRegistry.list_files.handler(toolRegistry.list_files.parseInput(input));
}
```

The `switch` is a little more verbose than dynamic indexing, but it keeps each handler connected to its exact input parser. This makes the compiler happier under `strict: true`.

## 17. CLI Types in `src/index.ts`

The CLI parser uses another discriminated union:

```ts
export type CliParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly goal: string }
  | { readonly kind: "error"; readonly message: string };
```

This models the three possible outcomes:

- user asked for help
- user provided a goal
- user forgot the goal

Then `main` narrows the result:

```ts
const parsed = parseCliArgs(argv);

if (parsed.kind === "help") {
  console.log(USAGE_TEXT);
  return 0;
}

if (parsed.kind === "error") {
  console.error(parsed.message);
  return 1;
}

console.log(`Goal: ${parsed.goal}`);
```

By the time the code reaches `parsed.goal`, TypeScript knows `parsed.kind` must be `"run"`.

This avoids optional fields like:

```ts
{
  help?: boolean;
  error?: string;
  goal?: string;
}
```

That shape is weaker because TypeScript cannot easily know which fields are valid together.

## 18. Custom Error Classes

In `src/agent.ts`:

```ts
export class ModelResponseError extends Error {
  constructor(message: string, readonly rawResponse: string) {
    super(message);
    this.name = "ModelResponseError";
  }
}
```

This creates a specific error type for invalid model responses.

It also stores the raw model response:

```ts
readonly rawResponse: string
```

Tests can assert this exact error type:

```js
assert.throws(() => parseJsonResponse("{"), ModelResponseError);
```

Custom error classes are useful when the caller should be able to distinguish one failure category from another.

## 19. Type-Only Imports

Some imports use `import type`:

```ts
import type {
  AgentAction,
  AgentRunResult,
  ChatMessage
} from "./types.js";
```

`import type` means these imports are only needed by TypeScript. They disappear from the compiled JavaScript.

Use `import type` when importing interfaces, type aliases, and other compile-time-only names.

Use normal `import` when importing runtime values like functions, constants, and classes.

Examples:

```ts
import { runTool } from "./tools.js";      // runtime value
import type { ToolName } from "./types.js"; // compile-time type
```

This matters more in ESM projects because TypeScript is careful about what exists at runtime.

## 20. `as const`

In `src/config.ts`:

```ts
export const MODEL_NAME = "qwen3.5-9b-32k" as const;
```

Without `as const`, TypeScript would infer:

```ts
string
```

With `as const`, TypeScript infers the exact literal type:

```ts
"qwen3.5-9b-32k"
```

For config constants, this communicates that the value is intentionally fixed.

## 21. `satisfies` in JSON Stringification

In `src/agent.ts`:

```ts
messages.push({
  role: "user",
  content: JSON.stringify({
    type: "tool_result",
    tool: action.tool,
    result
  } satisfies ToolResultEnvelope)
});
```

The `satisfies ToolResultEnvelope` part asks TypeScript to verify that the object has the shape expected for tool result messages.

If you accidentally wrote:

```ts
{
  type: "tool_result",
  toolName: action.tool,
  result
}
```

TypeScript would catch the missing `tool` property.

The runtime output is still just normal JSON.

## 22. Runtime Validation vs TypeScript Types

This is one of the most important lessons:

TypeScript checks your source code. It does not validate random runtime data automatically.

This compiles:

```ts
const data = await response.json() as OllamaApiResponse;
```

But the `as OllamaApiResponse` part does not prove the server really returned that shape. It only tells TypeScript to treat the value that way.

That is why `src/ollama.ts` still checks:

```ts
if (typeof content !== "string" || content.length === 0) {
  throw new Error("Ollama response did not include message content.");
}
```

TypeScript and runtime validation solve different problems:

- TypeScript catches mistakes in your code before running it.
- Runtime checks protect you from external data that may be malformed.

## 23. How to Read the Project in Order

For learning, read the TypeScript files in this order:

1. `src/types.ts`
2. `src/config.ts`
3. `src/index.ts`
4. `src/ollama.ts`
5. `src/tools.ts`
6. `src/agent.ts`
7. `test/smoke.test.js`

Start with `src/types.ts` because it defines the vocabulary. Then read the implementation files and ask: which imported type is each function promising to accept or return?

## 24. Exercises to Learn Faster

These are small changes that will teach real TypeScript concepts in this codebase.

1. Add a new action type called `"ask_user"` to `AgentAction`, then see which places TypeScript forces you to update.
2. Add a new tool called `file_exists`, then wire it through `ToolInputByName`, `ToolResultByName`, and `toolRegistry`.
3. Change `summary: string[]` to `summary?: string[]` and observe how `src/index.ts` must change.
4. Temporarily remove `reason` from `ToolCallAction` and see which code depends on it.
5. Replace one `unknown` with `any` in `parseJsonResponse`, then notice which compiler protections disappear.
6. Add an invalid role like `"developer"` to a `ChatMessage` and confirm that TypeScript rejects it.
7. Remove one tool from `toolRegistry` and watch `satisfies` catch it during `npm run build`.

## 25. Useful Commands While Learning

Build the TypeScript:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run the app:

```bash
npm start -- "Create a simple snake game in ./generated-apps/snake-game"
```

Show CLI help:

```bash
node dist/index.js --help
```

Clean mental model:

- `src/` is what you study and edit.
- `dist/` is what Node runs.
- `types.ts` describes trusted internal shapes.
- parser functions turn unsafe external data into trusted internal shapes.
- `strict: true` makes TypeScript point out weak assumptions.

