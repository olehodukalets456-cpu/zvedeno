import fs from "node:fs";

const path = "apps/web/lib/report-interview.ts";
let source = fs.readFileSync(path, "utf8");

const old = `  const topMetrics = inventory
    .filter((item) => item.nonZeroRows > 0 && ["conversion", "value"].includes(item.category))
    .slice(0, 12);`;
if (!source.includes(old)) throw new Error("Report result metric filter marker not found");
source = source.replace(
  old,
  `  const preferredResult = (key: string): number => {
    if (/purchase/i.test(key)) return 0;
    if (/lead/i.test(key)) return 1;
    if (/registration/i.test(key)) return 2;
    if (/messaging_conversation_started/i.test(key)) return 3;
    if (/landing_page_view/i.test(key)) return 4;
    if (/link_click/i.test(key)) return 5;
    return 10;
  };
  const topMetrics = inventory
    .filter((item) => item.nonZeroRows > 0 && item.category === "conversion")
    .sort((a, b) => preferredResult(a.key) - preferredResult(b.key) || b.nonZeroRows - a.nonZeroRows)
    .slice(0, 12);`
);

const help = "Можна вибрати кілька. У звіт потраплятимуть тільки реально доступні події.";
if (!source.includes(help)) throw new Error("Report result metric help marker not found");
source = source.replace(
  help,
  "Обери події, що означають кількість результатів. Грошові action_value система окремо використає для доходу та ROAS."
);

fs.writeFileSync(path, source);
console.log("Applied conversion count and revenue value separation patch");
