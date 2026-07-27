import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  adAccounts,
  createDatabase,
  projectAdAccounts,
  projects,
  reportRecipes,
  workspaces
} from "@zvedeno/database";
import { syncMetaData } from "@zvedeno/sync-engine";

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

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const projectName = String(form.get("projectName") ?? "").trim();
  const accountIds = form.getAll("accountIds").map(String).filter(Boolean);
  const startDate = String(form.get("startDate") ?? "");
  const lookbackDays = Number(form.get("lookbackDays") ?? 28);
  const refreshMinutes = Number(form.get("refreshMinutes") ?? 60);
  const selectedResult = String(form.get("resultMetric") ?? "auto");

  if (!projectName || accountIds.length === 0 || !startDate) {
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

    const baseSlug = slugify(projectName);
    const [sameSlug] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, baseSlug))
      .limit(1);
    const slug = sameSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: projectName,
        slug,
        timezone: validAccounts[0].timezone ?? "UTC",
        currency: validAccounts[0].currency
      })
      .returning({ id: projects.id });

    for (let index = 0; index < validAccounts.length; index += 1) {
      await db.insert(projectAdAccounts).values({
        projectId: project.id,
        adAccountId: validAccounts[index].id,
        activeFrom: startDate,
        isPrimary: index === 0
      });
    }

    await db.insert(reportRecipes).values({
      workspaceId: workspace.id,
      projectId: project.id,
      name: `${projectName} living report`,
      config: {
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
      }
    });

    const summary = await syncMetaData({ projectId: project.id, dateFrom: startDate, fullBackfill: true });
    const url = redirectUrl(`/setup/google?projectId=${project.id}`);
    url.searchParams.set("synced", String(summary.insights));
    url.searchParams.set("errors", String(summary.errors));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Project creation failed", error);
    return NextResponse.redirect(redirectUrl("/setup/accounts?error=project_creation_failed"), 303);
  } finally {
    await pool.end();
  }
}
