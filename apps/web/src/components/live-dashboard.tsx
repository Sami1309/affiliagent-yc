"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type AffiliateLinkRecord = {
  id: string;
  network: string;
  deepLink: string;
  subId: string;
  shortLink: string;
  createdAt: string;
};

export type CreativeRecord = {
  id: string;
  type: string;
  script: string;
  hook: string;
  prompt: string;
  assetUrl: string;
  coverUrl: string | null;
  createdAt: string;
  posts: Array<{
    id: string;
    channel: string;
    postUrl: string | null;
    status: string;
    createdAt: string;
  }>;
};

export type ProductRecord = {
  id: string;
  title: string;
  url: string;
  merchant: string;
  images: string;
  priceCents: number | null;
  tags: string;
  createdAt: string;
  updatedAt: string;
  sourceRunId: string | null;
  links: AffiliateLinkRecord[];
  creatives: CreativeRecord[];
};

export type RunLogRecord = {
  id: string;
  runId: string;
  agent: string;
  level: "info" | "warn" | "error" | string;
  message: string;
  at: string;
};

type LiveDashboardProps = {
  initialProducts: ProductRecord[];
  initialRunLogs: RunLogRecord[];
};

const DEFAULT_BRIEF =
  "Find impulse-friendly Amazon products under $60 that people would buy for quick home upgrades this week";

type CampaignPlan = {
  niche: string;
  summary: string;
  targetSegments: string[];
  marketingAngles: string[];
  searchIdeas: string[];
};

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch (error) {
    console.warn("Failed to parse JSON list", error);
    return [];
  }
}

function formatPrice(cents: number | null | undefined) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) {
    return "Check listing";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatTimestamp(inputISO: string) {
  const date = new Date(inputISO);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function uniqBy<T extends { id: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const record of records) {
    if (!seen.has(record.id)) {
      seen.add(record.id);
      output.push(record);
    }
  }
  return output;
}

function parsePlanMessage(message: string): CampaignPlan | null {
  if (!message.startsWith("PLAN::")) {
    return null;
  }

  try {
    const payload = JSON.parse(message.slice(6));

    const toList = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    };

    return {
      niche: String(payload.niche ?? "Amazon trend scouting").trim() || "Amazon trend scouting",
      summary: String(payload.summary ?? "Focus on fast-moving Prime-friendly finds.")
        .trim()
        .slice(0, 300),
      targetSegments: toList(payload.targetSegments ?? payload.target_segments),
      marketingAngles: toList(payload.marketingAngles ?? payload.marketing_angles),
      searchIdeas: toList(payload.searchIdeas ?? payload.search_queries),
    };
  } catch (error) {
    console.warn("Failed to parse campaign plan", error);
    return null;
  }
}

