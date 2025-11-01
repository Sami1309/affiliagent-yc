# Affiliagent

**Your AI-powered affiliate marketing assistant that works while you sleep.**

**Smart AI Agents That Learn From Each Other**
- **Trend Finder**: Scours the web for emerging trends and consumer interests
- **Product Finder**: Discovers high-potential Amazon products matching current trends
- **Persona Generator**: Creates detailed target audience profiles for authentic marketing
- **Video Agent**: Generates UGC-style videos using cutting-edge SORA 2 technology

Each agent continuously learns from the others through feedback loops, improving recommendations with every campaign you run.

**Real-Time Browser Automation**
Watch live as our browser agent researches trends, navigates product pages, and gathers insights—all visible in your dashboard with real-time progress updates.

**Professional Video Content, Zero Production Time**
Generate authentic UGC-style videos for your products without cameras, actors, or editing software. Just select your products and let the AI create scroll-stopping content.

## Tech stack

- **Apps**: Next.js 16 (App Router) + Tailwind CSS v4.
- **Database**: SQLite via Prisma, file stored at `data/app.db`.
- **Services**: FastAPI stub for the upcoming browser-use helper (`services/browserbot`).

## Prerequisites

- Node.js 20+ and pnpm 10 (`corepack enable pnpm`).
- Python 3.11+ (for the browserbot service in later phases).

## Getting started

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

The app runs on <http://localhost:3000>. The dashboard renders:

- Four agent swimlane cards (DealHunter, LinkBuilder, CreativeChef, Publisher).
- A pipeline snapshot sourced from the seeded database records.
- A live run log fed by Prisma, automatically refreshing during discovery runs.

## Quick Start Guide

**Step 1: Set Up Your API Keys**
Copy your environment file and add your credentials:
```bash
cp .env.example .env.local
```
You'll need:
- Amazon Associates Tag (free to sign up)
- OpenAI API Key (for AI agents)
- FAL API Key (for video generation)
- Browser-Use API Key (for web automation)

**Step 2: Install & Launch**
```bash
pnpm install
pnpm db:push
pnpm dev
```

**Step 3: Create Your First Campaign**
1. Open `http://localhost:3001` in your browser
2. Describe what you're looking for (e.g., "Find trending kitchen gadgets under $50")
3. Click **Research Trends** and watch the AI agents work their magic
4. Select products you like and generate UGC videos instantly

That's it! The agents will research trends, discover products, and you can start creating content in minutes.

## Workspace layout

```
apps/web/                 # Next.js dashboard + API routes
  prisma/schema.prisma    # Phase 0 data model
  prisma/seed.ts          # Demo seed data
  src/app/api/run         # API stub to kick a pipeline run
  src/components          # Shared client components
  src/lib/prisma.ts       # Prisma singleton

services/browserbot/      # FastAPI shim for browser-use (Phase 1 target)
  main.py
  requirements.txt

data/app.db               # SQLite database (generated locally)
```

Copy environment examples before running the web app or browserbot service:

```bash
cp apps/web/.env.example apps/web/.env
cp services/browserbot/.env.example services/browserbot/.env
```

## Next steps

Follow `ROADMAP.md` for Phase 1 onwards:

1. Automate Amazon product discovery (SiteStripe + browserbot) and hydrate the `Product` table.
2. Replace the `/api/run` stub with worker orchestration.
3. Layer in fast-approval affiliate options (e.g. Skimlinks, Sovrn, ClickBank) for non-Amazon inventory.

Happy shipping!
