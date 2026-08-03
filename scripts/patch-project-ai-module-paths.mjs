import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/project-analytics-v2.tsx";
let source = readFileSync(path, "utf8");
const wrong = 'from "../../lib/project-ai";';
const correct = 'from "../../../lib/project-ai";';

if (source.includes(correct)) {
  console.log("Project AI module paths already normalized");
  process.exit(0);
}
if (!source.includes(wrong)) {
  throw new Error("Project AI module path patch failed: import marker not found");
}
source = source.replace(wrong, correct);
writeFileSync(path, source);
console.log("Normalized Project Analytics V2 AI import path");
