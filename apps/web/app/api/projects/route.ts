import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects,
  reportRecipes
} from "@zvedeno/database";
import {
  refreshCreativeWeeklySnapshots,
  syncGoogleReports,
  syncManualWeeklyReports,
  syncMetaData
} from "@zvedeno/sync-engine";
import { currentWorkspaceUser, canManageWorkspace } from "../../../lib/auth/workspace-user";
import { LEGACY_DMND_PROJECT_ID } from "../../../lib/project-ai";
import { startReportInterview } from "../../../lib/report-interview";

function slugify(value: string): string {
  const base = value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-z0-9а-яіїєґ]+/giu, "-")
    .replace(/^-+|-+$/g, "");
  return base || `project-${Date.now()}`;
}

function redirectUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000");
}

function parseDirectionRules(form: FormData): Array<{ key: string; resultLabel: string }> {
  const raw = String(form.get("directionRules") ?? "");
  const seen = new Set<string>();
  const result: Array<{ key: string; resultLabel: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const [rawKey, ...labelParts] = line.split(":");
    const key = String(rawKey ?? "").trim().toLocaleUpperCase("uk-UA");
    if (!key || seen.has(key)) continue;
    const resultLabel = labelParts.join(":").trim() || "Фактичний результат";
    seen.add(key);
    result.push({ key, resultLabel });
  }
  return result;
}

function recipeConfig(
  form: FormData,
  startDate: string,
  projectBrief: string,
  useAi: boolean
): Record<string, unknown> {
  const lookbackDays = Number(form.get("lookbackDays") ?? 28);
  const refreshMinutes = Number(form.get("refreshMinutes") ?? 60);
  const selectedResult = String(form.get("resultMetric") ?? "auto");
  const directions = parseDirectionRules(form);
  const config: Record<string, unknown> = {
    startDate,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 28,
    refreshMinutes: Number.isFinite(refreshMinutes) ? refreshMinutes : 60,
    resultLabel: selectedResult === "action.messaging_conversation_started_7d"
      ? "Переписки"
      : selectedResult === "action.omni_purchase"
        ? "Покупки"
        : selectedResult === "action.link_click"
          ? "Кліки"
          : "Meta результат",
    directionReportV2: true,
    directionMode: "project_ai_context",
    includeDaily: false,
    includeCreatives: true,
    includeCampaigns: false,
    includeFunnel: true,
    includeCreativeWeekly: true,
    hideLegacyTabs: true,
    projectBrief,
    uiVersion: "adaptive-v1",
    aiReport: {
      status: useAi ? "pending" : "disabled",
      analyzedAt: null
    },
    reportInterview: {
      version: "adaptive-v1",
      status: "questionnaire",
      model: process.env.OPENAI_REPORT_BUILDER_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.6",
      round: 0,
      analyzedAt: null,
      summary: "Очікується первинний аудит Meta-кабінетів.",
      metricInventory: [],
      recommendations: [],
      questions: [],
      answers: {},
      blueprint: null,
      warnings: []
    }
  };
  if (selectedResult !== "auto") config.resultMetric = selectedResult;
  if (directions.length > 0) config.directions = directions;
  return config;
}

