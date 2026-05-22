import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function importDistModule(relativePath) {
  const moduleUrl = pathToFileURL(path.join(projectRoot, "dist", relativePath)).href;
  return import(moduleUrl);
}

test("parseJsonResponse rejects malformed model output", async () => {
  const { ModelResponseError, parseJsonResponse } = await importDistModule("agent.js");
  assert.throws(() => parseJsonResponse("{"), ModelResponseError);
});

test("parseJsonResponse accepts valid tool_call payloads", async () => {
  const { parseJsonResponse } = await importDistModule("agent.js");
  const result = parseJsonResponse(
    JSON.stringify({
      type: "tool_call",
      tool: "list_files",
      input: { path: "." },
      reason: "Inspect the project"
    })
  );

  assert.deepEqual(result, {
    type: "tool_call",
    tool: "list_files",
    input: { path: "." },
    reason: "Inspect the project"
  });
});

test("parseJsonResponse accepts tool_call payloads without a reason", async () => {
  const { parseJsonResponse } = await importDistModule("agent.js");
  const result = parseJsonResponse(
    JSON.stringify({
      type: "tool_call",
      tool: "make_directory",
      input: { path: "./generated-apps/snake-game" }
    })
  );

  assert.deepEqual(result, {
    type: "tool_call",
    tool: "make_directory",
    input: { path: "./generated-apps/snake-game" },
    reason: "No reason provided."
  });
});

test("parseJsonResponse accepts valid final payloads", async () => {
  const { parseJsonResponse } = await importDistModule("agent.js");
  const result = parseJsonResponse(
    JSON.stringify({
      type: "final",
      message: "Done",
      summary: ["Created files"]
    })
  );

  assert.deepEqual(result, {
    type: "final",
    message: "Done",
    summary: ["Created files"]
  });
});

test("parseJsonResponse accepts valid plan payloads", async () => {
  const { parseJsonResponse } = await importDistModule("agent.js");
  const result = parseJsonResponse(
    JSON.stringify({
      type: "plan",
      steps: ["Inspect files", "Write app"],
      message: "Short plan"
    })
  );

  assert.deepEqual(result, {
    type: "plan",
    steps: ["Inspect files", "Write app"],
    message: "Short plan"
  });
});

test("normalizeInsideWorkspace rejects paths outside the workspace", async () => {
  const { normalizeInsideWorkspace } = await importDistModule("tools.js");
  assert.throws(
    () => normalizeInsideWorkspace("..\\outside.txt"),
    /Path is outside the allowed workspace/
  );
});

test("runTool rejects unknown tool names", async () => {
  const { runTool } = await importDistModule("tools.js");
  await assert.rejects(() => runTool("missing_tool", {}), /Unknown tool: missing_tool/);
});

test("replace_in_file replaces exact text and rejects missing text", async () => {
  const { runTool } = await importDistModule("tools.js");
  const targetPath = "generated-apps/test-tools/replace.txt";

  await runTool("write_file", {
    path: targetPath,
    content: "hello old world old"
  });

  const replaceResult = await runTool("replace_in_file", {
    path: targetPath,
    search: "old",
    replacement: "new"
  });

  assert.equal(replaceResult.replacements, 2);

  const readResult = await runTool("read_file", {
    path: targetPath
  });
  assert.equal(readResult.content, "hello new world new");

  await assert.rejects(
    () =>
      runTool("replace_in_file", {
        path: targetPath,
        search: "missing",
        replacement: "unused"
      }),
    /Search text was not found/
  );
});

test("run_command rejects commands outside the allowlist", async () => {
  const { runTool } = await importDistModule("tools.js");
  await assert.rejects(
    () =>
      runTool("run_command", {
        command: "node --version"
      }),
    /Command is not allowed/
  );
});

