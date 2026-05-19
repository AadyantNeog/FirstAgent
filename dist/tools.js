import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_ROOT } from "./config.js";
const projectRoot = process.cwd();
const outputRoot = path.resolve(projectRoot, OUTPUT_ROOT);
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function getOptionalString(value, propertyName) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string") {
        throw new Error(`Tool input "${propertyName}" must be a string.`);
    }
    return value;
}
function getRequiredString(value, propertyName) {
    const parsed = getOptionalString(value, propertyName);
    if (parsed === undefined) {
        throw new Error(`Tool input "${propertyName}" is required.`);
    }
    return parsed;
}
function getToolInput(input) {
    if (!isRecord(input)) {
        return {};
    }
    return input;
}
export function normalizeInsideWorkspace(targetPath) {
    const resolved = path.resolve(projectRoot, targetPath);
    const allowedBases = [projectRoot, outputRoot];
    if (!allowedBases.some((basePath) => resolved === basePath || resolved.startsWith(`${basePath}${path.sep}`))) {
        throw new Error(`Path is outside the allowed workspace: ${targetPath}`);
    }
    return resolved;
}
async function ensureOutputRoot() {
    await fs.mkdir(outputRoot, { recursive: true });
}
async function listFiles(input) {
    await ensureOutputRoot();
    const targetPath = input.path ?? ".";
    const resolved = normalizeInsideWorkspace(targetPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const normalizedEntries = entries
        .map((entry) => ({
        name: entry.name,
        type: (entry.isDirectory() ? "directory" : "file")
    }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        path: targetPath,
        entries: normalizedEntries
    };
}
async function readFile(input) {
    const resolved = normalizeInsideWorkspace(input.path);
    const content = await fs.readFile(resolved, "utf8");
    return {
        path: input.path,
        content
    };
}
async function writeFile(input) {
    const resolved = normalizeInsideWorkspace(input.path);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, input.content, "utf8");
    return {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content, "utf8")
    };
}
async function makeDirectory(input) {
    const resolved = normalizeInsideWorkspace(input.path);
    await fs.mkdir(resolved, { recursive: true });
    return {
        path: input.path,
        created: true
    };
}
function parseListFilesInput(input) {
    const parsed = getToolInput(input);
    return {
        path: getOptionalString(parsed.path, "path")
    };
}
function parseReadFileInput(input) {
    const parsed = getToolInput(input);
    return {
        path: getRequiredString(parsed.path, "path")
    };
}
function parseWriteFileInput(input) {
    const parsed = getToolInput(input);
    return {
        path: getRequiredString(parsed.path, "path"),
        content: getRequiredString(parsed.content, "content")
    };
}
function parseMakeDirectoryInput(input) {
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
            description: "Write a UTF-8 text file relative to the current project. Creates parent directories if needed.",
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
};
export const toolDefinitions = Object.freeze(Object.values(toolRegistry).map(({ definition }) => definition));
export async function runTool(name, input) {
    if (!Object.hasOwn(toolRegistry, name)) {
        throw new Error(`Unknown tool: ${name}`);
    }
    switch (name) {
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
