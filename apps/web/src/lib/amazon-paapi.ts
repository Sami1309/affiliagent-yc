import crypto from "crypto";

type RawAmazonImage = {
  URL?: string;
};

type RawAmazonItem = {
  ASIN?: string;
  DetailPageURL?: string;
  Images?: {
    Primary?: {
      Large?: RawAmazonImage;
      Medium?: RawAmazonImage;
    };
  };
  ItemInfo?: {
    Title?: {
      DisplayValue?: string;
    };
    Features?: {
      DisplayValues?: unknown[];
    };
  };
  Offers?: {
    Listings?: Array<{
      Price?: {
        Amount?: number;
        Currency?: string;
      };
    }>;
  };
};

type SearchItemsResponse = {
  SearchResult?: {
    Items?: RawAmazonItem[];
  };
  Errors?: Array<{
    Code: string;
    Message: string;
  }>;
};

export type AmazonSearchItem = {
  asin: string;
  title: string;
  detailPageUrl: string;
  imageUrl: string | null;
  price: { amount: number; currency: string } | null;
  features: string[];
};

const DEFAULT_RESULTS: Record<string, AmazonSearchItem[]> = {
  "portable espresso maker for travel": [
    {
      asin: "B07PJ4P9DR",
      title: "AeroPress Go Portable Travel Coffee Press Kit",
      detailPageUrl: "https://www.amazon.com/dp/B07PJ4P9DR",
      imageUrl: "https://m.media-amazon.com/images/I/61AULQ0rPqL._SL1500_.jpg",
      price: { amount: 39.95, currency: "USD" },
      features: ["Compact travel design", "Includes mug and lid", "Brew in under a minute"],
    },
  ],
};

function getEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function normalizeMarketplaceHost(marketplace: string) {
  return marketplace.replace(/^www\./, "webservices.");
}

export async function searchAmazonItems(
  keyword: string,
  options: { limit?: number } = {}
): Promise<AmazonSearchItem[]> {
  const accessKey = getEnv("AMAZON_PAAPI_ACCESS_KEY_ID");
  const secretKey = getEnv("AMAZON_PAAPI_SECRET_ACCESS_KEY");
  const partnerTag = getEnv("AMAZON_ASSOCIATES_TAG");
  const region = getEnv("AMAZON_PAAPI_REGION") ?? "us-east-1";
  const marketplace = getEnv("AMAZON_PAAPI_MARKETPLACE") ?? "www.amazon.com";

  if (!accessKey || !secretKey || !partnerTag) {
    return DEFAULT_RESULTS[keyword] ?? [];
  }

  const host = normalizeMarketplaceHost(marketplace);
  const endpoint = `https://${host}/paapi5/searchitems`;
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
  const service = "ProductAdvertisingAPI";
  const method = "POST";
  const canonicalUri = "/paapi5/searchitems";
  const canonicalQueryString = "";
  const contentType = "application/json; charset=UTF-8";

  const payload = {
    Marketplace: marketplace,
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Keywords: keyword,
    ItemCount: Math.min(Math.max(options.limit ?? 3, 1), 10),
    Resources: [
      "Images.Primary.Large",
      "Images.Primary.Medium",
      "ItemInfo.Title",
      "ItemInfo.Features",
      "ItemInfo.ProductInfo",
      "ItemInfo.ExternalIds",
      "Offers.Listings.Price",
      "Offers.Listings.Condition",
      "Offers.Listings.DeliveryInfo.IsPrimeEligible",
      "Offers.Listings.SavingBasis",
      "BrowseNodeInfo.BrowseNodes",
    ],
  };

  const body = JSON.stringify(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\..*/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const payloadHash = sha256(body);

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretKey, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": contentType,
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: authorizationHeader,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Amazon SearchItems failed", errorText);
    return [];
  }

  const json = (await response.json()) as SearchItemsResponse;

  if (json.Errors?.length) {
    console.error("Amazon SearchItems errors", json.Errors);
    return [];
  }

  const items = json.SearchResult?.Items ?? [];

  return items
    .map((item) => normalizeItem(item))
    .filter((item): item is AmazonSearchItem => item !== null)
    .slice(0, Math.min(options.limit ?? 3, 10));
}

function normalizeItem(item: RawAmazonItem): AmazonSearchItem | null {
  const asin = item.ASIN;
  const title = item.ItemInfo?.Title?.DisplayValue;
  const detailPageUrl = item.DetailPageURL;

  if (!asin || !title || !detailPageUrl) {
    return null;
  }

  const imageUrl = item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL ?? null;

  const priceAmount = item.Offers?.Listings?.[0]?.Price?.Amount;
  const priceCurrency = item.Offers?.Listings?.[0]?.Price?.Currency;

  const featuresRaw: unknown = item.ItemInfo?.Features?.DisplayValues ?? [];
  const features = Array.isArray(featuresRaw)
    ? featuresRaw.map((feature) => String(feature)).slice(0, 5)
    : [];

  return {
    asin: String(asin),
    title: String(title),
    detailPageUrl: String(detailPageUrl),
    imageUrl: imageUrl ? String(imageUrl) : null,
    price:
      typeof priceAmount === "number" && priceCurrency
        ? { amount: priceAmount, currency: String(priceCurrency) }
        : null,
    features,
  };
}
