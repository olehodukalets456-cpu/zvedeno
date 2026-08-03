import { NextRequest, NextResponse } from "next/server";
import { analyzeProjectReport, LEGACY_DMND_PROJECT_ID } from "../../../../../lib/project-ai";

function appUrl(path: string): URL {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  if (projectId === LEGACY_DMND_PROJECT_ID) {
    return NextResponse.redirect(appUrl(`/projects/${projectId}?ai=legacy_locked`), 303);
  }

  const form = await request.formData();
  const brief = String(form.get("projectBrief") ?? "").trim();

  try {
    const result = await analyzeProjectReport({ projectId, brief });
    const url = appUrl(`/projects/${projectId}`);
    url.searchParams.set("ai", result.status);
    url.searchParams.set("confidence", String(Math.round(result.confidence * 100)));
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("AI project analysis failed", error);
    return NextResponse.redirect(appUrl(`/projects/${projectId}?error=ai_analysis_failed`), 303);
  }
}