test("run_command executes an allowlisted command", async () => {
  const { runTool } = await importDistModule("tools.js");
  const result = await runTool("run_command", {
    command: "npm run build"
  });

  assert.equal(result.command, "npm run build");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /tsc -p tsconfig\.json/);
});

test("runAgent aggregates usage and terminates on final action", async () => {
  const { runAgent } = await importDistModule("agent.js");
  let callCount = 0;

  const result = await runAgent("Create something", {
    async callModel(messages) {
      callCount += 1;

      if (callCount === 1) {
        assert.equal(messages.length, 2);
        return {
          content: JSON.stringify({
            type: "tool_call",
            tool: "list_files",
            input: { path: "." },
            reason: "Need context"
          }),
          usage: {
            inputTokens: 10,
            outputTokens: 4
          }
        };
      }

      assert.equal(messages.length, 4);
      return {
        content: JSON.stringify({
          type: "final",
          message: "Done",
          summary: ["Listed files"]
        }),
        usage: {
          inputTokens: 8,
          outputTokens: 3
        }
      };
    },
    async executeTool(name, input) {
      assert.equal(name, "list_files");
      assert.deepEqual(input, { path: "." });
      return {
        path: ".",
        entries: []
      };
    }
  });

  assert.equal(result.steps, 2);
  assert.equal(result.usage.totalInputTokens, 18);
  assert.equal(result.usage.totalOutputTokens, 7);
  assert.equal(result.final.message, "Done");
});

test("runAgent records plan actions and writes traces", async () => {
  const { runAgent } = await importDistModule("agent.js");
  let callCount = 0;

  const result = await runAgent(
    "Create something",
    {
      async callModel(messages) {
        callCount += 1;

        if (callCount === 1) {
          return {
            content: JSON.stringify({
              type: "plan",
              steps: ["Inspect", "Write"]
            }),
            usage: {
              inputTokens: 2,
              outputTokens: 3
            }
          };
        }

        assert.match(messages.at(-1).content, /Plan received/);
        return {
          content: JSON.stringify({
            type: "final",
            message: "Done after plan",
            summary: []
          }),
          usage: {
            inputTokens: 4,
            outputTokens: 5
          }
        };
      }
    },
    {
      trace: true,
      traceDirectory: ".agent-runs/test",
      maxSteps: 3
    }
  );

  assert.equal(result.steps, 2);
  assert.equal(result.final.message, "Done after plan");
  assert.ok(result.tracePath);

  const trace = JSON.parse(await fs.readFile(result.tracePath, "utf8"));
  assert.equal(trace.goal, "Create something");
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0].action.type, "plan");
  assert.equal(trace.final.message, "Done after plan");
});

test("runAgent stops at the configured max step limit", async () => {
  const { runAgent } = await importDistModule("agent.js");

  await assert.rejects(
    () =>
      runAgent(
        "Never finish",
        {
          async callModel() {
            return {
              content: JSON.stringify({
                type: "plan",
                steps: ["Keep planning"]
              }),
              usage: {
                inputTokens: 1,
                outputTokens: 1
              }
            };
          }
        },
        {
          maxSteps: 1
        }
      ),
    /MAX_STEPS=1/
  );
});

test("CLI --help prints usage and exits cleanly", () => {
  const result = spawnSync("node", ["dist/index.js", "--help"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: npm start --/);
  assert.match(result.stdout, /--trace/);
});

test("CLI without a goal exits with code 1", () => {
  const result = spawnSync("node", ["dist/index.js"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: npm start --/);
});

test("CLI parses trace, max-step, and output-root flags", async () => {
  const { parseCliArgs } = await importDistModule("index.js");
  const result = parseCliArgs([
    "--trace",
    "--max-steps",
    "7",
    "--output-root",
    "generated-apps/custom",
    "Create",
    "app"
  ]);

  assert.deepEqual(result, {
    kind: "run",
    goal: "Create app",
    options: {
      trace: true,
      maxSteps: 7,
      outputRoot: "generated-apps/custom"
    }
  });
});
