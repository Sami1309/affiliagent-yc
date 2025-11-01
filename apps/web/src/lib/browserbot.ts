const DEFAULT_BROWSERBOT_URL = process.env.BROWSERBOT_URL ?? "http://127.0.0.1:8001";

export type BrowserbotProduct = {
  title: string;
  productUrl: string;
  affiliateUrl: string | null;
  imageUrl: string | null;
  priceText: string | null;
  asin: string | null;
  highlights: string[];
  reasoning: string | null;
};

export type BrowserbotResponse = {
  status: string;
  idea: string;
  summary: string | null;
  products: BrowserbotProduct[];
  actions: string[];
  error?: string | null;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asString(value: unknown): string | null {
  return isString(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (isString(item) ? item : String(item ?? ""))).filter(Boolean);
}

function parseProduct(input: unknown): BrowserbotProduct | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;

  const title = asString(record.title);
  const productUrl = asString(record.product_url ?? record.productUrl);

  if (!title || !productUrl) {
    return null;
  }

  return {
    title,
    productUrl,
    affiliateUrl: asString(record.affiliate_url ?? record.affiliateUrl),
    imageUrl: asString(record.image_url ?? record.imageUrl),
    priceText: asString(record.price_text ?? record.priceText),
    asin: asString(record.asin),
    highlights: asStringArray(record.highlights),
    reasoning: asString(record.reasoning),
  };
}

export async function collectAmazonProducts(params: {
  idea: string;
  brief: string;
  maxProducts?: number;
  signal?: AbortSignal;
}): Promise<BrowserbotResponse | null> {
  const url = DEFAULT_BROWSERBOT_URL;
  if (!url) {
    return null;
  }

  const endpoint = new URL("/run", url).toString();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "collect_amazon_products",
        args: {
          idea: params.idea,
          brief: params.brief,
          max_products: params.maxProducts ?? 3,
        },
      }),
      signal: params.signal,
    });
  } catch (error) {
    console.warn("Browserbot request failed", error);
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn("Browserbot response parse failed", error);
    return null;
  }
  const products = Array.isArray(data.products)
    ? data.products.map((item) => parseProduct(item)).filter((item): item is BrowserbotProduct => Boolean(item))
    : [];

  return {
    status: isString(data.status) ? data.status : "unknown",
    idea: asString(data.idea) ?? params.idea,
    summary: asString(data.summary),
    products,
    actions: asStringArray(data.actions),
    error: asString(data.error),
  };
}
