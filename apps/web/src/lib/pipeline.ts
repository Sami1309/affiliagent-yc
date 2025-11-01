import { prisma } from "@/lib/prisma";
import { brainstormProductIdeas, generateCampaignPlan, type CampaignPlan } from "@/lib/llm";
import { AmazonSearchItem, searchAmazonItems } from "@/lib/amazon-paapi";
import { BrowserbotProduct, collectAmazonProducts } from "@/lib/browserbot";

const FALLBACK_IMAGE =
  "https://images-na.ssl-images-amazon.com/images/G/01/x-site/icons/no-img-sm.gif";

function sanitizeTags(values: string[]): string[] {
  return values
    .map((value) => value.toLowerCase().replace(/[^a-z0-9\-\s]/g, ""))
    .flatMap((value) => value.split(/[,/]|\band\b/))
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 6);
}

function parsePriceText(priceText: string | null | undefined): number | null {
  if (!priceText) {
    return null;
  }

  const cleaned = priceText.replace(/,/g, "");
  const match = cleaned.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

async function logRun(runId: string, agent: string, level: "info" | "warn" | "error", message: string) {
  await prisma.runLog.create({
    data: {
      runId,
      agent,
      level,
      message,
    },
  });
}

async function upsertAmazonProductFromApi(
  runId: string,
  idea: string,
  item: AmazonSearchItem,
  position: number
) {
  const tags = sanitizeTags([idea, ...item.features]);
  const images = item.imageUrl ? [item.imageUrl] : [];
  const imageList = images.length ? images : [FALLBACK_IMAGE];

  const existing = await prisma.product.findUnique({
    where: { url: item.detailPageUrl },
    include: { links: true },
  });

  if (existing) {
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        merchant: "Amazon",
        images: JSON.stringify(imageList),
        priceCents: item.price ? Math.round(item.price.amount * 100) : null,
        tags: JSON.stringify(tags),
        sourceRunId: runId,
      },
    });

    const affiliateLink = existing.links[0];
    if (affiliateLink) {
      await prisma.affiliateLink.update({
        where: { id: affiliateLink.id },
        data: {
          deepLink: item.detailPageUrl,
          shortLink: item.detailPageUrl,
        },
      });
    } else {
      await prisma.affiliateLink.create({
        data: {
          productId: existing.id,
          network: "amazon-associates",
          deepLink: item.detailPageUrl,
          subId: `${runId.slice(0, 8)}-${position}`,
          shortLink: item.detailPageUrl,
        },
      });
    }

    return existing.id;
  }

  const product = await prisma.product.create({
    data: {
      title: item.title,
      url: item.detailPageUrl,
      merchant: "Amazon",
      images: JSON.stringify(imageList),
      priceCents: item.price ? Math.round(item.price.amount * 100) : null,
      tags: JSON.stringify(tags),
      sourceRunId: runId,
    },
  });

  await prisma.affiliateLink.create({
    data: {
      productId: product.id,
      network: "amazon-associates",
      deepLink: item.detailPageUrl,
      subId: `${runId.slice(0, 8)}-${position}`,
      shortLink: item.detailPageUrl,
    },
  });

  return product.id;
}

async function upsertAmazonProductFromBrowser(
  runId: string,
  idea: string,
  item: BrowserbotProduct,
  position: number
) {
  const tagSeeds = [idea];
  if (item.reasoning) {
    tagSeeds.push(item.reasoning);
  }
  if (item.highlights?.length) {
    tagSeeds.push(...item.highlights);
  }

  const tags = sanitizeTags(tagSeeds);
  const imageList = item.imageUrl ? [item.imageUrl] : [FALLBACK_IMAGE];
  const priceCents = parsePriceText(item.priceText);
  const affiliateUrl = item.affiliateUrl?.trim() || item.productUrl;

  const existing = await prisma.product.findUnique({
    where: { url: item.productUrl },
    include: { links: true },
  });

  if (existing) {
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        title: item.title,
        merchant: "Amazon",
        images: JSON.stringify(imageList),
        priceCents,
        tags: JSON.stringify(tags),
        sourceRunId: runId,
      },
    });

    const affiliateLink = existing.links[0];
    if (affiliateLink) {
      await prisma.affiliateLink.update({
        where: { id: affiliateLink.id },
        data: {
          deepLink: affiliateUrl,
          shortLink: affiliateUrl,
          subId: `${runId.slice(0, 8)}-${position}`,
        },
      });
    } else {
      await prisma.affiliateLink.create({
        data: {
          productId: existing.id,
          network: "amazon-associates",
          deepLink: affiliateUrl,
          subId: `${runId.slice(0, 8)}-${position}`,
          shortLink: affiliateUrl,
        },
      });
    }

    return existing.id;
  }

  const product = await prisma.product.create({
    data: {
      title: item.title,
      url: item.productUrl,
      merchant: "Amazon",
      images: JSON.stringify(imageList),
      priceCents,
      tags: JSON.stringify(tags),
      sourceRunId: runId,
    },
  });

  await prisma.affiliateLink.create({
    data: {
      productId: product.id,
      network: "amazon-associates",
      deepLink: affiliateUrl,
      subId: `${runId.slice(0, 8)}-${position}`,
      shortLink: affiliateUrl,
    },
  });

  return product.id;
}

