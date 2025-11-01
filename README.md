# Affiliate Auto-Pilot

Phase 0 scaffolding for the affiliate automation pipeline described in `ROADMAP.md`.

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

## Demo workflow

1. Drop your credentials into `apps/web/.env` (Amazon Associates tag + PA-API keys, OpenAI key, etc.).
2. Start the dev server with `pnpm --filter web dev`.
3. Enter a campaign brief in the dashboard and click **Run Discovery**.
4. Watch the LLM ideas, Amazon PA-API lookups, and SiteStripe links populate in real time.

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
