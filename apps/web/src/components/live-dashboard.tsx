"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductModal } from "./product-modal";

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
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [isFindingTrends, setIsFindingTrends] = useState(false);
  const [trendProgress, setTrendProgress] = useState<string[]>([]);
  const [trendTaskId, setTrendTaskId] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<any>({
    trends: [],
    recommended_searches: [],
    pages_visited: []
  });
  const [trendCompleted, setTrendCompleted] = useState(false);
  const [runningTasksCount, setRunningTasksCount] = useState(0);
  const [selectedProductsForVideo, setSelectedProductsForVideo] = useState<Set<string>>(new Set());
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedVideoData, setGeneratedVideoData] = useState<{
    videoUrl: string;
    personaImageUrl?: string;
    personaName: string;
    personaDescription: string;
    targetPlatforms: string[];
    strategyOverview: string;
  } | null>(null);
  const [allVideos, setAllVideos] = useState<Array<{
    id: string;
    videoUrl: string;
    personaImageUrl: string | null;
    personaName: string;
    personaDescription: string;
    targetPlatforms: string[];
    strategyOverview: string;
    createdAt: string;
  }>>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isRunningDiscovery, setIsRunningDiscovery] = useState(false);
  const [discoveryTaskId, setDiscoveryTaskId] = useState<string | null>(null);

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
          // Update products more efficiently - only add truly new ones
          setProducts((prev) => {
            const newProducts = payload.products.filter(
              (newProd) => !prev.some((p) => p.id === newProd.id)
            );
            return uniqBy([...newProducts, ...prev]).slice(0, 20);
          });
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
            setIsRunningDiscovery(false);
            setDiscoveryTaskId(null);
            refreshFromServer();
          }
        }
      } catch (error) {
        console.error("Polling error", error);
      }
    };

    poll();
    const interval = setInterval(poll, activeRunId ? 3000 : 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRunId, refreshFromServer]);

  // Poll for trend research progress
  useEffect(() => {
    if (!trendTaskId) return;

    let cancelled = false;

    const pollProgress = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:8001/progress/${trendTaskId}`);
        if (!response.ok) return;

        const data = await response.json();
        if (cancelled) return;

        setTrendProgress(data.messages || []);
        setLiveData(data.data || { trends: [], recommended_searches: [], pages_visited: [] });

        // Check if completed
        if (data.completed) {
          // Fetch the result and update live data one final time
          const resultResponse = await fetch(`http://127.0.0.1:8001/result/${trendTaskId}`);
          if (resultResponse.ok) {
            const result = await resultResponse.json();
            setLiveData(result);
            setStatusMessage("Trend research completed!");
          }
          setIsFindingTrends(false);
          setTrendCompleted(true);
          setTrendTaskId(null);
        }
      } catch (error) {
        console.error("Error polling progress:", error);
      }
    };

    pollProgress();
    const interval = setInterval(pollProgress, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trendTaskId]);

  const examplePrompts = [
    "Find tech gadgets perfect for remote workers and WFH setups under $50",
    "Discover trending kitchen gadgets and cooking tools for home chefs",
    "Find fitness and wellness products popular with millennials",
    "Eco-friendly home products and sustainable living essentials",
    "Pet products and accessories trending on social media",
  ];

  const handleRun = useCallback(async () => {
    if (!brief.trim()) {
      setStatusMessage("Please provide a campaign brief.");
      return;
    }

    // Check if any automation is already running
    if (isFindingTrends) {
      setStatusMessage("Please stop the trend search first.");
      return;
    }

    if (isRunningDiscovery) {
      setStatusMessage("Discovery is already running.");
      return;
    }

    setIsSubmitting(true);
    setIsRunningDiscovery(true);
    setStatusMessage("Starting product discovery...");

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
        setIsRunningDiscovery(false);
        return;
      }

      const data = (await response.json()) as { runId: string };
      setActiveRunId(data.runId);
      setDiscoveryTaskId(data.runId);
      setStatusMessage(`Run ${data.runId.slice(0, 8)} queued. Collecting products...`);
    } catch (error) {
      console.error("Failed to start pipeline", error);
      setStatusMessage("Unable to reach the pipeline endpoint.");
      setIsRunningDiscovery(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [brief]);

  const handleTrendFinder = useCallback(async () => {
    if (!brief.trim()) {
      setStatusMessage("Please provide a campaign brief.");
      return;
    }

    // Check if any automation is already running
    if (isRunningDiscovery) {
      setStatusMessage("Please stop the running discovery first.");
      return;
    }

    if (isFindingTrends) {
      setStatusMessage("Trend research is already running.");
      return;
    }

    setIsFindingTrends(true);
    setStatusMessage("Starting trend research...");
    setTrendProgress([]);
    setLiveData({ trends: [], recommended_searches: [], pages_visited: [] });
    setTrendCompleted(false);

    try {
      const response = await fetch("http://127.0.0.1:8001/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "find_trends",
          args: {
            brief: brief,
          },
        }),
      });

      if (!response.ok) {
        setStatusMessage("Trend finder failed. Please check browserbot service.");
        setIsFindingTrends(false);
        return;
      }

      const data = await response.json();
      if (data.task_id) {
        setTrendTaskId(data.task_id);
        setStatusMessage("Browser agent is researching trends...");
      } else {
        setStatusMessage("Failed to start trend research.");
        setIsFindingTrends(false);
      }
    } catch (error) {
      console.error("Failed to find trends", error);
      setStatusMessage("Unable to reach browserbot service.");
      setIsFindingTrends(false);
    }
  }, [brief]);

  const handleStopAutomation = useCallback(async () => {
    if (!trendTaskId) return;

    try {
      const response = await fetch(`http://127.0.0.1:8001/stop/${trendTaskId}`, {
        method: "POST",
      });

      if (response.ok) {
        setStatusMessage("Automation stopped.");
        setIsFindingTrends(false);
        setTrendTaskId(null);
      } else {
        setStatusMessage("Failed to stop automation.");
      }
    } catch (error) {
      console.error("Failed to stop automation", error);
      setStatusMessage("Error stopping automation.");
    }
  }, [trendTaskId]);

  const handleStopDiscovery = useCallback(async () => {
    // Stop all browser automations
    try {
      await fetch("http://127.0.0.1:8001/stop-all", {
        method: "POST",
      });
    } catch (error) {
      console.error("Error stopping browser automations:", error);
    }

    setIsRunningDiscovery(false);
    setActiveRunId(null);
    setDiscoveryTaskId(null);
    setStatusMessage("Discovery stopped.");
  }, []);

  const handleStopAllAutomations = useCallback(async () => {
    try {
      const response = await fetch("http://127.0.0.1:8001/stop-all", {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setStatusMessage(`Stopped ${data.stopped_count} automation(s).`);
        setIsFindingTrends(false);
        setTrendTaskId(null);
        setRunningTasksCount(0);
      } else {
        setStatusMessage("Failed to stop automations.");
      }
    } catch (error) {
      console.error("Failed to stop all automations", error);
      setStatusMessage("Error stopping automations.");
    }
  }, []);

  // Poll for running tasks count
  useEffect(() => {
    const pollTasks = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8001/tasks");
        if (response.ok) {
          const data = await response.json();
          setRunningTasksCount(data.running_count);
        }
      } catch (error) {
        // Silently fail - service might not be running
      }
    };

    pollTasks();
    const interval = setInterval(pollTasks, 3000);

    return () => clearInterval(interval);
  }, []);

  // Load videos when a product is selected
  useEffect(() => {
    const loadVideos = async () => {
      if (selectedProductsForVideo.size === 0) {
        setAllVideos([]);
        setCurrentVideoIndex(0);
        return;
      }

      const productId = Array.from(selectedProductsForVideo)[0];

      try {
        const response = await fetch(`/api/videos?productId=${productId}`);
        if (response.ok) {
          const data = await response.json();
          setAllVideos(data.videos || []);
          setCurrentVideoIndex(0);
        }
      } catch (error) {
        console.error("Failed to load videos:", error);
      }
    };

    loadVideos();
  }, [selectedProductsForVideo]);

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
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-400">Affiliate Auto-Pilot</p>
              <h1 className="mt-1 text-3xl font-semibold">Amazon Discovery Control Panel</h1>
            </div>
            {runningTasksCount > 0 && (
              <button
                type="button"
                onClick={handleStopAllAutomations}
                className="rounded-full border-2 border-red-500/70 bg-red-500/20 px-5 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-500/30"
              >
                🛑 Stop All Automations ({runningTasksCount})
              </button>
            )}
          </div>
          <div className="space-y-2">
            <p className="max-w-2xl text-sm text-slate-300">
              Brainstorm product ideas with the LLM, search Amazon via PA-API/SiteStripe, and watch affiliate links populate in real time. Keep the destination transparent to stay compliant.
            </p>
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <p className="text-xs text-yellow-200">
                <span className="font-semibold">⚠️ Browser Isolation:</span> To avoid the automation interfering with this dashboard, view this page in a <strong>different browser</strong> (Safari, Firefox, etc.) or a separate Chrome profile. The browser automation will run in the Chrome instance on port 9222.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-900/70 p-4">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="campaign-brief">
              Campaign Brief
            </label>

            {/* Example prompts */}
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((prompt, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setBrief(prompt)}
                  className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300 transition hover:border-emerald-500/50 hover:bg-slate-950/60 hover:text-emerald-300"
                >
                  {prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt}
                </button>
              ))}
            </div>

            <textarea
              id="campaign-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Describe the kind of campaign you want to run..."
              className="min-h-[96px] rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex gap-2">
                {!isFindingTrends && !isRunningDiscovery ? (
                  <>
                    <button
                      type="button"
                      onClick={handleTrendFinder}
                      disabled={isSubmitting}
                      className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Find Trends
                    </button>
                    <button
                      type="button"
                      onClick={handleRun}
                      disabled={isSubmitting}
                      className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Queuing..." : "Run Discovery"}
                    </button>
                  </>
                ) : (
                  <>
                    {isFindingTrends && (
                      <button
                        type="button"
                        onClick={handleStopAutomation}
                        className="rounded-full border border-red-500/50 bg-red-500/10 px-5 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                      >
                        🛑 Stop Trend Search
                      </button>
                    )}
                    {isRunningDiscovery && (
                      <button
                        type="button"
                        onClick={handleStopDiscovery}
                        className="rounded-full border border-red-500/50 bg-red-500/10 px-5 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                      >
                        🛑 Stop Discovery
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isPolling || isFindingTrends || isRunningDiscovery ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                <span>{isFindingTrends ? "Finding trends" : isRunningDiscovery ? "Running discovery" : isPolling ? "Collecting products" : "Idle"}</span>
              </div>
            </div>
            {statusMessage ? <p className="text-xs text-slate-300">{statusMessage}</p> : null}

            {/* Live Browser Agent Activity */}
            {isFindingTrends && (
              <div className="mt-4 space-y-3">
                {/* Activity Log */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                      <span className="text-sm font-semibold text-emerald-300">🤖 Browser Agent Live Activity</span>
                      <span className="text-xs text-slate-400">(Watch the Chrome window!)</span>
                    </div>
                    {trendProgress.length === 0 && (
                      <span className="text-xs text-slate-400 animate-pulse">Starting up...</span>
                    )}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {trendProgress.length > 0 ? (
                      trendProgress.slice(-10).map((message, index) => (
                        <div key={index} className="text-xs text-slate-300 font-mono animate-fadeIn">
                          {message}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 italic">Waiting for browser agent to connect...</div>
                    )}
                  </div>
                </div>

                {/* Live Discovered Trends */}
                {liveData.trends && liveData.trends.length > 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-slate-950/60 p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-emerald-300">✨ Trends Discovered ({liveData.trends.length})</h4>
                    <div className="space-y-2">
                      {liveData.trends.map((trend: any, index: number) => (
                        <div
                          key={index}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1 animate-slideIn"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-emerald-400">{trend.trend_name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              trend.engagement_level === "High"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : trend.engagement_level === "Medium"
                                ? "bg-yellow-500/20 text-yellow-300"
                                : "bg-slate-500/20 text-slate-300"
                            }`}>
                              {trend.engagement_level}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{trend.description}</p>
                          {trend.product_opportunities && trend.product_opportunities.length > 0 && (
                            <div className="text-xs text-slate-400">
                              💡 {trend.product_opportunities.length} product opportunities
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Searches */}
                {liveData.recommended_searches && liveData.recommended_searches.length > 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-slate-950/60 p-4 space-y-2">
                    <h4 className="text-sm font-semibold text-emerald-300">🎯 Amazon Search Queries ({liveData.recommended_searches.length})</h4>
                    <div className="flex flex-wrap gap-2">
                      {liveData.recommended_searches.map((search: string, index: number) => (
                        <span
                          key={index}
                          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 animate-fadeIn"
                        >
                          {search}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Discovered Trends Results - Always visible after completion */}
      {trendCompleted && liveData.trends && liveData.trends.length > 0 && (
        <section className="rounded-2xl border border-white/5 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">🔥 Trend Research Results</h2>
              <p className="mt-1 text-sm text-slate-400">
                Market insights discovered from recent web research
              </p>
            </div>
            <button
              onClick={() => {
                setTrendCompleted(false);
                setLiveData({ trends: [], recommended_searches: [], pages_visited: [] });
              }}
              className="rounded-lg border border-slate-500/50 bg-slate-950/60 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-950/80"
            >
              Clear Results
            </button>
          </div>

          {/* Trends Grid */}
          <div className="grid gap-4 md:grid-cols-2 mb-6">
            {liveData.trends.map((trend: any, index: number) => (
              <div
                key={index}
                className="rounded-xl border border-white/5 bg-slate-950/60 p-5 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <h4 className="text-lg font-semibold text-emerald-400">{trend.trend_name}</h4>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    trend.engagement_level === "High"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : trend.engagement_level === "Medium"
                      ? "bg-yellow-500/20 text-yellow-300"
                      : "bg-slate-500/20 text-slate-300"
                  }`}>
                    {trend.engagement_level}
                  </span>
                </div>
                <p className="text-sm text-slate-300">{trend.description}</p>
                <div className="grid gap-2 text-xs text-slate-400">
                  <p><span className="font-semibold text-white">Source:</span> {trend.source}</p>
                  <p><span className="font-semibold text-white">Target Audience:</span> {trend.target_audience}</p>
                </div>
                {trend.product_opportunities && trend.product_opportunities.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Product Opportunities</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-300">
                      {trend.product_opportunities.map((opp: string, oppIndex: number) => (
                        <li key={oppIndex} className="flex items-start gap-2">
                          <span className="text-emerald-400">•</span>
                          <span>{opp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Recommended Searches */}
          {liveData.recommended_searches && liveData.recommended_searches.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white">🎯 Recommended Amazon Searches</h3>
              <div className="flex flex-wrap gap-2">
                {liveData.recommended_searches.map((search: string, index: number) => (
                  <button
                    key={index}
                    onClick={() => setBrief(`Find products related to: ${search}`)}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition hover:border-emerald-500/50 hover:bg-emerald-500/20"
                  >
                    {search}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">Click a search query to use it in your discovery brief</p>
            </div>
          )}
        </section>
      )}

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
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`w-full text-left rounded-xl border border-white/5 bg-slate-950/60 p-4 transition hover:border-emerald-500/50 hover:bg-slate-950/80 cursor-pointer ${
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
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-emerald-300">
                      {product.links.length ? "View insights & analysis" : "Affiliate link pending"}
                    </span>
                    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
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

      <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />

      {/* Video UGC Section */}
      <section className="rounded-2xl border border-white/5 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Video UGC Creator</h2>
            <p className="mt-1 text-sm text-slate-400">Select products to create enticing UGC videos with SORA2</p>
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-3 mb-4">
          <h3 className="text-sm font-semibold text-slate-300">Select Products for Video</h3>
          <div className="grid gap-3">
            {products.slice(0, 6).map((product) => {
              const images = parseJsonList(product.images);
              const isSelected = selectedProductsForVideo.has(product.id);

              return (
                <button
                  key={product.id}
                  onClick={() => {
                    const newSet = new Set(selectedProductsForVideo);
                    if (isSelected) {
                      newSet.delete(product.id);
                    } else {
                      newSet.clear(); // Only allow one product at a time
                      newSet.add(product.id);
                    }
                    setSelectedProductsForVideo(newSet);
                  }}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition text-left ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-white/5 bg-slate-950/60 hover:border-emerald-500/50"
                  }`}
                >
                  {images.length > 0 && (
                    <Image
                      src={images[0]}
                      alt={product.title}
                      width={60}
                      height={60}
                      className="h-15 w-15 rounded-lg border border-white/10 object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-white">{product.title}</h4>
                    <p className="text-xs text-slate-400">{product.merchant}</p>
                  </div>
                  {isSelected && (
                    <svg className="h-6 w-6 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Video Generation */}
        {selectedProductsForVideo.size > 0 && (
          <div className="space-y-4">
            {/* Show saved videos if they exist, otherwise show generation button */}
            {allVideos.length > 0 || generatedVideoData ? (
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                {/* Video Display with Slideshow */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-emerald-300">
                      Generated Videos {allVideos.length > 0 && `(${currentVideoIndex + 1}/${allVideos.length})`}
                    </h3>
                    {allVideos.length > 1 && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCurrentVideoIndex((prev) => (prev > 0 ? prev - 1 : allVideos.length - 1))}
                          className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-950/80"
                        >
                          ← Previous
                        </button>
                        <button
                          onClick={() => setCurrentVideoIndex((prev) => (prev < allVideos.length - 1 ? prev + 1 : 0))}
                          className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-950/80"
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-emerald-500/30 bg-slate-950/60 p-4">
                    <video
                      key={allVideos[currentVideoIndex]?.id || generatedVideoData?.videoUrl}
                      src={(allVideos[currentVideoIndex] || generatedVideoData)?.videoUrl}
                      controls
                      className="w-full rounded-lg"
                      style={{ aspectRatio: "9/16", maxHeight: "600px" }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>

                  {/* Thumbnail slideshow if multiple videos */}
                  {allVideos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {allVideos.map((video, index) => (
                        <button
                          key={video.id}
                          onClick={() => setCurrentVideoIndex(index)}
                          className={`flex-shrink-0 rounded-lg border-2 transition ${
                            index === currentVideoIndex
                              ? "border-emerald-500"
                              : "border-white/10 hover:border-emerald-500/50"
                          }`}
                        >
                          <div className="relative h-24 w-16 overflow-hidden rounded-lg bg-slate-900">
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                              Video {index + 1}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setGeneratedVideoData(null);
                      }}
                      className="flex-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      Generate Another
                    </button>
                    <button
                      onClick={() => {
                        setGeneratedVideoData(null);
                        setSelectedProductsForVideo(new Set());
                        setAllVideos([]);
                        setCurrentVideoIndex(0);
                      }}
                      className="flex-1 rounded-full border border-slate-500/50 bg-slate-950/60 px-5 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-950/80"
                    >
                      Select Different Product
                    </button>
                  </div>
                </div>

                {/* Persona Sidebar */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-emerald-300">UGC Strategy</h3>

                  {/* Persona Image */}
                  {(allVideos[currentVideoIndex] || generatedVideoData)?.personaImageUrl && (
                    <div className="rounded-xl border border-white/5 bg-slate-950/60 p-4">
                      <Image
                        src={(allVideos[currentVideoIndex] || generatedVideoData)!.personaImageUrl!}
                        alt={(allVideos[currentVideoIndex] || generatedVideoData)!.personaName}
                        width={300}
                        height={300}
                        className="w-full rounded-lg"
                      />
                    </div>
                  )}

                  {/* Persona Info */}
                  <div className="rounded-xl border border-white/5 bg-slate-950/60 p-4 space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Persona</h4>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {(allVideos[currentVideoIndex] || generatedVideoData)?.personaName}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {(allVideos[currentVideoIndex] || generatedVideoData)?.personaDescription}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Target Platforms</h4>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(allVideos[currentVideoIndex] || generatedVideoData)?.targetPlatforms.map((platform) => (
                          <span
                            key={platform}
                            className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200"
                          >
                            {platform}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Strategy Overview</h4>
                      <p className="mt-1 text-xs text-slate-300">
                        {(allVideos[currentVideoIndex] || generatedVideoData)?.strategyOverview}
                      </p>
                    </div>

                    {allVideos[currentVideoIndex]?.createdAt && (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-xs text-slate-400">
                          Created {formatTimestamp(allVideos[currentVideoIndex].createdAt)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={async () => {
                  const selectedProductId = Array.from(selectedProductsForVideo)[0];
                  const selectedProduct = products.find(p => p.id === selectedProductId);

                  if (!selectedProduct) return;

                  setIsGeneratingVideo(true);

                  try {
                    const images = parseJsonList(selectedProduct.images);
                    const productImage = images.length > 0 ? images[0] : null;

                    const response = await fetch("/api/generate-video", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        productId: selectedProduct.id,
                        productTitle: selectedProduct.title,
                        productDescription: `${selectedProduct.title} - ${parseJsonList(selectedProduct.tags).join(", ")}`,
                        productImage: productImage,
                      }),
                    });

                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      console.error("Video generation failed:", errorData);
                      throw new Error(
                        errorData.details || errorData.error || "Failed to generate video"
                      );
                    }

                    const data = await response.json();

                    if (!data.videoUrl) {
                      throw new Error("No video URL returned from API");
                    }

                    // Reload videos from database to show the new one
                    const videosResponse = await fetch(`/api/videos?productId=${selectedProduct.id}`);
                    if (videosResponse.ok) {
                      const videosData = await videosResponse.json();
                      setAllVideos(videosData.videos || []);
                      setCurrentVideoIndex(0); // Show the newest video first
                    }

                    setGeneratedVideoData({
                      videoUrl: data.videoUrl,
                      personaImageUrl: data.personaImageUrl,
                      personaName: data.personaName,
                      personaDescription: data.personaDescription,
                      targetPlatforms: data.targetPlatforms,
                      strategyOverview: data.strategyOverview,
                    });
                  } catch (error) {
                    console.error("Error generating video:", error);
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    alert(`Failed to generate video: ${errorMessage}\n\nCheck the console for more details.`);
                  } finally {
                    setIsGeneratingVideo(false);
                  }
                }}
                disabled={isGeneratingVideo}
                className="w-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGeneratingVideo ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating Video & Persona with SORA2...
                  </span>
                ) : (
                  "🎬 Create Product Video with SORA2"
                )}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
