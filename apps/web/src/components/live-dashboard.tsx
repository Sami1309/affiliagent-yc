"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductModal } from "./product-modal";
import { checkSpelling } from "@/lib/hyperspell";

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
  const [activeTab, setActiveTab] = useState<'discovery' | 'videos'>('discovery');
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
  const [isCheckingSpelling, setIsCheckingSpelling] = useState(false);
  const [spellingCorrections, setSpellingCorrections] = useState<Array<{
    word: string;
    suggestions: string[];
    position: number;
  }>>([]);

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

  const handleSpellCheck = useCallback(async () => {
    if (!brief.trim() || isCheckingSpelling) return;

    setIsCheckingSpelling(true);
    try {
      const result = await checkSpelling(brief);
      setSpellingCorrections(result.corrections);

      if (result.corrections.length === 0) {
        setStatusMessage("No spelling errors found!");
      } else {
        setStatusMessage(`Found ${result.corrections.length} potential spelling issue${result.corrections.length === 1 ? "" : "s"}`);
      }
    } catch (error) {
      console.error("Spell check error:", error);
      setStatusMessage("Spell check unavailable");
    } finally {
      setIsCheckingSpelling(false);
    }
  }, [brief, isCheckingSpelling]);

  const handleApplyCorrection = useCallback((correction: { word: string; suggestions: string[]; position: number }) => {
    if (correction.suggestions.length === 0) return;

    const suggestion = correction.suggestions[0];
    const newBrief = brief.substring(0, correction.position) +
                     suggestion +
                     brief.substring(correction.position + correction.word.length);

    setBrief(newBrief);
    setSpellingCorrections((prev) =>
      prev.filter((c) => c.position !== correction.position)
    );
  }, [brief]);

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
    const creatives = products.flatMap((product) => product.creatives ?? []);
    const totalVideos = allVideos.length;

    return [
      {
        agent: "TrendFinder",
        title: "Trend Finder",
        headline: isFindingTrends
          ? "Analyzing trends..."
          : liveData.trends?.length
          ? `${liveData.trends.length} trend${liveData.trends.length === 1 ? "" : "s"}`
          : "Ready to analyze",
        meta: "Web research • AI analysis",
        highlights: liveData.trends?.slice(0, 3).map((trend: any) =>
          `${trend.trend_name} • ${trend.engagement_level}`
        ) || [],
        feedbackTo: "ProductFinder",
        learnsFrom: "VideoAgent",
      },
      {
        agent: "ProductFinder",
        title: "Product Finder",
        headline: `${products.length} product${products.length === 1 ? "" : "s"}`,
        meta: "Amazon discovery • Smart filtering",
        highlights: products.slice(0, 3).map((product) => {
          const tags = parseJsonList(product.tags).slice(0, 1);
          return `${product.title.slice(0, 40)}${product.title.length > 40 ? "..." : ""}${tags.length ? ` • ${tags[0]}` : ""}`;
        }),
        feedbackTo: "PersonaGenerator",
        learnsFrom: "TrendFinder",
      },
      {
        agent: "PersonaGenerator",
        title: "Persona Generator",
        headline: `${selectedProductsForVideo.size} persona${selectedProductsForVideo.size === 1 ? "" : "s"}`,
        meta: "AI personas • Target audiences",
        highlights: allVideos.slice(0, 3).map((video) =>
          `${video.personaName} • ${video.targetPlatforms.join(", ")}`
        ),
        feedbackTo: "VideoAgent",
        learnsFrom: "ProductFinder",
      },
      {
        agent: "VideoAgent",
        title: "Video Agent",
        headline: isGeneratingVideo
          ? "Generating..."
          : totalVideos
          ? `${totalVideos} video${totalVideos === 1 ? "" : "s"}`
          : "Ready to create",
        meta: "SORA 2 • UGC content",
        highlights: allVideos.slice(0, 3).map((video) =>
          `${video.strategyOverview.slice(0, 50)}...`
        ),
        feedbackTo: "TrendFinder",
        learnsFrom: "PersonaGenerator",
      },
    ];
  }, [products, liveData, isFindingTrends, allVideos, selectedProductsForVideo, isGeneratingVideo]);

  return (
    <main className="min-h-screen bg-[#0a0a0b] flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-zinc-800/50 bg-[#0a0a0b] sticky top-0 h-screen flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-medium text-white">Affiliate Autopilot</h1>
              <p className="text-xs text-zinc-500">AI-Powered Marketing</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('discovery')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
              activeTab === 'discovery'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-300'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Discovery</span>
            {products.length > 0 && (
              <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {products.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('videos')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
              activeTab === 'videos'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-300'
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Video Generator</span>
            {allVideos.length > 0 && (
              <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {allVideos.length}
              </span>
            )}
          </button>
        </nav>

        {/* Running Tasks Indicator */}
        {runningTasksCount > 0 && (
          <div className="p-4 border-t border-zinc-800/50">
            <button
              type="button"
              onClick={handleStopAllAutomations}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
            >
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
              Stop All ({runningTasksCount})
            </button>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">

        {/* Discovery Tab */}
        {activeTab === 'discovery' && (
          <>
        {/* Campaign Brief Section */}
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 backdrop-blur-sm">
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-zinc-200" htmlFor="campaign-brief">
                Campaign Brief
              </label>
              <p className="text-xs text-zinc-500">Describe your product discovery goals and target audience</p>
            </div>

            {/* Example prompts */}
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((prompt, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setBrief(prompt)}
                  className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
                >
                  {prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt}
                </button>
              ))}
            </div>

            <div className="relative">
              <textarea
                id="campaign-brief"
                value={brief}
                onChange={(event) => {
                  setBrief(event.target.value);
                  setSpellingCorrections([]);
                }}
                placeholder="Example: Find trending home office products under $100 for remote workers..."
                className="w-full min-h-[100px] rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition"
              />
              <button
                type="button"
                onClick={handleSpellCheck}
                disabled={isCheckingSpelling || !brief.trim()}
                className="absolute top-3 right-3 flex items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Check spelling with Hyperspell"
              >
                {isCheckingSpelling ? (
                  <>
                    <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Checking
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Spell Check
                  </>
                )}
              </button>
            </div>

            {/* Spelling corrections */}
            {spellingCorrections.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Spelling suggestions
                </div>
                <div className="space-y-2">
                  {spellingCorrections.map((correction, index) => (
                    <div key={index} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-400">"{correction.word}"</span>
                        <span className="text-zinc-600">→</span>
                        <span className="text-amber-400">{correction.suggestions[0]}</span>
                      </div>
                      <button
                        onClick={() => handleApplyCorrection(correction)}
                        className="rounded px-2 py-1 text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex gap-2">
                {!isFindingTrends && !isRunningDiscovery ? (
                  <>
                    <button
                      type="button"
                      onClick={handleTrendFinder}
                      disabled={isSubmitting}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Research Trends
                    </button>
                    <button
                      type="button"
                      onClick={handleRun}
                      disabled={isSubmitting}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSubmitting ? "Starting..." : "Run Discovery"}
                    </button>
                  </>
                ) : (
                  <>
                    {isFindingTrends && (
                      <button
                        type="button"
                        onClick={handleStopAutomation}
                        className="rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
                      >
                        Stop Research
                      </button>
                    )}
                    {isRunningDiscovery && (
                      <button
                        type="button"
                        onClick={handleStopDiscovery}
                        className="rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
                      >
                        Stop Discovery
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${isPolling || isFindingTrends || isRunningDiscovery ? "bg-blue-500 animate-pulse" : "bg-zinc-700"}`} />
                <span>{isFindingTrends ? "Researching" : isRunningDiscovery ? "Discovering" : isPolling ? "Processing" : "Ready"}</span>
              </div>
            </div>
            {statusMessage ? <p className="text-xs text-zinc-400 bg-zinc-900/50 rounded px-3 py-2 border border-zinc-800">{statusMessage}</p> : null}

            {/* Live Browser Agent Activity */}
            {isFindingTrends && (
              <div className="mt-4 space-y-3">
                {/* Activity Log */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-2 w-2">
                        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                      </div>
                      <span className="text-sm font-medium text-zinc-200">Browser Agent</span>
                      <span className="text-xs text-zinc-500">Active</span>
                    </div>
                    {trendProgress.length === 0 && (
                      <span className="text-xs text-zinc-500">Initializing...</span>
                    )}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {trendProgress.length > 0 ? (
                      trendProgress.slice(-10).map((message, index) => (
                        <div key={index} className="text-xs text-zinc-400 font-mono">
                          {message}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-zinc-500">Connecting to browser...</div>
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

      {/* Discovered Trends Results - Always visible after completion */}
      {trendCompleted && liveData.trends && liveData.trends.length > 0 && (
        <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Market Research Results</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Trends discovered from web research
              </p>
            </div>
            <button
              onClick={() => {
                setTrendCompleted(false);
                setLiveData({ trends: [], recommended_searches: [], pages_visited: [] });
              }}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800/50"
            >
              Clear
            </button>
          </div>

          {/* Trends Grid */}
          <div className="grid gap-4 md:grid-cols-2 mb-6">
            {liveData.trends.map((trend: any, index: number) => (
              <div
                key={index}
                className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-base font-medium text-zinc-100">{trend.trend_name}</h4>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                    trend.engagement_level === "High"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      : trend.engagement_level === "Medium"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                  }`}>
                    {trend.engagement_level}
                  </span>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{trend.description}</p>
                <div className="space-y-1.5 text-xs">
                  <p className="text-zinc-500"><span className="font-medium text-zinc-400">Source:</span> {trend.source}</p>
                  <p className="text-zinc-500"><span className="font-medium text-zinc-400">Audience:</span> {trend.target_audience}</p>
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

      {/* AI Agents Workflow Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">AI Agent Workflow</h2>
            <p className="mt-1 text-sm text-zinc-500">Agents learn from each other through continuous feedback loops</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-blue-500"></div>
              <span>Active feedback</span>
            </div>
          </div>
        </div>

        <div className="relative">
          {/* Feedback loop connectors - curved lines between agents */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
            {/* TrendFinder → ProductFinder */}
            <path
              d="M 24% 50% Q 37% 20%, 50% 50%"
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="4 4"
              opacity="0.3"
            />
            {/* ProductFinder → PersonaGenerator */}
            <path
              d="M 50% 50% Q 62% 20%, 75% 50%"
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="4 4"
              opacity="0.3"
            />
            {/* PersonaGenerator → VideoAgent */}
            <path
              d="M 75% 50% Q 87% 20%, 100% 50%"
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="4 4"
              opacity="0.3"
            />
            {/* VideoAgent → TrendFinder (feedback loop) */}
            <path
              d="M 100% 60% Q 50% 90%, 0% 60%"
              stroke="#3b82f6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="4 4"
              opacity="0.2"
            />
          </svg>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 relative" style={{ zIndex: 1 }}>
            {stageData.map((stage, index) => (
              <article
                key={stage.agent}
                className="flex h-full flex-col justify-between rounded-xl border border-zinc-800/50 bg-zinc-900/20 backdrop-blur-sm p-5 transition hover:border-blue-500/30 hover:bg-zinc-900/40"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {/* Agent icon */}
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
                        {stage.agent === "TrendFinder" && (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                        )}
                        {stage.agent === "ProductFinder" && (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        )}
                        {stage.agent === "PersonaGenerator" && (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        )}
                        {stage.agent === "VideoAgent" && (
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        {stage.agent}
                      </div>
                    </div>

                    {/* Feedback indicator */}
                    <div className="flex items-center gap-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-zinc-100">{stage.title}</h3>
                  <p className="mt-1 text-sm text-blue-400">{stage.headline}</p>
                  <p className="mt-2 text-xs text-zinc-500">{stage.meta}</p>

                  {/* Learning feedback tags */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-[10px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      ← Learns from {stage.learnsFrom}
                    </span>
                    <span className="text-[10px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Improves {stage.feedbackTo} →
                    </span>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  {stage.highlights.length > 0 ? (
                    stage.highlights.slice(0, 2).map((highlight, idx) => (
                      <div key={`${stage.agent}-${idx}`} className="text-xs text-zinc-400 truncate" title={highlight}>
                        • {highlight}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-zinc-600">No activity yet</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-zinc-100">Products</h2>
            <p className="mt-1 text-sm text-zinc-500">Discovered products from Amazon</p>
          </div>
          <div className="space-y-3">
            {products.map((product) => {
              const tags = parseJsonList(product.tags);
              const images = parseJsonList(product.images);
              const isFresh = activeRunId ? product.sourceRunId === activeRunId : false;

              return (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`group w-full text-left rounded-lg border p-4 transition ${
                    isFresh
                      ? "border-blue-500/30 bg-blue-500/5"
                      : "border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-zinc-100 truncate">{product.title}</h3>
                        {isFresh && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">{product.merchant}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-300">{formatPrice(product.priceCents)}</span>
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
                  {tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tags.slice(0, 4).map((tag) => (
                        <span
                          key={`${product.id}-${tag}`}
                          className="rounded px-2 py-0.5 text-[11px] font-medium bg-zinc-800/50 text-zinc-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-zinc-500">
                      {product.links.length ? "Click to view details" : "Processing..."}
                    </span>
                    <svg className="h-4 w-4 text-zinc-600 group-hover:text-zinc-500 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          </>
        )}

        {/* Videos Tab */}
        {activeTab === 'videos' && (
          <>
      {/* Video UGC Section */}
      <section className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-zinc-100">Video Creator</h2>
          <p className="mt-1 text-sm text-zinc-500">Generate UGC-style product videos with SORA</p>
        </div>

        {/* Product Selection - Show ALL products with scrollable list */}
        <div className="space-y-4 mb-6">
          <h3 className="text-sm font-medium text-zinc-300">Select Product ({products.length} available)</h3>
          <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
            {products.map((product) => {
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
                  className={`flex items-center gap-4 p-3 rounded-lg border transition text-left ${
                    isSelected
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50 hover:border-zinc-700"
                  }`}
                >
                  {images.length > 0 && (
                    <Image
                      src={images[0]}
                      alt={product.title}
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-md border border-zinc-800 object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-zinc-100 truncate">{product.title}</h4>
                    <p className="text-xs text-zinc-500">{product.merchant}</p>
                  </div>
                  {isSelected && (
                    <div className="flex-shrink-0">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
                        <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
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
                className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGeneratingVideo ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </span>
                ) : (
                  "Generate Video"
                )}
              </button>
            )}
          </div>
        )}
      </section>
          </>
        )}

        </div>
      </div>

      {/* Product Modal - Outside tabs */}
      <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
    </main>
  );
}
