import { runAgent } from "./agent.js";
import { MODEL_NAME, OUTPUT_ROOT, USAGE_TEXT } from "./config.js";
import { pathToFileURL } from "node:url";
function readOptionValue(argv, index, optionName) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${optionName} requires a value.`);
    }
    return value;
}
function parsePositiveInteger(value, optionName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${optionName} must be a positive integer.`);
    }
    return parsed;
}
export function parseCliArgs(argv) {
    const goalParts = [];
    const options = {};
    try {
        for (let index = 0; index < argv.length; index += 1) {
            const arg = argv[index];
            if (arg === "--help" || arg === "-h") {
                return { kind: "help" };
            }
            if (arg === "--trace") {
                options.trace = true;
                continue;
            }
            if (arg === "--max-steps") {
                const value = readOptionValue(argv, index, "--max-steps");
                options.maxSteps = parsePositiveInteger(value, "--max-steps");
                index += 1;
                continue;
            }
            if (arg.startsWith("--max-steps=")) {
                options.maxSteps = parsePositiveInteger(arg.slice("--max-steps=".length), "--max-steps");
                continue;
            }
            if (arg === "--output-root") {
                options.outputRoot = readOptionValue(argv, index, "--output-root");
                index += 1;
                continue;
            }
            if (arg.startsWith("--output-root=")) {
                options.outputRoot = arg.slice("--output-root=".length);
                continue;
            }
            if (arg.startsWith("--")) {
                return {
                    kind: "error",
                    message: `Unknown option: ${arg}\n${USAGE_TEXT}`
                };
            }
            goalParts.push(arg);
        }
    }
    catch (error) {
        return {
            kind: "error",
            message: `${error instanceof Error ? error.message : String(error)}\n${USAGE_TEXT}`
        };
    }
    const goal = goalParts.join(" ").trim();
    if (!goal) {
        return {
            kind: "error",
            message: USAGE_TEXT
        };
    }
    return {
        kind: "run",
        goal,
        options
    };
}
export async function main(argv) {
    const parsed = parseCliArgs(argv);
    if (parsed.kind === "help") {
        console.log(USAGE_TEXT);
        return 0;
    }
    if (parsed.kind === "error") {
        console.error(parsed.message);
        return 1;
    }
    const outputRoot = parsed.options.outputRoot ?? OUTPUT_ROOT;
    console.log(`Model: ${MODEL_NAME}`);
    console.log(`Output root: ./${outputRoot}`);
    console.log(`Goal: ${parsed.goal}`);
    if (parsed.options.trace) {
        console.log("Trace: enabled");
    }
    if (parsed.options.maxSteps) {
        console.log(`Max steps: ${parsed.options.maxSteps}`);
    }
    console.log("");
    try {
        const result = await runAgent(parsed.goal, {}, parsed.options);
        console.log(`Completed in ${result.steps} step(s).`);
        console.log("");
        console.log("Prompt log:");
        for (const promptUsage of result.usage.prompts) {
            console.log(`Step ${promptUsage.step}`);
            console.log(`  Requested: ${promptUsage.requested}`);
            console.log(`  Response type: ${promptUsage.responseType}`);
            if (promptUsage.planSteps) {
                console.log(`  Plan steps: ${promptUsage.planSteps.join(" | ")}`);
            }
            if (promptUsage.planMessage) {
                console.log(`  Plan message: ${promptUsage.planMessage}`);
            }
            if (promptUsage.tool) {
                console.log(`  Tool: ${promptUsage.tool}`);
                console.log(`  Reason: ${promptUsage.reason}`);
                console.log(`  Tool input: ${promptUsage.toolInput}`);
            }
            if (promptUsage.finalMessage) {
                console.log(`  Final message preview: ${promptUsage.finalMessage}`);
            }
            console.log(`  Output preview: ${promptUsage.responsePreview}`);
            console.log(`  Tokens: input=${promptUsage.inputTokens}, output=${promptUsage.outputTokens}`);
            console.log("");
        }
        console.log(`Total tokens: input=${result.usage.totalInputTokens}, output=${result.usage.totalOutputTokens}, combined=${result.usage.totalInputTokens + result.usage.totalOutputTokens}`);
        if (result.tracePath) {
            console.log(`Trace written: ${result.tracePath}`);
        }
        console.log("");
        console.log(result.final.message);
        if (result.final.summary.length > 0) {
            console.log("");
            console.log("Summary:");
            for (const item of result.final.summary) {
                console.log(`- ${item}`);
            }
        }
        return 0;
    }
    catch (error) {
        console.error("Agent failed.");
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
    const exitCode = await main(process.argv.slice(2));
    if (exitCode !== 0) {
        process.exit(exitCode);
    }
}