export function LiveDashboard({ initialProducts, initialRunLogs }: LiveDashboardProps) {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRecord[]>(initialProducts);
  const [runLogs, setRunLogs] = useState<RunLogRecord[]>(initialRunLogs);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isPolling = Boolean(activeRunId);

  const refreshFromServer = useCallback(() => {
    router.refresh();
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const productParams = new URLSearchParams({ limit: "12" });
        const logParams = new URLSearchParams({ limit: "30" });
        if (activeRunId) {
          logParams.set("runId", activeRunId);
        }

        const [productsRes, logsRes] = await Promise.all([
          fetch(`/api/products?${productParams.toString()}`, { cache: "no-store" }),
          fetch(`/api/run-logs?${logParams.toString()}`, { cache: "no-store" }),
        ]);

        if (cancelled) {
          return;
        }

        if (productsRes.ok) {
          const payload = (await productsRes.json()) as { products: ProductRecord[] };
          setProducts((prev) => uniqBy([...payload.products, ...prev]).slice(0, 20));
        }

        if (logsRes.ok) {
          const payload = (await logsRes.json()) as { logs: RunLogRecord[] };
          setRunLogs(payload.logs);

          if (
            activeRunId &&
            payload.logs.some(
              (log) =>
                log.runId === activeRunId &&
                /Run completed/i.test(log.message)
            )
          ) {
            setStatusMessage(`Run ${activeRunId.slice(0, 8)} completed.`);
            setActiveRunId(null);
            refreshFromServer();
          }
        }
      } catch (error) {
        console.error("Polling error", error);
      }
    };

    poll();
    const interval = setInterval(poll, activeRunId ? 2500 : 12000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRunId, refreshFromServer]);

  const handleRun = useCallback(async () => {
    if (!brief.trim()) {
      setStatusMessage("Please provide a campaign brief.");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ brief }),
      });

      if (!response.ok) {
        const { error } = (await response.json()) as { error?: string };
        setStatusMessage(error ?? "Unable to start run.");
        return;
      }

      const data = (await response.json()) as { runId: string };
      setActiveRunId(data.runId);
      setStatusMessage(`Run ${data.runId.slice(0, 8)} queued. Collecting products...`);
    } catch (error) {
      console.error("Failed to start pipeline", error);
      setStatusMessage("Unable to reach the pipeline endpoint.");
    } finally {
      setIsSubmitting(false);
    }
  }, [brief]);

  const strategyPlan = useMemo(() => {
    const relevantLogs = activeRunId
      ? runLogs.filter((log) => log.runId === activeRunId)
      : runLogs;

    for (const log of relevantLogs) {
      if (log.agent !== "Strategist") {
        continue;
      }
      const plan = parsePlanMessage(log.message);
      if (plan) {
        return plan;
      }
    }

    return null;
  }, [runLogs, activeRunId]);

  const stageData = useMemo(() => {
    const totalLinks = products.reduce((acc, product) => acc + product.links.length, 0);
    const creatives = products.flatMap((product) => product.creatives ?? []);
    const totalPosts = creatives.reduce((acc, creative) => acc + (creative.posts?.length ?? 0), 0);

    return [
      {
        agent: "DealHunter",
        title: "Deal Hunter",
        headline: `${products.length} product${products.length === 1 ? "" : "s"}`,
        meta: "Amazon + fast approvals",
        highlights: products.map((product) => {
          const tags = parseJsonList(product.tags).slice(0, 2);
          return `${product.title}${tags.length ? ` · ${tags.join(" / ")}` : ""}`;
        }),
      },
      {
        agent: "LinkBuilder",
        title: "Link Builder",
        headline: `${totalLinks} special link${totalLinks === 1 ? "" : "s"}`,
        meta: "Amazon Associates ready",
        highlights: products
          .filter((product) => product.links.length)
          .map((product) => `${product.merchant} → ${product.links[0]?.shortLink ?? "(missing)"}`),
      },
      {
        agent: "CreativeChef",
        title: "Creative Chef",
        headline: `${creatives.length} creative${creatives.length === 1 ? "" : "s"}`,
        meta: "Remotion fallback ready",
        highlights: creatives.map((creative) => `${creative.type.toUpperCase()} · ${creative.hook}`),
      },
      {
        agent: "Publisher",
        title: "Publisher",
        headline: `${totalPosts} post${totalPosts === 1 ? "" : "s"}`,
        meta: "YouTube + Pinterest",
        highlights: creatives.flatMap((creative) =>
          (creative.posts ?? []).map((post) => `${creative.type.toUpperCase()} · ${post.channel} (${post.status})`)
        ),
      },
    ];
  }, [products]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-emerald-400">Affiliate Auto-Pilot</p>
            <h1 className="mt-1 text-3xl font-semibold">Amazon Discovery Control Panel</h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-300">
            Brainstorm product ideas with the LLM, search Amazon via PA-API/SiteStripe, and watch affiliate links populate in real time. Keep the destination transparent to stay compliant.
          </p>
          <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-900/70 p-4">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="campaign-brief">
              Campaign Brief
            </label>
            <textarea
              id="campaign-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Describe the kind of campaign you want to run..."
              className="min-h-[96px] rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <button
                type="button"
                onClick={handleRun}
                disabled={isSubmitting}
                className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Queuing..." : "Run Discovery"}
              </button>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isPolling ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                <span>{isPolling ? "Collecting products" : "Idle"}</span>
              </div>
            </div>
            {statusMessage ? <p className="text-xs text-slate-300">{statusMessage}</p> : null}
          </div>
        </div>
      </header>

      {strategyPlan ? (
        <section className="grid gap-4 rounded-2xl border border-white/5 bg-slate-900/70 p-6 text-sm text-slate-200">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Campaign Strategy
            </span>
            <h2 className="text-2xl font-semibold text-white">{strategyPlan.niche}</h2>
            <p className="text-slate-300">{strategyPlan.summary}</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Target Segments
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {strategyPlan.targetSegments.length ? (
                  strategyPlan.targetSegments.map((segment) => (
                    <span
                      key={segment}
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200"
                    >
                      {segment}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500">Segments pending</span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Marketing Angles
              </h3>
              <div className="mt-2 flex flex-col gap-1 text-slate-200">
                {strategyPlan.marketingAngles.length ? (
                  strategyPlan.marketingAngles.map((angle) => (
                    <span key={angle}>• {angle}</span>
                  ))
                ) : (
                  <span className="text-slate-500">Angles pending</span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Search Queries
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {strategyPlan.searchIdeas.length ? (
                  strategyPlan.searchIdeas.map((idea) => (
                    <code
                      key={idea}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1 text-xs text-slate-200"
                    >
                      {idea}
                    </code>
                  ))
                ) : (
                  <span className="text-slate-500">Ideas pending</span>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stageData.map((stage) => (
          <article
            key={stage.agent}
            className="flex h-full flex-col justify-between rounded-2xl border border-white/5 bg-slate-900/70 p-5 shadow-lg shadow-emerald-500/5"
          >
            <div>
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                <span>{stage.agent}</span>
                <span>{stage.meta}</span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">{stage.title}</h2>
              <p className="mt-1 text-sm text-emerald-400">{stage.headline}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              {stage.highlights.length ? (
                stage.highlights.slice(0, 3).map((highlight, index) => (
                  <li key={`${stage.agent}-${index}`} className="truncate" title={highlight}>
                    • {highlight}
                  </li>
                ))
              ) : (
                <li className="text-slate-500">No activity yet.</li>
              )}
            </ul>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold text-white">Pipeline Products</h2>
          <p className="mt-1 text-sm text-slate-400">Latest products collected from ideas and Amazon searches.</p>
          <div className="mt-4 space-y-4">
            {products.map((product) => {
              const tags = parseJsonList(product.tags);
              const images = parseJsonList(product.images);
              const isFresh = activeRunId ? product.sourceRunId === activeRunId : false;

              return (
                <div
                  key={product.id}
                  className={`rounded-xl border border-white/5 bg-slate-950/60 p-4 transition ${
                    isFresh ? "ring-1 ring-emerald-400/70" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{product.title}</h3>
                        {isFresh ? (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                            New
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-400">{product.merchant}</p>
                    </div>
                    <span className="text-sm font-medium text-emerald-300">{formatPrice(product.priceCents)}</span>
                  </div>
                  {images.length ? (
                    <div className="mt-3 flex gap-3 overflow-x-auto">
                      {images.slice(0, 3).map((url, index) => (
                        <Image
                          key={`${product.id}-img-${index}`}
                          src={url}
                          alt={product.title}
                          width={80}
                          height={80}
                          className="h-20 w-20 flex-none rounded-lg border border-white/10 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 text-xs text-slate-400">
                    Sourced from run {product.sourceRunId ? product.sourceRunId.slice(0, 8) : "seed"} · {formatTimestamp(product.createdAt)}
                  </div>
                  {tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      {tags.slice(0, 5).map((tag) => (
                        <span
                          key={`${product.id}-${tag}`}
                          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 text-xs text-emerald-300">
                    {product.links.length ? (
                      <a
                        href={product.links[0].deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-dotted underline-offset-4"
                      >
                        View affiliate link
                      </a>
                    ) : (
                      <span>Affiliate link pending</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold text-white">Run Log</h2>
          <p className="mt-1 text-sm text-slate-400">
            {activeRunId
              ? `Streaming live events for run ${activeRunId.slice(0, 8)}.`
              : "Most recent activity across agents."}
          </p>
          <ul className="mt-4 space-y-3 text-sm">
            {runLogs.length ? (
              runLogs.map((log) => (
                <li
                  key={log.id}
                  className={`rounded-xl border border-white/5 bg-slate-950/60 p-3 ${
                    log.level === "error"
                      ? "border-red-500/40"
                      : log.level === "warn"
                      ? "border-amber-400/40"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span
                      className={`font-semibold ${
                        log.agent === "System" ? "text-slate-200" : "text-emerald-300"
                      }`}
                  >
                    {log.agent}
                  </span>
                  <span>{formatTimestamp(log.at)}</span>
                </div>
                {(() => {
                  const plan = parsePlanMessage(log.message);
                  if (!plan) {
                    return <p className="mt-1 text-sm text-slate-200">{log.message}</p>;
                  }

                  return (
                    <div className="mt-1 space-y-2 text-sm text-slate-200">
                      <p>Strategy generated for this run.</p>
                      <div className="text-xs text-slate-300">
                        <div>
                          <span className="font-semibold text-slate-200">Niche:</span> {plan.niche}
                        </div>
                        <div className="mt-1">
                          <span className="font-semibold text-slate-200">Segments:</span>{" "}
                          {plan.targetSegments.join(", ") || "(none)"}
                        </div>
                        <div className="mt-1">
                          <span className="font-semibold text-slate-200">Angles:</span>{" "}
                          {plan.marketingAngles.join(", ") || "(none)"}
                        </div>
                        <div className="mt-1">
                          <span className="font-semibold text-slate-200">Searches:</span>{" "}
                          {plan.searchIdeas.join(", ") || "(none)"}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-white/5 bg-slate-950/60 p-3 text-slate-500">
                Pipeline has not logged any runs yet.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}
