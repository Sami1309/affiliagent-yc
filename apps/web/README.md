# apps/web

Phase 0 dashboard for Affiliate Auto-Pilot. This package is managed via the root pnpm workspace.

## Running locally

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm --filter web dev
```

The app loads seeded data from `../data/app.db`. Update the Prisma schema or seed script as you progress through later roadmap phases.

## Available scripts

- `pnpm --filter web dev` – Next.js dev server
- `pnpm --filter web build` – Next.js production build
- `pnpm --filter web start` – Start the production build
- `pnpm --filter web lint` – Run linting via `next lint`
- `pnpm --filter web db:push` – Push Prisma schema to SQLite
- `pnpm --filter web db:seed` – Execute the demo seed script

The web app uses the App Router and Tailwind v4; shared utilities live in `src/lib` and client components in `src/components`.
