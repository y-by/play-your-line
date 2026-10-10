// Writes docs/RULES.md and the roles table in README.md from src/lib/rules.ts.
// Run: npm run docs:rules
import { readFileSync, writeFileSync } from "node:fs";
import { README_MARK_END, README_MARK_START, readmeTable, rulesMarkdown } from "../src/lib/rules.ts";

const readme = readFileSync("README.md", "utf8");
const start = readme.indexOf(README_MARK_START);
const end = readme.indexOf(README_MARK_END);
if (start < 0 || end < 0) {
  console.error("README.md has no rules-table markers.");
  process.exit(1);
}
writeFileSync("README.md", readme.slice(0, start) + README_MARK_START + "\n" + readmeTable() + "\n" + readme.slice(end));
writeFileSync("docs/RULES.md", rulesMarkdown());
console.log("Wrote docs/RULES.md and the roles table in README.md");
