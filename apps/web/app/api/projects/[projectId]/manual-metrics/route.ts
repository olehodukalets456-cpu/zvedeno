import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  createDatabase,
  manualMetricDefinitions,
  projects
} from "@zvedeno/database";
import { syncManualWeeklyReports } from "@zvedeno/sync-engine";

function projectUrl(projectId: string): URL {
  return new URL(`/projects/${projectId}`, process.env.APP_URL ?? "http://localhost:3000");
}

function metricKey(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-z0-9а-яіїєґ]+/giu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `manual_metric_${Date.now()}`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const form = await request.formData();
  const label = String(form.get("label") ?? "").trim();
  const scope = String(form.get("scope") ?? "project");
  const period = String(form.get("period") ?? "week");
  const valueType = String(form.get("valueType") ?? "number");
  const conversionBaseMetric = String(form.get("conversionBaseMetric") ?? "result").trim();
  const description = String(form.get("description") ?? "").trim();

  if (!label || !["project", "campaign", "creative"].includes(scope) || !["day", "week", "month", "lifetime"].includes(period)) {
    const url = projectUrl(projectId);
    url.searchParams.set("error", "invalid_manual_metric");
    return NextResponse.redirect(url, 303);
  }

  const { db, pool } = createDatabase();
  try {
    const [project] = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      const url = projectUrl(projectId);
      url.searchParams.set("error", "project_not_found");
      return NextResponse.redirect(url, 303);
    }

    let key = metricKey(label);
    const [sameKey] = await db
      .select({ id: manualMetricDefinitions.id })
      .from(manualMetricDefinitions)
      .where(and(eq(manualMetricDefinitions.projectId, project.id), eq(manualMetricDefinitions.key, key)))
      .limit(1);
    if (sameKey) key = `${key}_${Date.now().toString(36)}`;

    await db.insert(manualMetricDefinitions).values({
      workspaceId: project.workspaceId,
      projectId: project.id,
      key,
      label,
      description: description || null,
      scope: scope as "project" | "campaign" | "creative",
      period: period as "day" | "week" | "month" | "lifetime",
      valueType: ["number", "currency", "percentage"].includes(valueType)
        ? valueType as "number" | "currency" | "percentage"
        : "number",
      conversionBaseMetric: conversionBaseMetric || "result",
      includeConversionRate: form.has("includeConversionRate"),
      includeCostPerValue: form.has("includeCostPerValue")
    });

    await syncManualWeeklyReports({ projectId: project.id });
    const url = projectUrl(project.id);
    url.searchParams.set("manualMetric", "created");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Manual metric creation failed", error);
    const url = projectUrl(projectId);
    url.searchParams.set("error", "manual_metric_creation_failed");
    return NextResponse.redirect(url, 303);
  } finally {
    await pool.end();
  }
}
