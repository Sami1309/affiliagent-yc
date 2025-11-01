
# Project name

**Affiliate Auto-Pilot** — “Find products → Make creatives → Post → Learn.”

---

# Architecture at a glance

* **Front end:** Next.js (App Router) + Tailwind. One dashboard that shows the 4 agent swimlanes + a run log.
* **Back end (Node):** Next.js API routes as the single backend. No extra server.
* **DB:** **SQLite** (via Prisma). Runs locally, zero setup; persists to `./data/app.db`.
* **Workers:** In-process queues (BullMQ or simple cron/JobRunner). Keep *one* Node runtime.
* **Storage:** Local `/public/creatives` during dev (swap to S3 later if needed).
* **Browser automations:** a tiny **Python helper** service just for **browser-use** tasks (FastAPI with `/run`). Everything else stays in Node. ([docs.browser-use.com][1])
* **External services:**

  * **Memory & context:** Hyperspell (store product summaries, prompts, performance “memories”). ([docs.hyperspell.com][2])
  * **Email ops:** AgentMail (create inboxes, receive OTPs/approvals, negotiate). ([docs.agentmail.to][3])
  * **Affiliate links:** Amazon Associates (SiteStripe today, PA-API after 3 sales) with Geniuslink localization, plus fast-approval backups (Skimlinks, Sovrn Commerce, ClickBank, Digistore24, eBay Partner Network, AliExpress via Admitad). ([amazon-associates][4]) ([geniuslink][5]) ([skimlinks][6]) ([sovrn][7]) ([clickbank][8]) ([digistore][9]) ([ebay-partner][10]) ([admitad][11])
  * **Click analytics:** Bitly API (shorten + per-link metrics for non-Amazon destinations). Skip shortening Amazon links to keep the destination clear. ([dev.bitly.com][12])
  * **Creative:** “Wow” path = Luma/Runway; **fallback** = **Remotion** slideshow + **ElevenLabs** TTS (guarantees a video every time). ([remotion.dev][13])
  * **Publishing:** YouTube Data API (Shorts are normal uploads) + Pinterest API v5 (affiliate links permitted; follow guidelines). ([Google for Developers][14]) ([Pinterest Developers][15])

---

# Monorepo layout

```
affiliate-autopilot/
├─ apps/web/                     # Next.js app (UI + API routes + workers)
│  ├─ app/                       # dashboard, runs, detail pages
│  ├─ app/api/                   # API routes
│  ├─ lib/                       # clients (Amazon/Geniuslink, Hyperspell, AgentMail, Bitly, YouTube, Pinterest)
│  ├─ workers/                   # job runners (deal-hunt, link-build, creative, publish, analyze)
│  ├─ creatives/                 # Remotion compositions (templates)
│  ├─ public/creatives/          # rendered MP4s, covers (dev only)
│  ├─ prisma/                    # schema.prisma (SQLite)
│  └─ .env.local
├─ services/browserbot/          # FastAPI + browser-use wrapper (Python 3.11+)
│  ├─ main.py
│  └─ requirements.txt
└─ data/app.db                   # SQLite file (dev)
```

---

# Data model (SQLite)

Use **Prisma** with SQLite. Columns are simple but cover attribution, creatives, and iteration loops.

```prisma
model Product {
  id         String   @id @default(cuid())
  title      String
  url        String
  merchant   String
  images     String   @default("[]") // JSON string of asset URLs
  priceCents Int?
  tags       String   @default("[]") // JSON string of topical tags
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  creatives  Creative[]
  links      AffiliateLink[]
}

model AffiliateLink {
  id        String   @id @default(cuid())
  productId String
  network   String   // 'amazon-associates' | 'geniuslink' | 'skimlinks' | 'sovrn' | 'clickbank' | 'ebay'
  deepLink  String
  subId     String
  shortLink String
  createdAt DateTime @default(now())

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
}

model Creative {
  id        String   @id @default(cuid())
  productId String
  type      String   // 'video' | 'image'
  script    String
  hook      String
  prompt    String
  assetUrl  String
  coverUrl  String?
  createdAt DateTime @default(now())

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  posts     Post[]
}

model Post {
  id         String   @id @default(cuid())
  creativeId String
  channel    String   // 'youtube' | 'pinterest'
  postUrl    String?
  status     String   // 'queued' | 'posted' | 'failed'
  createdAt  DateTime @default(now())

  creative   Creative @relation(fields: [creativeId], references: [id], onDelete: Cascade)
  metrics    Metric[]
}

model Metric {
  id           String   @id @default(cuid())
  postId       String
  subId        String
  source       String   // 'bitly' | 'amazon' | 'geniuslink' | 'skimlinks' | 'sovrn' | 'clickbank'
  clicks       Int?
  conversions  Int?
  revenueCents Int?
  capturedAt   DateTime @default(now())

  post         Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
}

model RunLog {
  id      String   @id @default(cuid())
  runId   String
  agent   String   // 'DealHunter' | 'LinkBuilder' | 'CreativeChef' | 'Publisher' | 'Analyst'
  level   String   // 'info' | 'warn' | 'error'
  message String
  at      DateTime @default(now())
}
```

