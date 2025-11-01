import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LiveDashboard, ProductRecord, RunLogRecord } from "@/components/live-dashboard";

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    links: true;
    creatives: {
      include: {
        posts: true;
      };
    };
  };
}>;

type RunLogEntity = Awaited<ReturnType<typeof prisma.runLog.findMany>>[number];

function serializeProducts(products: ProductWithRelations[]): ProductRecord[] {
  return products.map((product) => ({
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
  })) as ProductRecord[];
}

function serializeRunLogs(runLogs: RunLogEntity[]): RunLogRecord[] {
  return runLogs.map((log) => ({
    ...log,
    at: log.at.toISOString(),
  })) as RunLogRecord[];
}

export default async function Dashboard() {
  const [products, runLogs] = await Promise.all([
    prisma.product.findMany({
      include: {
        links: true,
        creatives: {
          include: {
            posts: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.runLog.findMany({
      orderBy: { at: "desc" },
      take: 30,
    }),
  ]);

  return (
    <LiveDashboard
      initialProducts={serializeProducts(products)}
      initialRunLogs={serializeRunLogs(runLogs)}
    />
  );
}
