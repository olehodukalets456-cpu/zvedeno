import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/lib/project-ai.ts";
let source = readFileSync(path, "utf8");
let changed = false;

const importMarker = `} from "@zvedeno/database";\n`;
const importReplacement = `} from "@zvedeno/database";\nimport { loadDeepProjectContext } from "./project-ai-context";\n`;
if (!source.includes('from "./project-ai-context"')) {
  if (!source.includes(importMarker)) throw new Error("Deep AI context patch failed: import marker");
  source = source.replace(importMarker, importReplacement);
  changed = true;
}

const payloadMarker = `    const imageItems = campaignAggregates\n`;
const payloadReplacement = `    const deepContext = await loadDeepProjectContext(project.id);\n    const imageItems = campaignAggregates\n`;
if (!source.includes("const deepContext = await loadDeepProjectContext")) {
  if (!source.includes(payloadMarker)) throw new Error("Deep AI context patch failed: payload marker");
  source = source.replace(payloadMarker, payloadReplacement);
  changed = true;
}

if (source.includes(".slice(0, 16);")) {
  source = source.replace(".slice(0, 16);", ".slice(0, 48);");
  changed = true;
}

const instructionMarker = `          "Врахуй назви кампаній, цілі, події, креативи, співвідношення метрик і візуальний контекст.",\n`;
const instructionReplacement = `          "Врахуй назви кампаній, цілі, події, креативи, співвідношення метрик і візуальний контекст.",\n          "Прочитай усі передані rawFields кампаній, адсетів та оголошень: тексти, URL, optimization goal, creative metadata, статуси й вкладені параметри. Якщо неймінг суперечить фактичній цілі або подіям — довіряй фактам.",\n`;
if (!source.includes("Прочитай усі передані rawFields")) {
  if (!source.includes(instructionMarker)) throw new Error("Deep AI context patch failed: instruction marker");
  source = source.replace(instructionMarker, instructionReplacement);
  changed = true;
}

const jsonMarker = `          JSON.stringify({ inventory, campaigns: campaignPayload })`;
const jsonReplacement = `          JSON.stringify({ inventory, campaigns: campaignPayload, deepContext })`;
if (source.includes(jsonMarker)) {
  source = source.replace(jsonMarker, jsonReplacement);
  changed = true;
}

if (changed) {
  writeFileSync(path, source);
  console.log("Injected project-scoped raw Meta context and expanded creative vision sample");
} else {
  console.log("Deep project AI context already applied");
}
