import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId") ?? undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 20, 100) : 20;

  const logs = await prisma.runLog.findMany({
    where: runId ? { runId } : undefined,
    orderBy: { at: "desc" },
    take: limit,
  });

  return NextResponse.json({
    logs: logs.map((log) => ({
      ...log,
      at: log.at.toISOString(),
    })),
  });
}
