import fs from "node:fs";

const path = "apps/web/app/api/projects/route.ts";
let source = fs.readFileSync(path, "utf8");

const old = "    const weekly = await refreshCreativeWeeklySnapshots({ projectId: project.id });";
if (!source.includes(old)) throw new Error("Project weekly snapshot marker not found");
source = source.replace(
  old,
  `    const weekly = project.id === LEGACY_DMND_PROJECT_ID
      ? await refreshCreativeWeeklySnapshots({ projectId: project.id })
      : { snapshots: 0 };`
);

fs.writeFileSync(path, source);
console.log("Applied adaptive snapshot skip patch");
