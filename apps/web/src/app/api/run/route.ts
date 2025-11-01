import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { runAmazonDiscoveryPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let brief = "";

  try {
    const body = (await request.json()) as { brief?: unknown } | null;
    brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  } catch (error) {
    console.warn("Failed to parse run request body", error);
  }

  if (!brief) {
    return NextResponse.json({ error: "brief is required" }, { status: 400 });
  }

  const runId = randomUUID();

  runAmazonDiscoveryPipeline({ runId, brief }).catch((error) => {
    console.error("Pipeline execution failed", error);
  });

  return NextResponse.json({ runId, status: "queued" });
}
