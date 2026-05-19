import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_ROOT } from "./config.js";
import type {
  DirectoryEntry,
  ToolDefinition,
  ToolInputByName,
  ToolName,
  ToolResultByName
} from "./types.js";

const projectRoot = process.cwd();
const outputRoot = path.resolve(projectRoot, OUTPUT_ROOT);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOptionalString(value: unknown, propertyName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool input "${propertyName}" must be a string.`);
  }

  return value;
}

function getRequiredString(value: unknown, propertyName: string): string {
  const parsed = getOptionalString(value, propertyName);

  if (parsed === undefined) {
    throw new Error(`Tool input "${propertyName}" is required.`);
  }

  return parsed;
}

function getToolInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return {};
  }

  return input;
}

export function normalizeInsideWorkspace(targetPath: string): string {
  const resolved = path.resolve(projectRoot, targetPath);
  const allowedBases = [projectRoot, outputRoot];

  if (
    !allowedBases.some(
      (basePath) =>
        resolved === basePath || resolved.startsWith(`${basePath}${path.sep}`)
    )
  ) {
    throw new Error(`Path is outside the allowed workspace: ${targetPath}`);
  }

  return resolved;
}

async function ensureOutputRoot(): Promise<void> {
  await fs.mkdir(outputRoot, { recursive: true });
}

async function listFiles(input: ToolInputByName["list_files"]): Promise<ToolResultByName["list_files"]> {
  await ensureOutputRoot();
  const targetPath = input.path ?? ".";
  const resolved = normalizeInsideWorkspace(targetPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const normalizedEntries: DirectoryEntry[] = entries
    .map((entry) => ({
      name: entry.name,
      type: (entry.isDirectory() ? "directory" : "file") as DirectoryEntry["type"]
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: targetPath,
    entries: normalizedEntries
  };
}

async function readFile(input: ToolInputByName["read_file"]): Promise<ToolResultByName["read_file"]> {
  const resolved = normalizeInsideWorkspace(input.path);
  const content = await fs.readFile(resolved, "utf8");

  return {
    path: input.path,
    content
  };
}

async function writeFile(
  input: ToolInputByName["write_file"]
): Promise<ToolResultByName["write_file"]> {
  const resolved = normalizeInsideWorkspace(input.path);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, input.content, "utf8");

  return {
    path: input.path,
    bytesWritten: Buffer.byteLength(input.content, "utf8")
  };
}

async function makeDirectory(
  input: ToolInputByName["make_directory"]
): Promise<ToolResultByName["make_directory"]> {
  const resolved = normalizeInsideWorkspace(input.path);
  await fs.mkdir(resolved, { recursive: true });

  return {
    path: input.path,
    created: true
  };
}

function parseListFilesInput(input: unknown): ToolInputByName["list_files"] {
  const parsed = getToolInput(input);
  return {
    path: getOptionalString(parsed.path, "path")
  };
}

function parseReadFileInput(input: unknown): ToolInputByName["read_file"] {
  const parsed = getToolInput(input);
  return {
    path: getRequiredString(parsed.path, "path")
  };
}

function parseWriteFileInput(input: unknown): ToolInputByName["write_file"] {
  const parsed = getToolInput(input);
  return {
    path: getRequiredString(parsed.path, "path"),
    content: getRequiredString(parsed.content, "content")
  };
}

function parseMakeDirectoryInput(input: unknown): ToolInputByName["make_directory"] {
  const parsed = getToolInput(input);
  return {
    path: getRequiredString(parsed.path, "path")
  };
}

const toolRegistry = {
  list_files: {
    definition: {
      name: "list_files",
      description: "List files and folders inside a directory relative to the current project.",
      inputSchema: {
        path: "string"
      }
    },
    parseInput: parseListFilesInput,
    handler: listFiles
  },
  read_file: {
    definition: {
      name: "read_file",
      description: "Read a UTF-8 text file relative to the current project.",
      inputSchema: {
        path: "string"
      }
    },
    parseInput: parseReadFileInput,
    handler: readFile
  },
  write_file: {
    definition: {
      name: "write_file",
      description:
        "Write a UTF-8 text file relative to the current project. Creates parent directories if needed.",
      inputSchema: {
        path: "string",
        content: "string"
      }
    },
    parseInput: parseWriteFileInput,
    handler: writeFile
  },
  make_directory: {
    definition: {
      name: "make_directory",
      description: "Create a directory relative to the current project.",
      inputSchema: {
        path: "string"
      }
    },
    parseInput: parseMakeDirectoryInput,
    handler: makeDirectory
  }
} satisfies {
  [Name in ToolName]: {
    readonly definition: ToolDefinition<Name>;
    readonly parseInput: (input: unknown) => ToolInputByName[Name];
    readonly handler: (input: ToolInputByName[Name]) => Promise<ToolResultByName[Name]>;
  };
};

export const toolDefinitions = Object.freeze(
  Object.values(toolRegistry).map(({ definition }) => definition)
) as readonly ToolDefinition[];

export async function runTool(name: string, input: unknown): Promise<unknown> {
  if (!Object.hasOwn(toolRegistry, name)) {
    throw new Error(`Unknown tool: ${name}`);
  }

  switch (name as ToolName) {
    case "list_files":
      return toolRegistry.list_files.handler(toolRegistry.list_files.parseInput(input));
    case "read_file":
      return toolRegistry.read_file.handler(toolRegistry.read_file.parseInput(input));
    case "write_file":
      return toolRegistry.write_file.handler(toolRegistry.write_file.parseInput(input));
    case "make_directory":
      return toolRegistry.make_directory.handler(toolRegistry.make_directory.parseInput(input));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
