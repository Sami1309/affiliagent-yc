import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for video generation

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productTitle, productDescription, productImage, productId } = body;

    if (!productTitle || !productDescription) {
      return NextResponse.json(
        { error: "productTitle and productDescription are required" },
        { status: 400 }
      );
    }

    // Set FAL_KEY from environment
    const falKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
    if (!falKey) {
      console.error("FAL_API_KEY not configured");
      return NextResponse.json(
        { error: "FAL_API_KEY not configured in environment" },
        { status: 500 }
      );
    }

    console.log("FAL API Key configured:", falKey.substring(0, 10) + "...");

    // Configure fal client
    try {
      fal.config({ credentials: falKey });
      console.log("fal.config set successfully");
    } catch (configError) {
      console.error("Error configuring fal client:", configError);
      return NextResponse.json(
        { error: "Failed to configure fal client", details: String(configError) },
        { status: 500 }
      );
    }

    // Create a compelling UGC video prompt for the product
    const videoPrompt = `Text overlay with 5-10 shots of a variety of uses of ${productTitle} shot from a phone in a naturalistic setting. Environment should be an open-air concept home or a backyard, or wherever is fitting to show the product being used. Add a VoiceOver describing the product and some fun uses of them. ${productDescription}`;

    console.log("Generating video with SORA2 and persona image in parallel...");
    console.log("Video Prompt:", videoPrompt);
    console.log("Product Image:", productImage ? "Provided" : "Not provided");

    // Generate persona details
    const personaName = "Target Customer";
    const personaDescription = `Ideal customer for ${productTitle}. Enjoys quality products and shares their finds on social media.`;
    const targetPlatforms = ["TikTok", "Instagram Reels", "YouTube Shorts"];
    const strategyOverview = `UGC-style content showcasing ${productTitle} in authentic, relatable scenarios. Focus on demonstrating practical uses and benefits in natural settings. Target platforms: ${targetPlatforms.join(", ")}. Post during peak engagement hours with relevant hashtags.`;

    // Persona image prompt
    const personaImagePrompt = `A friendly, relatable person who would use ${productTitle}. Natural, casual photo style. Smiling, approachable, modern lifestyle aesthetic.`;

    // Generate video and persona image in parallel
    const [videoResult, personaResult] = await Promise.all([
      fal.subscribe("fal-ai/sora-2/text-to-video", {
        input: {
          prompt: videoPrompt,
          duration: 8,
          resolution: "720p",
          aspect_ratio: "9:16",
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            console.log("Video generation in progress...");
            if (update.logs) {
              update.logs.map((log) => log.message).forEach(console.log);
            }
          }
        },
      }),
      fal.subscribe("fal-ai/nano-banana", {
        input: {
          prompt: personaImagePrompt,
          image_size: "square_hd",
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            console.log("Persona image generation in progress...");
          }
        },
      }),
    ]);

    console.log("Video and persona generation complete!");

    const videoUrl = (videoResult.data as any)?.video?.url;
    const personaImageUrl = (personaResult.data as any)?.images?.[0]?.url;

    if (!videoUrl) {
      console.error("No video URL in result:", videoResult);
      return NextResponse.json(
        { error: "No video URL returned", details: JSON.stringify(videoResult) },
        { status: 500 }
      );
    }

    // Save to database if productId is provided
    if (productId) {
      try {
        await prisma.generatedVideo.create({
          data: {
            productId,
            videoUrl,
            personaImageUrl: personaImageUrl || null,
            personaName,
            personaDescription,
            targetPlatforms: JSON.stringify(targetPlatforms),
            strategyOverview,
            prompt: videoPrompt,
            duration: 8,
            aspectRatio: "9:16",
          },
        });
        console.log("Video saved to database");
      } catch (dbError) {
        console.error("Failed to save to database:", dbError);
        // Don't fail the request if DB save fails
      }
    }

    return NextResponse.json({
      videoUrl,
      personaImageUrl,
      personaName,
      personaDescription,
      targetPlatforms,
      strategyOverview,
      prompt: videoPrompt,
      status: "completed",
    });
  } catch (error) {
    console.error("Error generating video:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Try to extract more details from the error
    let errorDetails = errorMessage;
    if (error && typeof error === 'object') {
      console.error("Full error object:", JSON.stringify(error, null, 2));
      errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
    }

    console.error("Error stack:", errorStack);
    console.error("Error details:", errorDetails);

    return NextResponse.json(
      {
        error: "Failed to generate video",
        details: errorMessage,
        fullError: errorDetails,
        stack: errorStack,
      },
      { status: 500 }
    );
  }
}
