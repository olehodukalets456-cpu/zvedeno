import fs from "node:fs";

const path = "apps/web/app/projects/[projectId]/report-builder/page.tsx";
let source = fs.readFileSync(path, "utf8");

const marker = `        {query.error && <div className="errorNotice">Не вдалося завершити AI-інтервʼю. Спробуй ще раз.</div>}
        {state.warnings.map((warning) => <div className="configNotice" key={warning}>{warning}</div>)}`;
if (!source.includes(marker)) throw new Error("Report builder feedback marker not found");
source = source.replace(
  marker,
  `        {query.error && <div className="errorNotice">Не вдалося завершити AI-інтервʼю. Спробуй ще раз.</div>}
        {query.ready && (
          <div className="successNotice">
            Конфігурація готова. {query.sheets && query.sheets !== "0" ? \`Google-звіт оновлено: \${query.sheets} рядків.\` : "Якщо Google-звіт ще не створений, підключи Google на фінальному кроці."}
            {query.sheetErrors && query.sheetErrors !== "0" ? \` Помилок експорту: \${query.sheetErrors}.\` : ""}
          </div>
        )}
        {state.warnings.map((warning) => <div className="configNotice" key={warning}>{warning}</div>)}`
);

fs.writeFileSync(path, source);
console.log("Applied adaptive report builder feedback patch");
