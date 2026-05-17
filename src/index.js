import { runAgent } from "./agent.js";
import { MODEL_NAME, OUTPUT_ROOT } from "./config.js";

const goal = process.argv.slice(2).join(" ").trim();

if (!goal) {
  console.error("Usage: npm start -- \"Create a simple calculator app in ./generated-apps/calculator\"");
  process.exit(1);
}

console.log(`Model: ${MODEL_NAME}`);
console.log(`Output root: ./${OUTPUT_ROOT}`);
console.log(`Goal: ${goal}`);
console.log("");

try {
  const result = await runAgent(goal);
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
    console.log(
      `  Tokens: input=${promptUsage.inputTokens}, output=${promptUsage.outputTokens}`
    );
    console.log("");
  }
  console.log(
    `Total tokens: input=${result.usage.totalInputTokens}, output=${result.usage.totalOutputTokens}, combined=${result.usage.totalInputTokens + result.usage.totalOutputTokens}`
  );
  console.log("");
  console.log(result.final.message);

  if (Array.isArray(result.final.summary) && result.final.summary.length > 0) {
    console.log("");
    console.log("Summary:");
    for (const item of result.final.summary) {
      console.log(`- ${item}`);
    }
  }
} catch (error) {
  console.error("Agent failed.");
  console.error(error.message);
  process.exit(1);
}
