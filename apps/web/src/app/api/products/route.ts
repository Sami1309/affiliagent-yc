import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId") ?? undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 12, 50) : 12;

  const products = await prisma.product.findMany({
    where: runId ? { sourceRunId: runId } : undefined,
    include: {
      links: true,
      creatives: {
        include: {
          posts: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    products: products.map((product) => ({
      ...product,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      links: product.links.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
      })),
      creatives: product.creatives.map((creative) => ({
        ...creative,
        createdAt: creative.createdAt.toISOString(),
        posts: creative.posts.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
        })),
      })),
    })),
  });
}
