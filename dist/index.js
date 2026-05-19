import { runAgent } from "./agent.js";
import { MODEL_NAME, OUTPUT_ROOT, USAGE_TEXT } from "./config.js";
export function parseCliArgs(argv) {
    if (argv.includes("--help") || argv.includes("-h")) {
        return { kind: "help" };
    }
    const goal = argv.join(" ").trim();
    if (!goal) {
        return {
            kind: "error",
            message: USAGE_TEXT
        };
    }
    return {
        kind: "run",
        goal
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
    console.log(`Model: ${MODEL_NAME}`);
    console.log(`Output root: ./${OUTPUT_ROOT}`);
    console.log(`Goal: ${parsed.goal}`);
    console.log("");
    try {
        const result = await runAgent(parsed.goal);
        console.log(`Completed in ${result.steps} step(s).`);
        console.log("");
        console.log("Prompt log:");
        for (const promptUsage of result.usage.prompts) {
            console.log(`Step ${promptUsage.step}`);
            console.log(`  Requested: ${promptUsage.requested}`);
            console.log(`  Response type: ${promptUsage.responseType}`);
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
const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
    process.exit(exitCode);
}