export async function runAmazonDiscoveryPipeline(params: { runId: string; brief: string }) {
  const { runId, brief } = params;

  await logRun(runId, "System", "info", `Starting Amazon discovery run: ${brief}`);

  let plan: CampaignPlan | null = null;
  try {
    plan = await generateCampaignPlan(brief);
  } catch (error) {
    console.error("Failed to generate campaign plan", error);
  }

  if (!plan) {
    plan = {
      niche: "Amazon discovery",
      summary: `Focus on quick wins for: ${brief}`,
      targetSegments: ["TikTok shoppers", "Prime members"],
      marketingAngles: ["Show transformation", "Lean on fast shipping"],
      searchIdeas: [],
    };
  }

  await logRun(runId, "Strategist", "info", `PLAN::${JSON.stringify(plan)}`);

  let ideas: string[] = [];
  ideas = plan.searchIdeas?.filter(Boolean) ?? [];

  if (!ideas.length) {
    try {
      ideas = await brainstormProductIdeas(brief);
    } catch (error) {
      console.error("Failed to brainstorm ideas", error);
      await logRun(runId, "System", "error", "LLM brainstorming failed. Falling back to defaults.");
    }
  }

  if (!ideas.length) {
    ideas = ["trending amazon gadgets"];
  }

  await logRun(runId, "DealHunter", "info", `Exploring ideas: ${ideas.join(", ")}`);

  let productCounter = 0;

  for (const idea of ideas) {
    await logRun(runId, "Browserbot", "info", `Launching SiteStripe capture for "${idea}".`);

    let handledByBrowser = false;

    try {
      const browserResult = await collectAmazonProducts({ idea, brief, maxProducts: 3 });

      if (browserResult) {
        if (browserResult.actions.length) {
          for (const action of browserResult.actions.slice(0, 10)) {
            await logRun(runId, "Browserbot", "info", action.slice(0, 250));
          }
        }

        if (browserResult.error) {
          await logRun(runId, "Browserbot", "warn", browserResult.error);
        }

        if (browserResult.summary) {
          await logRun(runId, "DealHunter", "info", browserResult.summary);
        }

        if (browserResult.products.length) {
          handledByBrowser = true;
          for (const product of browserResult.products) {
            productCounter += 1;
            try {
              const productId = await upsertAmazonProductFromBrowser(
                runId,
                idea,
                product,
                productCounter
              );
              await logRun(
                runId,
                "LinkBuilder",
                "info",
                `Captured SiteStripe link for ${product.title} (product ${productId}).`
              );
            } catch (error) {
              console.error("Failed to store browser product", error);
              await logRun(
                runId,
                "LinkBuilder",
                "error",
                `Failed to store browser product for ${product.title}.`
              );
            }
          }
        } else if (browserResult.status === "completed") {
          await logRun(
            runId,
            "Browserbot",
            "warn",
            `Browser automation returned no products for "${idea}".`
          );
        }
      }
    } catch (error) {
      console.error("Browser automation failed", error);
      await logRun(runId, "Browserbot", "error", `Browser automation failed for "${idea}".`);
    }

    if (handledByBrowser) {
      continue;
    }

    await logRun(runId, "DealHunter", "info", `Fallback to PA-API search for "${idea}".`);

    let items: AmazonSearchItem[] = [];
    try {
      items = await searchAmazonItems(idea, { limit: 3 });
    } catch (error) {
      console.error("Amazon search failed", error);
      await logRun(runId, "DealHunter", "error", `Amazon search failed for "${idea}".`);
      continue;
    }

    if (!items.length) {
      await logRun(runId, "DealHunter", "warn", `No items found for "${idea}".`);
      continue;
    }

    for (const item of items) {
      productCounter += 1;
      try {
        const productId = await upsertAmazonProductFromApi(runId, idea, item, productCounter);
        await logRun(
          runId,
          "LinkBuilder",
          "info",
          `Captured PA-API link for ${item.title} (product ${productId}).`
        );
      } catch (error) {
        console.error("Failed to upsert product", error);
        await logRun(runId, "LinkBuilder", "error", `Failed to store product for ${item.title}.`);
      }
    }
  }

  if (productCounter === 0) {
    await logRun(runId, "System", "warn", "Run completed without new products.");
  } else {
    await logRun(runId, "System", "info", `Run completed. Added ${productCounter} items.`);
  }
}
