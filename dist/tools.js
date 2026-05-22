import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { OUTPUT_ROOT } from "./config.js";
const projectRoot = process.cwd();
const listFilesInputSchema = z.object({
    path: z.string().optional()
});
const pathInputSchema = z.object({
    path: z.string().min(1)
});
const writeFileInputSchema = z.object({
    path: z.string().min(1),
    content: z.string()
});
const replaceInFileInputSchema = z.object({
    path: z.string().min(1),
    search: z.string().min(1),
    replacement: z.string()
});
const runCommandInputSchema = z.object({
    command: z.string().min(1)
});
const allowedCommands = new Set([
    "npm install",
    "npm run build",
    "npm test",
    "npm run test",
    "npm run example:calculator"
]);
function formatZodError(error) {
    return error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; ");
}
function parseWithSchema(schema, input, toolName) {
    const result = schema.safeParse(input ?? {});
    if (!result.success) {
        throw new Error(`Invalid input for ${toolName}: ${formatZodError(result.error)}`);
    }
    return result.data;
}
function resolveOutputRoot(outputRootPath = OUTPUT_ROOT) {
    const resolved = path.resolve(projectRoot, outputRootPath);
    if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
        throw new Error(`Output root is outside the allowed workspace: ${outputRootPath}`);
    }
    return resolved;
}
export function normalizeInsideWorkspace(targetPath, options = {}) {
    const resolved = path.resolve(projectRoot, targetPath);
    const outputRoot = resolveOutputRoot(options.outputRoot);
    const allowedBases = [projectRoot, outputRoot];
    if (!allowedBases.some((basePath) => resolved === basePath || resolved.startsWith(`${basePath}${path.sep}`))) {
        throw new Error(`Path is outside the allowed workspace: ${targetPath}`);
    }
    return resolved;
}
async function ensureOutputRoot(options) {
    await fs.mkdir(resolveOutputRoot(options.outputRoot), { recursive: true });
}
async function listFiles(input, options) {
    await ensureOutputRoot(options);
    const targetPath = input.path ?? ".";
    const resolved = normalizeInsideWorkspace(targetPath, options);
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
async function readFile(input, options) {
    const resolved = normalizeInsideWorkspace(input.path, options);
    const content = await fs.readFile(resolved, "utf8");
    return {
        path: input.path,
        content
    };
}
async function writeFile(input, options) {
    const resolved = normalizeInsideWorkspace(input.path, options);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, input.content, "utf8");
    return {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content, "utf8")
    };
}
async function replaceInFile(input, options) {
    const resolved = normalizeInsideWorkspace(input.path, options);
    const content = await fs.readFile(resolved, "utf8");
    const replacements = content.split(input.search).length - 1;
    if (replacements === 0) {
        throw new Error(`Search text was not found in ${input.path}`);
    }
    const nextContent = content.split(input.search).join(input.replacement);
    await fs.writeFile(resolved, nextContent, "utf8");
    return {
        path: input.path,
        replacements,
        bytesWritten: Buffer.byteLength(nextContent, "utf8")
    };
}
async function makeDirectory(input, options) {
    const resolved = normalizeInsideWorkspace(input.path, options);
    await fs.mkdir(resolved, { recursive: true });
    return {
        path: input.path,
        created: true
    };
}
function splitCommand(command) {
    return command.trim().split(/\s+/);
}
function resolveCommandInvocation(executable, args) {
    if (executable === "npm") {
        const npmExecPath = process.env.npm_execpath;
        if (!npmExecPath) {
            throw new Error("Unable to resolve npm executable path.");
        }
        return {
            executable: process.execPath,
            args: [npmExecPath, ...args]
        };
    }
    return {
        executable,
        args
    };
}
async function runAllowedCommand(input) {
    const command = input.command.trim();
    if (!allowedCommands.has(command)) {
        throw new Error(`Command is not allowed: ${input.command}`);
    }
    const [executable, ...args] = splitCommand(command);
    if (!executable) {
        throw new Error("Command is empty.");
    }
    const invocation = resolveCommandInvocation(executable, args);
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
            cwd: projectRoot,
            shell: false,
            windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolve({
                command,
                exitCode,
                stdout,
                stderr
            });
        });
    });
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
        parseInput: (input) => parseWithSchema(listFilesInputSchema, input, "list_files"),
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
        parseInput: (input) => parseWithSchema(pathInputSchema, input, "read_file"),
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
        parseInput: (input) => parseWithSchema(writeFileInputSchema, input, "write_file"),
        handler: writeFile
    },
    replace_in_file: {
        definition: {
            name: "replace_in_file",
            description: "Replace exact text inside a UTF-8 file relative to the current project. Fails if the search text is not found.",
            inputSchema: {
                path: "string",
                search: "string",
                replacement: "string"
            }
        },
        parseInput: (input) => parseWithSchema(replaceInFileInputSchema, input, "replace_in_file"),
        handler: replaceInFile
    },
    make_directory: {
        definition: {
            name: "make_directory",
            description: "Create a directory relative to the current project.",
            inputSchema: {
                path: "string"
            }
        },
        parseInput: (input) => parseWithSchema(pathInputSchema, input, "make_directory"),
        handler: makeDirectory
    },
    run_command: {
        definition: {
            name: "run_command",
            description: "Run a strictly allowlisted project command. Allowed commands: npm install, npm run build, npm test, npm run test, npm run example:calculator.",
            inputSchema: {
                command: "string"
            }
        },
        parseInput: (input) => parseWithSchema(runCommandInputSchema, input, "run_command"),
        handler: async (input, _options) => runAllowedCommand(input)
    }
};
export const toolDefinitions = Object.freeze(Object.values(toolRegistry).map(({ definition }) => definition));
export async function runTool(name, input, options = {}) {
    if (!Object.hasOwn(toolRegistry, name)) {
        throw new Error(`Unknown tool: ${name}`);
    }
    switch (name) {
        case "list_files":
            return toolRegistry.list_files.handler(toolRegistry.list_files.parseInput(input), options);
        case "read_file":
            return toolRegistry.read_file.handler(toolRegistry.read_file.parseInput(input), options);
        case "write_file":
            return toolRegistry.write_file.handler(toolRegistry.write_file.parseInput(input), options);
        case "replace_in_file":
            return toolRegistry.replace_in_file.handler(toolRegistry.replace_in_file.parseInput(input), options);
        case "make_directory":
            return toolRegistry.make_directory.handler(toolRegistry.make_directory.parseInput(input), options);
        case "run_command":
            return toolRegistry.run_command.handler(toolRegistry.run_command.parseInput(input), options);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