export async function POST(request: NextRequest) {
  const currentUser = await currentWorkspaceUser();
  if (!currentUser) return NextResponse.redirect(redirectUrl("/auth/sign-in?callbackUrl=/setup/accounts"), 303);
  if (!canManageWorkspace(currentUser)) return NextResponse.redirect(redirectUrl("/projects?error=forbidden"), 303);

  const form = await request.formData();
  const projectName = String(form.get("projectName") ?? "").trim();
  const existingProjectId = String(form.get("existingProjectId") ?? "").trim();
  const accountIds = form.getAll("accountIds").map(String).filter(Boolean);
  const startDate = String(form.get("startDate") ?? "");
  const projectBrief = String(form.get("projectBrief") ?? "").trim();
  const useAi = String(form.get("useAi") ?? "on") !== "off";

  if ((!existingProjectId && !projectName) || accountIds.length === 0 || !startDate) {
    return NextResponse.redirect(redirectUrl("/setup/accounts?error=missing_fields"), 303);
  }

  const { db, pool } = createDatabase();
  try {
    const selectedAccounts = await db
      .select({ id: adAccounts.id, currency: adAccounts.currency, timezone: adAccounts.timezone })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, currentUser.workspaceId));
    const selectedSet = new Set(accountIds);
    const validAccounts = selectedAccounts.filter((account) => selectedSet.has(account.id));
    const primaryAccount = validAccounts[0];
    if (!primaryAccount) {
      return NextResponse.redirect(redirectUrl("/setup/accounts?error=invalid_accounts"), 303);
    }

    let project: { id: string; name: string };
    let existing = false;
    if (existingProjectId) {
      const [found] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.id, existingProjectId), eq(projects.workspaceId, currentUser.workspaceId)))
        .limit(1);
      if (!found) return NextResponse.redirect(redirectUrl("/setup/accounts?error=project_not_found"), 303);
      project = found;
      existing = true;
    } else {
      const baseSlug = slugify(projectName);
      const [sameSlug] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, currentUser.workspaceId), eq(projects.slug, baseSlug)))
        .limit(1);
      const slug = sameSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;
      const [created] = await db
        .insert(projects)
        .values({
          workspaceId: currentUser.workspaceId,
          name: projectName,
          slug,
          timezone: primaryAccount.timezone ?? "UTC",
          currency: primaryAccount.currency
        })
        .returning({ id: projects.id, name: projects.name });
      if (!created) throw new Error("Failed to create project");
      project = created;
    }

    for (let index = 0; index < validAccounts.length; index += 1) {
      const account = validAccounts[index];
      if (!account) continue;
      await db
        .insert(projectAdAccounts)
        .values({
          projectId: project.id,
          adAccountId: account.id,
          activeFrom: startDate,
          isPrimary: !existing && index === 0
        })
        .onConflictDoUpdate({
          target: [projectAdAccounts.projectId, projectAdAccounts.adAccountId],
          set: { activeTo: null }
        });
    }

    const config = project.id === LEGACY_DMND_PROJECT_ID
      ? recipeConfig(form, startDate, projectBrief, false)
      : recipeConfig(form, startDate, projectBrief, useAi);
    const [currentRecipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    if (currentRecipe) {
      const currentConfig = currentRecipe.config as Record<string, unknown>;
      const nextConfig = project.id === LEGACY_DMND_PROJECT_ID
        ? currentConfig
        : { ...currentConfig, ...config };
      await db
        .update(reportRecipes)
        .set({ config: nextConfig, updatedAt: new Date() })
        .where(eq(reportRecipes.id, currentRecipe.id));
    } else {
      await db.insert(reportRecipes).values({
        workspaceId: currentUser.workspaceId,
        projectId: project.id,
        name: `${project.name} living report`,
        config
      });
    }

    const metaSummary = await syncMetaData({ projectId: project.id, dateFrom: startDate, fullBackfill: true });
    const weekly = await refreshCreativeWeeklySnapshots({ projectId: project.id });

    if (project.id !== LEGACY_DMND_PROJECT_ID) {
      try {
        await startReportInterview({ projectId: project.id, brief: projectBrief });
      } catch (error) {
        console.error("Automatic adaptive report interview failed", error);
      }
      const url = redirectUrl(`/projects/${project.id}/report-builder`);
      url.searchParams.set("synced", String(metaSummary.insights));
      url.searchParams.set("weekly", String(weekly.snapshots));
      url.searchParams.set("errors", String(metaSummary.errors));
      return NextResponse.redirect(url, 303);
    }

    if (existing) {
      const sheetSummary = await syncGoogleReports({ projectId: project.id });
      const manualWeekly = await syncManualWeeklyReports({ projectId: project.id });
      const url = redirectUrl(`/projects/${project.id}`);
      url.searchParams.set("sync", "done");
      url.searchParams.set("meta", String(metaSummary.insights));
      url.searchParams.set("weekly", String(weekly.snapshots));
      url.searchParams.set("sheets", String(sheetSummary.appended + sheetSummary.updated + manualWeekly.appended + manualWeekly.updated));
      return NextResponse.redirect(url, 303);
    }

    const url = redirectUrl(`/setup/google?projectId=${project.id}`);
    url.searchParams.set("synced", String(metaSummary.insights));
    url.searchParams.set("weekly", String(weekly.snapshots));
    url.searchParams.set("errors", String(metaSummary.errors));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Project save failed", error);
    return NextResponse.redirect(redirectUrl("/setup/accounts?error=project_creation_failed"), 303);
  } finally {
    await pool.end();
  }
}
