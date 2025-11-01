# AgentMail Amazon Discovery — Run Guide

This walkthrough explains how to run the end-to-end flow now that the browser-use agent is wired into the web dashboard.

## 1. Prep environment variables

1. Copy `apps/web/.env.example` → `.env.local` and set:
   - `DATABASE_URL` (already points at the bundled SQLite file).
   - `OPENAI_API_KEY` (required for the campaign strategist + idea generation).
   - Amazon Associates + PA-API keys.
   - `BROWSERBOT_URL` (defaults to `http://127.0.0.1:8001`).
2. Copy `services/browserbot/.env.example` → `.env` and provide:
   - `BROWSERBOT_CDP_URL` (usually `http://127.0.0.1:9222`).
   - Optional Amazon login credentials (`AMAZON_LOGIN_EMAIL`, `AMAZON_LOGIN_PASSWORD`, `AMAZON_LOGIN_TOTP_SECRET`). Use these only if you need the agent to log in; otherwise keep them empty and rely on an authenticated Chrome profile.
   - `BROWSER_USE_API_KEY` if you are using Browser Use cloud infrastructure (leave blank for local execution).

Keep real secrets out of version control—store them in a vault or `.env.local`/`.env` that stays on your machine.

## 2. Install the Python service

The browserbot service now ships with its own `pyproject.toml`, so `uv` can fetch everything in one shot:

```bash
cd services/browserbot
uv sync
```

This installs `browser-use`, FastAPI, uvicorn, python-dotenv, and pyotp. Re-run the command whenever requirements change.

## 3. Launch an authenticated Chrome session

The automation expects a Chrome instance with remote debugging:

```bash
cd shopping
python launch_chrome_debug.py --profile "Profile 1"
```

- Choose a profile that is already logged into Amazon Associates so the SiteStripe toolbar is visible.
- The script copies that profile to a temp directory, opens Chrome on port 9222, and cleans up when you exit.
- Leave this terminal running while the agent works.

If you’d rather log in programmatically, provide the Amazon credentials in `services/browserbot/.env` and skip the profile copy step.

## 4. Run the browserbot service

In a new terminal:

```bash
cd services/browserbot
uvicorn services.browserbot.main:app --reload --port 8001
```

The FastAPI `/run` endpoint now:
- Builds a campaign-specific task for browser-use.
- Reuses your Chrome debugging session (or the provided credentials) to capture SiteStripe links, product images, and pricing text.
- Returns structured JSON the web app can store.

Verify it’s healthy via `curl http://127.0.0.1:8001/healthz`.

## 5. Start the Next.js dashboard

```bash
cd apps/web
pnpm install   # once per machine
pnpm dev
```

Visit `http://localhost:3000`. The dashboard shows:
- **Campaign Strategy card** (new): the LLM strategist outlines the niche, target segments, angles, and the exact Amazon search queries it plans to run.
- **Agent stages**: DealHunter, LinkBuilder, CreativeChef, Publisher summaries.
- **Pipeline Products**: live product rows with images, price, tags, and affiliate links.
- **Run Log**: streaming events from Strategist, Browserbot, LinkBuilder, and System agents.

## 6. Kick off a discovery run

1. Enter a campaign brief (e.g. “Holiday-ready kitchen gadgets for Gen Z renters”).
2. Click **Run Discovery**.
3. Watch the flow:
   - Strategist generates the plan; the card updates instantly with niche, segments, angles, and search keywords.
   - Browserbot spins up, drives Amazon in Chrome, grabs SiteStripe text links, hero images, prices, and highlights, and streams progress back into the Run Log.
   - Products materialize in the Pipeline list in near real time. Fresh items from the active run are highlighted.
   - If browser automation fails (no Chrome, login blocked, etc.), the pipeline automatically falls back to the PA-API search client so the run still produces output.

## 7. Troubleshooting

- **Strategy card missing**: confirm `OPENAI_API_KEY` is set. Without it, the system falls back to a generic plan and still renders, but run logs will note the fallback.
- **No products appear**: make sure Chrome with remote debugging is running, you’re logged into Amazon, and `services/browserbot` is running. Check the Run Log for Browserbot warnings.
- **SiteStripe not visible**: Amazon sometimes requires a fresh login. Either log in manually in the debugging Chrome window or supply credentials/TOTP secret in the browserbot `.env`.
- **PA-API not returning prices**: until the Associates account reaches three qualifying sales, Amazon may throttle the API; the browser automation path is the primary source of data during demos.

With these steps, a single button press in the web app will activate the browser-use agent, display its strategy plan, and stream collected product data—including affiliate links—back into the dashboard.
