import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("CLI --help prints usage and exits cleanly", () => {
  const result = spawnSync("node", ["dist/index.js", "--help"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: npm start --/);
});

test("CLI without a goal exits with code 1", () => {
  const result = spawnSync("node", ["dist/index.js"], {
    cwd: projectRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: npm start --/);
});
