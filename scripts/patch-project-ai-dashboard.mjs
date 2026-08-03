import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/web/app/projects/[projectId]/page.tsx";
let source = readFileSync(path, "utf8");

if (source.includes("<ProjectAISection projectId={project.id}")) {
  console.log("Project AI dashboard patch already applied");
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Project AI dashboard patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
  `} from "@zvedeno/database";\n`,
  `} from "@zvedeno/database";\nimport { ProjectAISection } from "./project-ai-section";\n`,
  "AI section import"
);

replaceOnce(
  `<main className="setupMain projectPage">`,
  `<main className={project.id === "cc6f71d1-1043-4a2e-96d7-8f50484c010e"
        ? "setupMain projectPage"
        : "setupMain projectPage aiShell aiProjectPage"}>
        {project.id !== "cc6f71d1-1043-4a2e-96d7-8f50484c010e" && (
          <div className="aiAmbient" aria-hidden="true"><i /><i /><i /></div>
        )}`,
  "conditional AI project shell"
);

replaceOnce(
  `        {query.error && <div className="errorNotice">Не вдалося завершити дію: {String(query.error)}</div>}\n\n        <section className="projectGrid">`,
  `        {query.error && <div className="errorNotice">Не вдалося завершити дію: {String(query.error)}</div>}

        <ProjectAISection projectId={project.id} query={query} />

        <section className="projectGrid">`,
  "AI analysis panel"
);

writeFileSync(path, source);
console.log("Applied project-specific AI dashboard without touching legacy DMND styling");
