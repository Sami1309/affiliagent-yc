import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");

    if (!productId) {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 }
      );
    }

    const videos = await prisma.generatedVideo.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    // Parse JSON strings
    const parsedVideos = videos.map((video) => ({
      ...video,
      targetPlatforms: JSON.parse(video.targetPlatforms),
      createdAt: video.createdAt.toISOString(),
    }));

    return NextResponse.json({ videos: parsedVideos });
  } catch (error) {
    console.error("Error fetching videos:", error);
    return NextResponse.json(
      { error: "Failed to fetch videos" },
      { status: 500 }
    );
  }
}
