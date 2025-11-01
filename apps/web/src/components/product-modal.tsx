"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ProductRecord } from "./live-dashboard";

type ProductModalProps = {
  product: ProductRecord | null;
  onClose: () => void;
};

type PersonaInsight = {
  persona: string;
  useCase: string;
  valueProposition: string;
  trendData: string;
};

type AlternativeProduct = {
  title: string;
  reason: string;
  url: string;
};

type VideoPrompt = {
  id: string;
  prompt: string;
  duration: string;
  style: string;
};

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function ProductModal({ product, onClose }: ProductModalProps) {
  const [personas, setPersonas] = useState<PersonaInsight[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeProduct[]>([]);
  const [videos, setVideos] = useState<VideoPrompt[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!product) return;

    const generatePersonas = async () => {
      setIsGenerating(true);

      try {
        const response = await fetch("http://127.0.0.1:8001/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            intent: "generate_personas",
            args: {
              product_title: product.title,
              product_url: product.url,
              product_category: parseJsonList(product.tags)[0] || "general",
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();

          if (data.personas && data.personas.length > 0) {
            setPersonas(data.personas.map((p: any) => ({
              persona: p.persona,
              useCase: p.use_case,
              valueProposition: p.value_proposition,
              trendData: p.trend_data,
            })));
          }

          if (data.alternatives && data.alternatives.length > 0) {
            setAlternatives(data.alternatives);
          }
        } else {
          // Fallback to mock data if API fails
          console.warn("Persona generation API failed, using fallback data");
          setPersonas([
            {
              persona: "Tech-Savvy Remote Worker",
              useCase: "Home office productivity enhancement",
              valueProposition: "Streamlines workflow and reduces desk clutter",
              trendData: "📈 Research pending - enable browser automation",
            },
            {
              persona: "Busy Parent",
              useCase: "Quick solutions for household organization",
              valueProposition: "Saves time and simplifies daily routines",
              trendData: "🔥 Research pending - enable browser automation",
            },
            {
              persona: "College Student",
              useCase: "Dorm room space optimization",
              valueProposition: "Affordable and practical for small spaces",
              trendData: "💬 Research pending - enable browser automation",
            },
          ]);

          setAlternatives([
            {
              title: "Premium Alternative",
              reason: "Higher quality materials, better reviews",
              url: "#",
            },
            {
              title: "Budget-Friendly Option",
              reason: "Similar functionality at lower price point",
              url: "#",
            },
            {
              title: "Eco-Friendly Version",
              reason: "Sustainable materials, trending in green lifestyle",
              url: "#",
            },
          ]);
        }
      } catch (error) {
        console.error("Error generating personas:", error);
        // Use fallback data on error
        setPersonas([
          {
            persona: "General User",
            useCase: "Everyday use",
            valueProposition: "Practical and useful",
            trendData: "⚠️ Browser automation unavailable",
          },
        ]);
        setAlternatives([]);
      }

      // Generate video prompts (still mock for now)
      setVideos([
        {
          id: "1",
          prompt: `A fast-paced UGC video showing a remote worker unboxing ${product.title}, testing it in real-time, and showcasing its immediate benefits. Natural lighting, authentic reactions, close-up shots of key features. Ends with a satisfied nod and text overlay: 'Game changer ✨'`,
          duration: "30s",
          style: "Authentic UGC",
        },
        {
          id: "2",
          prompt: `Lifestyle montage featuring ${product.title} in various daily scenarios. Morning routine, work setup, evening relaxation. Upbeat music, smooth transitions, text overlays highlighting key benefits. Target audience: millennials and Gen Z professionals.`,
          duration: "15s",
          style: "Lifestyle Montage",
        },
        {
          id: "3",
          prompt: `Before/after comparison video. Left side shows struggle without ${product.title}, right side shows effortless solution with it. Split screen effect, contrasting music (chaotic vs calm). End with product close-up and CTA.`,
          duration: "20s",
          style: "Problem-Solution",
        },
      ]);

      setIsGenerating(false);
    };

    generatePersonas();
  }, [product]);

  if (!product) return null;

  const tags = parseJsonList(product.tags);
  const images = parseJsonList(product.images);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="relative h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="sticky top-4 right-4 float-right z-10 rounded-full bg-slate-800/90 p-2 text-white hover:bg-slate-700"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="space-y-6 p-8">
          {/* Product Header */}
          <div className="space-y-4">
            <h2 className="text-3xl font-bold text-white">{product.title}</h2>
            <div className="flex items-center gap-4">
              <span className="text-2xl font-semibold text-emerald-400">
                {product.priceCents
                  ? new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(product.priceCents / 100)
                  : "Check listing"}
              </span>
              <span className="text-sm text-slate-400">{product.merchant}</span>
            </div>
            {images.length > 0 && (
              <div className="flex gap-4 overflow-x-auto">
                {images.slice(0, 4).map((url, index) => (
                  <Image
                    key={index}
                    src={url}
                    alt={product.title}
                    width={200}
                    height={200}
                    className="h-48 w-48 flex-none rounded-lg border border-white/10 object-cover"
                  />
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <hr className="border-white/10" />

          {/* User Persona Insights */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">User Persona Insights</h3>
              {isGenerating && (
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Analyzing trends...
                </span>
              )}
            </div>
            <div className="space-y-4">
              {personas.map((persona, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-white/5 bg-slate-950/60 p-5 space-y-3"
                >
                  <h4 className="text-lg font-semibold text-emerald-400">{persona.persona}</h4>
                  <div className="space-y-2 text-sm text-slate-300">
                    <p>
                      <span className="font-semibold text-white">Use Case:</span> {persona.useCase}
                    </p>
                    <p>
                      <span className="font-semibold text-white">Value Proposition:</span>{" "}
                      {persona.valueProposition}
                    </p>
                    <p className="text-xs text-emerald-300">{persona.trendData}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-white/10" />

          {/* SORA2 Video Prompts */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-white">AI-Generated Video Concepts (SORA 2)</h3>
            <div className="space-y-4">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="rounded-xl border border-white/5 bg-slate-950/60 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                      {video.style}
                    </span>
                    <span className="text-xs text-slate-400">{video.duration}</span>
                  </div>
                  <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <div className="text-6xl">🎬</div>
                      <p className="text-sm text-slate-400">Video Placeholder</p>
                      <button className="rounded-full bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30">
                        Generate with SORA 2
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 italic">
                    <span className="font-semibold text-white">Prompt:</span> {video.prompt}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-white/10" />

          {/* Alternative Products */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-white">Alternative Product Suggestions</h3>
            <div className="space-y-3">
              {alternatives.map((alt, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-4"
                >
                  <div>
                    <h4 className="font-semibold text-white">{alt.title}</h4>
                    <p className="text-sm text-slate-400">{alt.reason}</p>
                  </div>
                  <a
                    href={alt.url}
                    className="rounded-full bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    View
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Affiliate Link */}
          {product.links.length > 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
              <a
                href={product.links[0].deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-lg font-semibold text-emerald-300 hover:text-emerald-200"
              >
                View Product on Amazon →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