---

# Agents & responsibilities (Amazon-first)

1. **DealHunter (Node worker)**

   * **Primary (Amazon):** Drive browser-use against Amazon listings to collect title, hero image, canonical URL, and key bullets. Use SiteStripe or PA-API once available. ([amazon-sitstripe][16])
   * **Fallback (fast approvals):** Pivot to Skimlinks/Sovrn catalogs, ClickBank marketplace feeds, or eBay Partner Network search when Amazon inventory is tapped out.
   * Persist `Product` rows, recording images/tags as JSON strings; mirror “memory” summaries into Hyperspell for downstream agents.

2. **LinkBuilder (Node worker)**

   * **Amazon flow:** Generate SiteStripe “Text” links, ensure the `tag` query param matches your Associate ID, and keep the destination obvious (no cloaking/opaque shorteners). ([amazon-compliance][17])
   * **Localization & routing:** Optionally pass the URL through Geniuslink to auto-swap store fronts while maintaining transparency.
   * **Fallback flow:** Use Skimlinks/Sovrn link-creation APIs, ClickBank hoplinks (`tid` for sub IDs), Digistore24 promo links (`affkey` + `subid`), or eBay Partner smart links. Store `network`, `deepLink`, and `subId` accordingly.
   * Keep Bitly for non-Amazon destinations where branded short links are acceptable.

3. **CreativeChef (Node worker)**

   * Pull product memories + link metadata to script UGC-style shorts.
   * Embed compliance reminders: mention prices only if fetched from PA-API; otherwise, direct viewers to the listing for current pricing.
   * Render via Remotion + ElevenLabs; optionally blend in Luma/Runway clips.

4. **Publisher & Analyst (Node worker)**

   * **Publish:** YouTube Shorts + Pinterest Pins with `#ad` disclosures and descriptive copy pointing to the Amazon (or fallback) link.
   * **Measure:**
     * Amazon: use the Performance Reports API after 3 qualifying sales or scrape dashboard exports via browser-use until API access unlocks.
     * Geniuslink, Skimlinks, Sovrn: poll their analytics endpoints for clicks/conversions by subID/tracking ID.
     * Bitly: track clicks for non-Amazon redirects.
   * Feed results back into Hyperspell and adjust creative/link variants with an ε-greedy explorer.

---

# Environment & keys

`.env.local` (web app)

```
DATABASE_URL="file:../data/app.db"
HYPERSPELL_API_KEY=...
AGENTMAIL_API_KEY=...
BITLY_TOKEN=...
AMAZON_ASSOCIATES_TAG=...
AMAZON_PAAPI_ACCESS_KEY=...
AMAZON_PAAPI_SECRET_KEY=...
AMAZON_PAAPI_PARTNER_TAG=...
GENIUSLINK_API_KEY=...
SKIMLINKS_SITE_ID=...
SOVRN_API_TOKEN=...
CLICKBANK_DEV_KEY=...
CLICKBANK_API_KEY=...
DIGISTORE24_API_KEY=...
EBAY_PARTNER_CAMPAIGN_ID=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN=...
PINTEREST_ACCESS_TOKEN=...
ELEVENLABS_API_KEY=...
# optional
LUMA_API_KEY=...
RUNWAY_API_KEY=...
```

`.env` (browserbot)

```
BROWSER_USE_API_KEY=...        # or Browserless token if you integrate via Browserless
```

Keep secrets minimal during Phase 0; Amazon links can be generated with SiteStripe manually while testing.

---

# Development roadmap (phased, minimal moving parts)

### Phase 0 — Bootstrap (1–2 hrs)

* Create Next.js app (`apps/web`) with Tailwind.
* Add Prisma + SQLite; generate schema & migrate to `data/app.db`.
* Stub UI: four cards + run log.
* Create `/api/run` to kick a pipeline job.

### Phase 1 — Deal sourcing (Amazon first, browser automation quickly after)

