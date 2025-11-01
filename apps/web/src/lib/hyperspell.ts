import Hyperspell from "hyperspell";

let hyperspellInstance: Hyperspell | null = null;

export function getHyperspell() {
  if (!hyperspellInstance) {
    const apiKey = process.env.NEXT_PUBLIC_HYPERSPELL_API_KEY || process.env.HYPERSPELL_API_KEY;

    if (!apiKey) {
      console.warn("Hyperspell API key not found in environment variables");
      return null;
    }

    hyperspellInstance = new Hyperspell({
      apiKey,
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
