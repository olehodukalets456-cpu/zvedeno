import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects,
  reportRecipes,
  workspaces
} from "@zvedeno/database";
import { syncGoogleReports, syncMetaData } from "@zvedeno/sync-engine";

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

function recipeConfig(form: FormData, startDate: string) {
  const lookbackDays = Number(form.get("lookbackDays") ?? 28);
  const refreshMinutes = Number(form.get("refreshMinutes") ?? 60);
  const selectedResult = String(form.get("resultMetric") ?? "auto");
  return {
    startDate,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 28,
    refreshMinutes: Number.isFinite(refreshMinutes) ? refreshMinutes : 60,
    resultMetric: selectedResult === "auto" ? undefined : selectedResult,
    resultLabel: selectedResult === "action.messaging_conversation_started_7d"
      ? "Conversations"
      : selectedResult === "action.omni_purchase"
        ? "Purchases"
        : selectedResult === "action.link_click"
          ? "Clicks"
          : "Results",
    includeDaily: form.has("includeDaily"),
    includeCreatives: form.has("includeCreatives"),
    includeCampaigns: form.has("includeCampaigns"),
    includeFunnel: form.has("includeFunnel")
  };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const projectName = String(form.get("projectName") ?? "").trim();
  const existingProjectId = String(form.get("existingProjectId") ?? "").trim();
  const accountIds = form.getAll("accountIds").map(String).filter(Boolean);
  const startDate = String(form.get("startDate") ?? "");

  if ((!existingProjectId && !projectName) || accountIds.length === 0 || !startDate) {
    return NextResponse.redirect(redirectUrl("/setup/accounts?error=missing_fields"), 303);
  }

  const { db, pool } = createDatabase();
  try {
    const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "personal";
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);
    if (!workspace) return NextResponse.redirect(redirectUrl("/setup?error=meta_not_connected"), 303);

    const selectedAccounts = await db
      .select({
        id: adAccounts.id,
        currency: adAccounts.currency,
        timezone: adAccounts.timezone
      })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, workspace.id));
    const selectedSet = new Set(accountIds);
    const validAccounts = selectedAccounts.filter((account) => selectedSet.has(account.id));
    if (validAccounts.length === 0) {
      return NextResponse.redirect(redirectUrl("/setup/accounts?error=invalid_accounts"), 303);
    }

    let project: { id: string; name: string };
    let existing = false;
    if (existingProjectId) {
      const [found] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.id, existingProjectId), eq(projects.workspaceId, workspace.id)))
        .limit(1);
      if (!found) return NextResponse.redirect(redirectUrl("/setup/accounts?error=project_not_found"), 303);
      project = found;
      existing = true;
    } else {
      const baseSlug = slugify(projectName);
      const [sameSlug] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, baseSlug)))
        .limit(1);
      const slug = sameSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;
      const [created] = await db
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          name: projectName,
          slug,
          timezone: validAccounts[0].timezone ?? "UTC",
          currency: validAccounts[0].currency
        })
        .returning({ id: projects.id, name: projects.name });
      project = created;
    }

    for (let index = 0; index < validAccounts.length; index += 1) {
      await db
        .insert(projectAdAccounts)
        .values({
          projectId: project.id,
          adAccountId: validAccounts[index].id,
          activeFrom: startDate,
          isPrimary: !existing && index === 0
        })
        .onConflictDoUpdate({
          target: [projectAdAccounts.projectId, projectAdAccounts.adAccountId],
          set: { activeTo: null }
        });
    }

    const config = recipeConfig(form, startDate);
    const [currentRecipe] = await db
      .select({ id: reportRecipes.id, config: reportRecipes.config })
      .from(reportRecipes)
      .where(and(eq(reportRecipes.projectId, project.id), eq(reportRecipes.enabled, true)))
      .limit(1);
    if (currentRecipe) {
      await db
        .update(reportRecipes)
        .set({ config: { ...(currentRecipe.config as Record<string, unknown>), ...config }, updatedAt: new Date() })
        .where(eq(reportRecipes.id, currentRecipe.id));
    } else {
      await db.insert(reportRecipes).values({
        workspaceId: workspace.id,
        projectId: project.id,
        name: `${project.name} living report`,
        config
      });
    }

    const metaSummary = await syncMetaData({ projectId: project.id, dateFrom: startDate, fullBackfill: true, force: true });
    if (existing) {
      const sheetSummary = await syncGoogleReports({ projectId: project.id, force: true });
      const url = redirectUrl(`/projects/${project.id}`);
      url.searchParams.set("sync", "done");
      url.searchParams.set("meta", String(metaSummary.insights));
      url.searchParams.set("sheets", String(sheetSummary.appended + sheetSummary.updated));
      return NextResponse.redirect(url, 303);
    }

    const url = redirectUrl(`/setup/google?projectId=${project.id}`);
    url.searchParams.set("synced", String(metaSummary.insights));
    url.searchParams.set("errors", String(metaSummary.errors));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Project save failed", error);
    return NextResponse.redirect(redirectUrl("/setup/accounts?error=project_creation_failed"), 303);
  } finally {
    await pool.end();
  }
}
