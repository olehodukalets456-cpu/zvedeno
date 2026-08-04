import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");
const old = `  if (key.startsWith("action.") || key.startsWith("cost_per_action.")) return "conversion";`;
if (!source.includes(old)) throw new Error("Report metric conversion category marker not found");
source = source.replace(
  old,
  `  if (key.startsWith("action.")) return "conversion";
  if (key.startsWith("cost_per_action.")) return "quality";`
);
fs.writeFileSync(path, source);
console.log("Applied report metric category correction");
