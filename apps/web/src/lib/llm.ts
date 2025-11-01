const DEFAULT_IDEAS = [
  "portable espresso maker for travel",
  "adjustable dumbbell set for small spaces",
  "sunrise alarm clock with smart features",
];

export type CampaignPlan = {
  niche: string;
  summary: string;
  targetSegments: string[];
  marketingAngles: string[];
  searchIdeas: string[];
};

function buildDefaultPlan(brief: string): CampaignPlan {
  return {
    niche: "Impulse-friendly home upgrades",
    summary: `Focus on fast-moving Amazon products related to: ${brief}`,
    targetSegments: ["Renters upgrading decor", "Busy professionals seeking convenience"],
    marketingAngles: [
      "Transform spaces quickly without big budgets",
      "Show before-and-after moments in short-form video",
    ],
    searchIdeas: [...DEFAULT_IDEAS],
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (match) {
    return match[1];
  }
  return content;
}

export async function generateCampaignPlan(brief: string): Promise<CampaignPlan> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildDefaultPlan(brief);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You plan affiliate product discovery campaigns and respond with strict JSON.",
          },
          {
            role: "user",
            content: `Create a concise campaign plan for this Amazon-focused brief: ${brief}. Respond with JSON: {"niche": string, "summary": string, "target_segments": string[], "marketing_angles": string[], "search_queries": string[]}. Limit search queries to 3 items, each under 6 words, focused on impulse-ready products ideal for UGC ads.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("OpenAI campaign plan failed", await response.text());
      return buildDefaultPlan(brief);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawContent = payload.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      return buildDefaultPlan(brief);
    }

    const parsed = JSON.parse(stripCodeFence(rawContent));
    const plan: CampaignPlan = {
      niche: String(parsed.niche ?? parsed.theme ?? "Amazon trend scouting").trim() ||
        "Amazon trend scouting",
      summary:
        String(parsed.summary ?? "Prioritize eye-catching products that ship quickly.").trim() ||
        "Prioritize eye-catching products that ship quickly.",
      targetSegments: asStringArray(parsed.target_segments ?? parsed.audiences),
      marketingAngles: asStringArray(parsed.marketing_angles ?? parsed.angles),
      searchIdeas:
        asStringArray(parsed.search_queries ?? parsed.searchIdeas ?? parsed.queries) ||
        [...DEFAULT_IDEAS],
    };

    if (!plan.targetSegments.length) {
      plan.targetSegments = ["TikTok shoppers", "Pinterest tinkerers"];
    }

    if (!plan.marketingAngles.length) {
      plan.marketingAngles = [
        "Highlight quick transformations",
        "Lean into social proof and urgency",
      ];
    }

    if (!plan.searchIdeas.length) {
      plan.searchIdeas = [...DEFAULT_IDEAS];
    }

    return plan;
  } catch (error) {
    console.error("Error generating campaign plan", error);
    return buildDefaultPlan(brief);
  }
}

export async function brainstormProductIdeas(brief: string): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return DEFAULT_IDEAS;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "You help affiliate marketers find trending Amazon products. Reply with a strict JSON array of 3 short search phrases.",
          },
          {
            role: "user",
            content: `Brainstorm Amazon search queries for this brief: ${brief}. Return a JSON array of concise search strings no longer than 6 words each, focused on impulse-buy or fast-moving consumer products.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("OpenAI brainstorming failed", await response.text());
      return DEFAULT_IDEAS;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return DEFAULT_IDEAS;
    }

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }

      if (Array.isArray(parsed.ideas)) {
        return parsed.ideas.map((value: unknown) => String(value).trim()).filter(Boolean);
      }
    } catch (error) {
      console.warn("Failed to parse LLM output, falling back", error);
    }

    return content
      .split("\n")
      .map((line) => line.replace(/^[-*\d.]+\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (error) {
    console.error("Error brainstorming product ideas", error);
    return DEFAULT_IDEAS;
  }
}