* Script browser-use to capture Amazon product metadata and SiteStripe links from a curated wishlist/spreadsheet.
* Introduce optional importers: Skimlinks product feeds, ClickBank top offers endpoint, eBay Partner search API.
* Surface “Add to pipeline” buttons per product in the dashboard.

### Phase 2 — Link building & compliance

* Store SiteStripe URLs with Associate tag + custom `subId` (e.g. `{agent}-{hook}-{channel}`).
* For non-Amazon links:
  * Skimlinks/Sovrn: use their “Create Link” endpoints, tracking conversions via their dashboards.
  * ClickBank: generate HopLinks with `tid` for attribution.
  * Digistore24: append `&subid=` for variations.
  * eBay Partner Network: leverage Smart Links/Bookmarklet and capture the `campid` + `customid`.
* Skip opaque shorteners for Amazon; retain Bitly for everything else.

### Phase 3 — Creative generation (always succeed)

* Wire Hyperspell memories; prompt for hooks, script, CTA, and compliance language.
* **Fallback path (ship first):** Remotion template + ElevenLabs voiceover, with captions that nudge viewers to “Tap for current price on Amazon.”
* **Wow path:** Luma/Runway footage blended into the Remotion timeline.

### Phase 4 — Publishing & compliance

* **YouTube Data API:** Upload Shorts with `#ad`, Amazon disclosure copy, and explicit destination mention.
* **Pinterest v5:** Create Pins referencing Amazon or fallback links, respecting Pinterest’s affiliate guidance.
* Streamline AgentMail-driven email sequences only for opted-in subscribers (Amazon requirement).

### Phase 5 — Metrics & iteration

* Amazon: scrape daily summary until Performance Reports API unlocks (needs 3 qualifying sales within 180 days). Map earnings to `Metric` rows.
* Geniuslink, Skimlinks, Sovrn, ClickBank, Digistore24, eBay Partner: poll their analytics for clicks/conversions keyed by your stored SubID/custom parameters.
* Bitly: continue fetching click counts for non-Amazon short links.
* UI: leaderboard by SubID (clicks, conversions, EPC) + Hyperspell “improvement briefs.”

### Phase 6 — Browser-use “wow” moments (optional but flashy)

* Stream a mini viewport as browser-use navigates SiteStripe or Skimlinks dashboards to prove automation.
* Add a “Negotiate” button: AgentMail drafts outreach to brands/affiliate managers requesting boosted commission or exclusive codes.

---

# API clients to wire (Node, minimal wrappers)

* **Amazon Associates Reporting / PA-API**: unlock once account passes 3-sale review for price + availability data. Until then, rely on SiteStripe exports. ([amazon-paapi][18])
* **Geniuslink**: link localization + analytics. ([geniuslink][5])
* **Skimlinks**: create-link + reporting endpoints. ([skimlinks][6])
* **Sovrn Commerce**: Merchandiser API & analytics. ([sovrn][7])
* **ClickBank**: Marketplace + Reporting APIs (HopLink tracking). ([clickbank][8])
* **Digistore24**: Reporting API for promo links. ([digistore][9])
* **eBay Partner Network**: Link Generator + Reporting. ([ebay-partner][10])
* **Hyperspell**: `memories.add`, `memories.query`, `memories.list`. ([docs.hyperspell.com][2])
* **AgentMail**: inbox management + messaging. ([docs.agentmail.to][3])
* **Bitly**: `POST /bitlinks`, analytics reads. ([dev.bitly.com][12])
* **YouTube**: upload Shorts (store refresh token). ([Google for Developers][14])
* **Pinterest v5**: OAuth + `POST /pins`. ([Pinterest Developers][15])
* **Remotion**: CLI or renderer. ([remotion.dev][13])
* **ElevenLabs**: TTS endpoint for VO. ([elevenlabs][19])
* **browser-use**: call Python `/run` with `{intent, args}` to perform scripted flows. ([docs.browser-use.com][1])

---

# Dashboard interactions (clear user story)

1. **Run new campaign** → DealHunter cards appear (Amazon or fast-approval products).
2. Click **“Pipeline”** → LinkBuilder shows SiteStripe link + SubID.
3. Click **“Render”** → CreativeChef preview with compliance overlays (“Pricing accurate at time of capture – check Amazon for updates”).
4. Click **“Publish”** → Post to YouTube + Pinterest; show live links.
5. **Metrics start ticking** (Bitly & network analytics). Leaderboard updates; “Iterate” spawns new variants.

---

# Test/seed scripts

* `pnpm db:seed` — inserts 3 sample products.
* `pnpm run:demo` — mock Bitly + network metrics to exercise the UI.
* `python services/browserbot/main.py` — local browser-use server.

