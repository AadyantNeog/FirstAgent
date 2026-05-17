import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_ROOT } from "./config.js";

const projectRoot = process.cwd();
const outputRoot = path.resolve(projectRoot, OUTPUT_ROOT);

function normalizeInsideWorkspace(targetPath) {
  const resolved = path.resolve(projectRoot, targetPath);
  const allowed = [
    projectRoot,
    outputRoot,
  ];

  if (!allowed.some((base) => resolved === base || resolved.startsWith(`${base}${path.sep}`))) {
    throw new Error(`Path is outside the allowed workspace: ${targetPath}`);
  }

  return resolved;
}

async function ensureOutputRoot() {
  await fs.mkdir(outputRoot, { recursive: true });
}

export const toolDefinitions = [
  {
    name: "list_files",
    description: "List files and folders inside a directory relative to the current project.",
    inputSchema: {
      path: "string"
    }
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file relative to the current project.",
    inputSchema: {
      path: "string"
    }
  },
  {
    name: "write_file",
    description: "Write a UTF-8 text file relative to the current project. Creates parent directories if needed.",
    inputSchema: {
      path: "string",
      content: "string"
    }
  },
  {
    name: "make_directory",
    description: "Create a directory relative to the current project.",
    inputSchema: {
      path: "string"
    }
  }
];

const toolHandlers = {
  async list_files({ path: targetPath = "." }) {
    await ensureOutputRoot();
    const resolved = normalizeInsideWorkspace(targetPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });

    return {
      path: targetPath,
      entries: entries
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file"
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  },

  async read_file({ path: targetPath }) {
    const resolved = normalizeInsideWorkspace(targetPath);
    const content = await fs.readFile(resolved, "utf8");
    return {
      path: targetPath,
      content
    };
  },

  async write_file({ path: targetPath, content }) {
    const resolved = normalizeInsideWorkspace(targetPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
    return {
      path: targetPath,
      bytesWritten: Buffer.byteLength(content, "utf8")
    };
  },

  async make_directory({ path: targetPath }) {
    const resolved = normalizeInsideWorkspace(targetPath);
    await fs.mkdir(resolved, { recursive: true });
    return {
      path: targetPath,
      created: true
    };
  }
};

export async function runTool(name, input) {
  const tool = toolHandlers[name];

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool(input ?? {});
}
