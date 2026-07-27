import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  createDatabase,
  manualMetricDefinitions,
  manualMetricValues,
  projects
} from "@zvedeno/database";
import { syncManualWeeklyReports } from "@zvedeno/sync-engine";

function projectUrl(projectId: string): URL {
  return new URL(`/projects/${projectId}`, process.env.APP_URL ?? "http://localhost:3000");
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const form = await request.formData();
  const definitionId = String(form.get("definitionId") ?? "");
  const entityKey = String(form.get("entityKey") ?? "project").trim() || "project";
  const periodStart = String(form.get("periodStart") ?? "");
  const periodEnd = String(form.get("periodEnd") ?? periodStart);
  const value = Number(form.get("value"));
  const note = String(form.get("note") ?? "").trim();

  if (!definitionId || !periodStart || !periodEnd || !Number.isFinite(value)) {
    const url = projectUrl(projectId);
    url.searchParams.set("error", "invalid_manual_value");
    return NextResponse.redirect(url, 303);
  }

  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const [definition] = await db
      .select({ id: manualMetricDefinitions.id })
      .from(manualMetricDefinitions)
      .where(and(
        eq(manualMetricDefinitions.id, definitionId),
        eq(manualMetricDefinitions.projectId, projectId),
        eq(manualMetricDefinitions.enabled, true)
      ))
      .limit(1);

    if (!project || !definition) {
      const url = projectUrl(projectId);
      url.searchParams.set("error", "manual_metric_not_found");
      return NextResponse.redirect(url, 303);
    }

    await db
      .insert(manualMetricValues)
      .values({
        workspaceId: project.workspaceId,
        projectId: project.id,
        definitionId: definition.id,
        entityKey,
        periodStart,
        periodEnd,
        value: String(value),
        note: note || null,
        source: "service"
      })
      .onConflictDoUpdate({
        target: [
          manualMetricValues.definitionId,
          manualMetricValues.entityKey,
          manualMetricValues.periodStart,
          manualMetricValues.periodEnd
        ],
        set: {
          value: String(value),
          note: note || null,
          source: "service",
          updatedAt: new Date()
        }
      });

    await syncManualWeeklyReports({ projectId: project.id });
    const url = projectUrl(project.id);
    url.searchParams.set("manualValue", "saved");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Manual value save failed", error);
    const url = projectUrl(projectId);
    url.searchParams.set("error", "manual_value_save_failed");
    return NextResponse.redirect(url, 303);
  } finally {
    await pool.end();
  }
}
