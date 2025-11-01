import Hyperspell from "hyperspell";

let hyperspellInstance: Hyperspell | null = null;

const HYPERSPELL_APP_NAME = "test-714";
const HYPERSPELL_JWT_SECRET = "B85ZQT15Hu72IRbdFW2Es2SUBhDDgeD5";

export function getHyperspell() {
  if (!hyperspellInstance) {
    const apiKey = process.env.NEXT_PUBLIC_HYPERSPELL_API_KEY || process.env.HYPERSPELL_API_KEY;

    if (!apiKey) {
      console.warn("Hyperspell API key not found in environment variables");
      return null;
    }

    hyperspellInstance = new Hyperspell({
      apiKey,
      appName: HYPERSPELL_APP_NAME,
      jwtSecret: HYPERSPELL_JWT_SECRET,
    });
  }

  return hyperspellInstance;
}

export async function checkSpelling(text: string): Promise<{
  corrections: Array<{
    word: string;
    suggestions: string[];
    position: number;
  }>;
  correctedText: string;
}> {
  const hyperspell = getHyperspell();

  if (!hyperspell) {
    return {
      corrections: [],
      correctedText: text,
    };
  }

  try {
    const result = await hyperspell.check(text);
    return {
      corrections: result.corrections || [],
      correctedText: result.correctedText || text,
    };
  } catch (error) {
    console.error("Hyperspell check error:", error);
    return {
      corrections: [],
      correctedText: text,
    };
  }
}

/**
 * Store a memory in Hyperspell for context-aware spell checking
 */
export async function storeMemory(content: string, tags?: string[]): Promise<boolean> {
  const hyperspell = getHyperspell();

  if (!hyperspell) {
    console.warn("Hyperspell not initialized, skipping memory storage");
    return false;
  }

  try {
    await hyperspell.memory.add({
      content,
      tags: tags || [],
    });
    return true;
  } catch (error) {
    console.error("Failed to store Hyperspell memory:", error);
    return false;
  }
}

/**
 * Store campaign brief as memory
 */
export async function storeCampaignBriefMemory(brief: string): Promise<void> {
  await storeMemory(brief, ["campaign", "brief", "user-input"]);
}

/**
 * Store discovered trends as memories
 */
export async function storeTrendMemories(trends: Array<{ trend_name: string; description: string; target_audience: string }>): Promise<void> {
  for (const trend of trends) {
    const content = `Trend: ${trend.trend_name}. Description: ${trend.description}. Target audience: ${trend.target_audience}`;
    await storeMemory(content, ["trend", "discovery", trend.trend_name.toLowerCase()]);
  }
}

/**
 * Store product information as memory
 */
export async function storeProductMemories(products: Array<{ title: string; merchant: string; tags: string }>): Promise<void> {
  for (const product of products) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(product.tags || "[]");
    } catch {
      tags = [];
    }

    const content = `Product: ${product.title} from ${product.merchant}. Categories: ${tags.join(", ")}`;
    await storeMemory(content, ["product", "amazon", product.merchant.toLowerCase(), ...tags.map(t => t.toLowerCase())]);
  }
}

/**
 * Store video generation context as memory
 */
export async function storeVideoMemory(productTitle: string, personaName: string, strategyOverview: string): Promise<void> {
  const content = `Generated video for ${productTitle}. Persona: ${personaName}. Strategy: ${strategyOverview}`;
  await storeMemory(content, ["video", "ugc", "persona", personaName.toLowerCase()]);
}
