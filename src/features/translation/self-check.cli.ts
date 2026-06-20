import { runTranslationSelfCheck } from "./self-check";

const report = await runTranslationSelfCheck();

for (const item of report.checks) {
  console.info(`${item.passed ? "PASS" : "FAIL"} ${item.name}`);
}

if (!report.passed) {
  throw new Error("Translation self-check failed.");
}
