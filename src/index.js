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