---

# Guardrails (baked in)

* Always append “#ad / affiliate link” in descriptions/notes (FTC + platform compliance).
* Keep Amazon links transparent—no cloaking shorteners; use Geniuslink-branded domains if needed.
* Avoid hard-coding prices unless retrieved via PA-API or Amazon-rendered widgets.
* Email campaigns must be opt-in to satisfy Amazon Associates terms.
* Respect Pinterest developer & content guidelines; stick to quality and avoid spammy repetition. ([Pinterest Policy][20])

---

# Stretch (post-demo, still simple)

* Add automated Geniuslink localization with per-country tracking IDs.
* Expand publishing to Instagram Reels/TikTok once short-form poster is battle-tested.
* Add Negotiator agent using AgentMail to request exclusive codes or higher commission tiers from top-performing partners.

---

## Quick links you’ll use

* **Amazon Associates Operating Agreement & SiteStripe docs.** ([amazon-associates][4]) ([amazon-sitstripe][16])
* **Amazon Product Advertising API (PA-API).** ([amazon-paapi][18])
* **Geniuslink** quickstart + analytics. ([geniuslink][5])
* **Skimlinks** developer docs. ([skimlinks][6])
* **Sovrn Commerce** knowledge base. ([sovrn][7])
* **ClickBank** API reference. ([clickbank][8])
* **Digistore24** partner docs. ([digistore][9])
* **eBay Partner Network** help center. ([ebay-partner][10])
* **AliExpress via Admitad** onboarding. ([admitad][11])
* **Hyperspell**, **AgentMail**, **browser-use**, **Bitly**, **YouTube**, **Pinterest**, **Remotion**, **ElevenLabs** docs linked above.

---

If you want, I can output a **starter repo scaffold** (folders, Prisma schema, Next.js pages, Remotion template, and the Python `browserbot` server) so you can `pnpm i && pnpm dev` and start plugging in keys.

[1]: https://docs.browser-use.com/?utm_source=chatgpt.com "Browser Use: Introduction"
[2]: https://docs.hyperspell.com/api-reference/memories/list-memories?utm_source=chatgpt.com "List memories"
[3]: https://docs.agentmail.to/welcome?utm_source=chatgpt.com "Welcome | AgentMail | Documentation"
[4]: https://affiliate-program.amazon.com/help/operating/agreement?utm_source=chatgpt.com "Amazon Associates Operating Agreement"
[5]: https://help.geniuslink.com/hc/en-us?utm_source=chatgpt.com "Geniuslink Help Center"
[6]: https://developers.skimlinks.com/?utm_source=chatgpt.com "Skimlinks Developer Docs"
[7]: https://knowledge.sovrn.com/s/topic/0TO8W000000kAJKWA2/commerce?utm_source=chatgpt.com "Sovrn Commerce Knowledge Base"
[8]: https://support.clickbank.com/hc/en-us/categories/4412991100055-API-Integration?utm_source=chatgpt.com "ClickBank API Integration"
[9]: https://help.digistore24.com/hc/en-us/categories/4410764438172-For-Affiliates?utm_source=chatgpt.com "Digistore24 Help Center"
[10]: https://partnerhelp.ebay.com/?utm_source=chatgpt.com "eBay Partner Network"
[11]: https://admitad.com/en?utm_source=chatgpt.com "Admitad"
[12]: https://dev.bitly.com/api-reference?utm_source=chatgpt.com "Bitly API Reference"
[13]: https://www.remotion.dev/docs/render?utm_source=chatgpt.com "Render your video"
[14]: https://developers.google.com/youtube/v3/guides/uploading_a_video?utm_source=chatgpt.com "Upload a Video | YouTube Data API"
[15]: https://developers.pinterest.com/docs/api/v5/?utm_source=chatgpt.com "Pinterest API docs"
[16]: https://affiliate-program.amazon.com/help/operating/sitestripe?utm_source=chatgpt.com "Amazon SiteStripe Overview"
[17]: https://affiliate-program.amazon.com/help/node/topic/G2J7K4JHAYZLE6YD?utm_source=chatgpt.com "Amazon Associates Program Policies"
[18]: https://webservices.amazon.com/paapi5/documentation/?utm_source=chatgpt.com "Amazon Product Advertising API"
[19]: https://elevenlabs.io/docs/api-reference/text-to-speech/convert?utm_source=chatgpt.com "Create speech | ElevenLabs Documentation"
[20]: https://policy.pinterest.com/en/developer-guidelines?utm_source=chatgpt.com "Pinterest Developer guidelines"
