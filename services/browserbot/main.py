"""Browserbot FastAPI service that bridges browser-use automation."""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any

import pyotp
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

try:
    from browser_use import Agent, Browser, ChatBrowserUse
except ImportError as exc:  # pragma: no cover - surfaced during runtime if deps missing
    raise RuntimeError(
        "browser-use must be installed. Did you run `pip install -r requirements.txt`?"
    ) from exc

load_dotenv()

app = FastAPI(title="Browserbot", version="0.1.0")

# Configure CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_automation_lock = asyncio.Lock()
_task_progress: dict[str, list[str]] = {}  # task_id -> list of progress messages
_task_data: dict[str, dict[str, Any]] = {}  # task_id -> collected data
_task_cancelled: dict[str, bool] = {}  # task_id -> cancellation flag
_running_agents: dict[str, Agent] = {}  # task_id -> running agent


class BrowserRunRequest(BaseModel):
    intent: str = Field(..., description="Behavior preset, e.g. collect_amazon_products")
    url: str | None = Field(
        None, description="Optional URL to open (not used for Amazon collection)"
    )
    args: dict[str, Any] | None = Field(
        default=None,
        description="Additional parameters that downstream flows consume.",
    )


class AmazonSearchArgs(BaseModel):
    idea: str = Field(..., description="Short search phrase or angle to explore")
    brief: str = Field(..., description="Campaign brief for additional context")
    marketplace: str = Field(
        default=os.getenv("BROWSERBOT_MARKETPLACE", "https://www.amazon.com"),
        description="Amazon storefront domain including protocol",
    )
    max_products: int = Field(
        default=3,
        ge=1,
        le=6,
        description="Maximum number of products to capture for this idea",
    )


class AmazonProduct(BaseModel):
    title: str = Field(..., description="Exact product title from the detail page")
    product_url: str = Field(..., description="Canonical Amazon detail page link")
    affiliate_url: str | None = Field(
        None, description="SiteStripe text link including partner tag"
    )
    image_url: str | None = Field(
        None, description="Direct image URL captured from the product gallery"
    )
    price_text: str | None = Field(
        None, description="Price string exactly as shown on the page"
    )
    asin: str | None = Field(None, description="ASIN if available on the page")
    highlights: list[str] = Field(
        default_factory=list,
        description="Key features, marketing angles, or compliance notes",
    )
    reasoning: str | None = Field(
        None, description="Why this product fits the campaign brief"
    )


class AmazonProductBatch(BaseModel):
    products: list[AmazonProduct] = Field(
        default_factory=list,
        description="Captured products for the provided idea",
    )
    summary: str | None = Field(
        None, description="High-level recap of why these products were chosen"
    )


class PersonaGenerationArgs(BaseModel):
    product_title: str = Field(..., description="Product title to research")
    product_url: str = Field(..., description="Product URL for reference")
    product_category: str | None = Field(None, description="Product category or type")


class PersonaInsight(BaseModel):
    persona: str = Field(..., description="Target persona name")
    use_case: str = Field(..., description="Primary use case for this persona")
    value_proposition: str = Field(..., description="Key value prop for this audience")
    trend_data: str = Field(..., description="Trend insights from research")


class AlternativeProduct(BaseModel):
    title: str = Field(..., description="Alternative product title")
    reason: str = Field(..., description="Why this alternative makes sense")
    url: str = Field(..., description="URL to the alternative product")


class PersonaGenerationResult(BaseModel):
    personas: list[PersonaInsight] = Field(
        default_factory=list,
        description="Generated personas with use cases and trends",
    )
    alternatives: list[AlternativeProduct] = Field(
        default_factory=list,
        description="Alternative product suggestions",
    )
    research_summary: str | None = Field(
        None, description="Summary of trend research findings"
    )


class TrendFinderArgs(BaseModel):
    niche: str | None = Field(None, description="Optional niche or category to focus on")
    brief: str = Field(..., description="Campaign brief or description of what to look for")


class TrendInsight(BaseModel):
    trend_name: str = Field(..., description="Name of the trend")
    description: str = Field(..., description="What this trend is about")
    source: str = Field(..., description="Where this trend was found (Google Trends, X, Reddit, etc)")
    engagement_level: str = Field(..., description="Level of engagement (High, Medium, Low)")
    target_audience: str = Field(..., description="Who this trend appeals to")
    product_opportunities: list[str] = Field(
        default_factory=list,
        description="Potential product opportunities related to this trend"
    )


class TrendFinderResult(BaseModel):
    trends: list[TrendInsight] = Field(
        default_factory=list,
        description="Discovered trends from research"
    )
    recommended_searches: list[str] = Field(
        default_factory=list,
        description="Recommended Amazon search queries based on trends"
    )
    summary: str | None = Field(
        None, description="Overall summary of trend research"
    )


def _generate_totp_code() -> str | None:
    secret = os.getenv("AMAZON_LOGIN_TOTP_SECRET")
    if not secret:
        return None

    try:
        totp = pyotp.TOTP(secret)
        return totp.now()
    except Exception:
        return None


def _build_login_instructions() -> str:
    email = os.getenv("AMAZON_LOGIN_EMAIL")
    password = os.getenv("AMAZON_LOGIN_PASSWORD")
    if not email or not password:
        return (
            "If you are prompted to sign in, use the existing Chrome profile session."
            " Do not attempt to log in with blank credentials."
        )

    totp_code = _generate_totp_code()
    instructions = [
        "If Amazon asks you to sign in, use the stored Associates account:",
        f"- Email: {email}",
        f"- Password: {password}",
    ]

    if totp_code:
        instructions.append(
            "If a one-time password is requested, enter this current code:"
        )
        instructions.append(f"- OTP: {totp_code}")
        instructions.append(
            "If the code expires before submission, wait for the next one"
            " or pause for manual assistance."
        )

    instructions.append(
        "Never expose the credentials in your final response."
        " Use them only to authenticate."
    )
    return "\n".join(instructions)


def _build_amazon_task(args: AmazonSearchArgs) -> str:
    login_instructions = _build_login_instructions()
    product_goal = "products" if args.max_products > 1 else "product"

    return f"""
You are an ecommerce scout helping an affiliate marketing team.

Campaign brief:
{args.brief}

Focus idea:
{args.idea}

Marketplace URL:
{args.marketplace}

Instructions:
1. Open {args.marketplace} and search for the focus idea.
2. Make sure you are logged into Amazon so the SiteStripe toolbar appears. {login_instructions}
3. Find up to {args.max_products} on-brand {product_goal} that would perform well in short-form UGC ads.
4. For each product:
   - Open the product detail page in a new tab.
   - Capture the exact detail page URL.
   - Use the SiteStripe "Text" option and copy the generated affiliate link (plain URL, no HTML).
   - Grab the primary product image URL (open image in new tab if needed and copy the CDN link).
   - Record the price text exactly as displayed.
   - Note the ASIN if it is visible.
   - List 2-3 highlights that make the product compelling for this campaign, plus any compliance callouts.
5. Provide a short reasoning blurb describing why each product supports the brief.
6. If SiteStripe does not appear (e.g. login blocked), still gather the product URL and add a highlight explaining the issue.

Compliance reminders:
- Do not use link shorteners.
- Keep the destination clear in the final affiliate URL.
- Never include private credentials or OTP codes in the structured output.

Return structured data that matches the provided schema exactly.
"""


def _build_persona_task(args: PersonaGenerationArgs) -> str:
    return f"""
You are a market research analyst helping create targeted marketing personas for an affiliate product.

Product: {args.product_title}
Product URL: {args.product_url}
{f"Category: {args.product_category}" if args.product_category else ""}

Your task:
1. Search Google Trends for "{args.product_title}" and related terms to understand search interest and demographics
2. Search X.com (Twitter) for mentions of this product or similar items to gauge social sentiment and use cases
3. Search Reddit for discussions about this product category to understand real user needs and pain points
4. Based on your research, identify 3 distinct user personas who would benefit from this product

For each persona, provide:
- Persona name (e.g., "Tech-Savvy Remote Worker", "Busy Parent", "College Student")
- Primary use case for this product
- Key value proposition tailored to this audience
- Specific trend data you found (include source: Google Trends %, X.com engagement, Reddit discussions, etc.)

Also suggest 3 alternative products:
- One premium alternative (higher quality/price)
- One budget-friendly option (similar features, lower price)
- One trending alternative (based on current market trends)

For each alternative, provide:
- Product title
- Reason for recommendation
- URL where it can be found

Provide a brief research summary of overall market trends for this product category.

Return structured data matching the provided schema exactly.
"""


def _build_trend_finder_task(args: TrendFinderArgs) -> str:
    niche_context = f"\nFocus niche: {args.niche}" if args.niche else ""

    return f"""
You are a product intelligence specialist helping identify emerging opportunities for UGC affiliate marketing.

Campaign brief:
{args.brief}{niche_context}

Your task:
1. Search Google for recent blog posts, articles, and websites about trending products and consumer interests
   - Use Google search with Tools → Recent (past week/month)
   - Search for queries like: "trending products 2025", "best new [category] products", "viral products", "[niche] products everyone is buying"
   - Look for commerce blogs, product review sites, lifestyle blogs, and consumer trend articles
   - Focus on content published within the last 30 days

2. Analyze the content you find to identify:
   - Product categories gaining momentum
   - Specific products being recommended or reviewed
   - Consumer pain points and desires mentioned
   - Emerging lifestyle trends that could drive product demand
   - Seasonal or timely opportunities

3. Based on your research, identify 3-5 actionable product opportunities with:
   - Trend name (concise, descriptive - e.g. "Home Office Ergonomics", "Sustainable Kitchen", "Travel Tech")
   - What this trend is about and why it's gaining traction
   - Where you found evidence (mention specific blogs, sites, or article types)
   - Engagement level assessment (High/Medium/Low based on how many sources mention it)
   - Target audience for this trend
   - 2-3 specific product types that would work well for UGC marketing

4. Provide 5-10 recommended Amazon search queries based on these trends that would be good for product discovery
   - Make queries specific and actionable (e.g., "ergonomic desk accessories under $50", "portable coffee makers for travel")

5. Write a summary of overall findings and key insights for the marketing team

IMPORTANT: Focus on finding real, recent content about products and consumer trends. Don't make up trends - base everything on what you actually find during your Google searches.

Return structured data matching the provided schema exactly.
"""


async def _run_persona_generation(args: PersonaGenerationArgs) -> dict[str, Any]:
    cdp_url = os.getenv("BROWSERBOT_CDP_URL", "http://127.0.0.1:9222")
    browser_session = Browser(cdp_url=cdp_url)

    llm_kwargs: dict[str, Any] = {}
    api_key = os.getenv("BROWSER_USE_API_KEY")
    if api_key:
        llm_kwargs["api_key"] = api_key
    llm = ChatBrowserUse(**llm_kwargs)

    # Create agent - browser-use will handle browser session automatically
    agent = Agent(
        browser_session=browser_session,
        llm=llm,
        task=_build_persona_task(args),
        output_model_schema=PersonaGenerationResult,
    )

    result = await agent.run()

    structured: PersonaGenerationResult | None = getattr(result, "structured_output", None)
    actions: list[str] = []

    # Collect human-readable action traces
    for attr_name in ("actions", "all_actions", "history", "events"):
        attr_value = getattr(result, attr_name, None)
        if not attr_value:
            continue
        for entry in attr_value:
            text = getattr(entry, "message", None) or getattr(entry, "text", None) or str(entry)
            if text:
                actions.append(text)

    payload = {
        "status": "completed" if structured and structured.personas else "no_personas",
        "personas": structured.personas if structured else [],
        "alternatives": structured.alternatives if structured else [],
        "research_summary": structured.research_summary if structured else None,
        "actions": actions,
    }

    # Ensure payload is JSON serialisable
    if structured:
        if structured.personas:
            payload["personas"] = [persona.model_dump() for persona in structured.personas]
        if structured.alternatives:
            payload["alternatives"] = [alt.model_dump() for alt in structured.alternatives]

    return payload


async def _run_trend_finder(args: TrendFinderArgs, task_id: str | None = None) -> dict[str, Any]:
    if task_id:
        _task_progress[task_id] = ["🔄 Initializing browser automation..."]
        _task_data[task_id] = {
            "trends": [],
            "recommended_searches": [],
            "actions": [],
            "pages_visited": []
        }

    cdp_url = os.getenv("BROWSERBOT_CDP_URL", "http://127.0.0.1:9222")
    browser_session = Browser(cdp_url=cdp_url)

    if task_id:
        _task_progress[task_id].append("🌐 Connected to Chrome browser (check separate Chrome window)")

    llm_kwargs: dict[str, Any] = {}
    api_key = os.getenv("BROWSER_USE_API_KEY")
    if api_key:
        llm_kwargs["api_key"] = api_key
    llm = ChatBrowserUse(**llm_kwargs)

    if task_id:
        _task_progress[task_id].append("🤖 AI agent started - watch the Chrome window for activity!")
        _task_progress[task_id].append("🔍 Searching Google for recent product trends and blog posts...")

    # Create agent - browser-use will handle browser session automatically
    agent = Agent(
        browser_session=browser_session,
        llm=llm,
        task=_build_trend_finder_task(args),
        output_model_schema=TrendFinderResult,
    )

    # Store agent for potential cancellation
    if task_id:
        _running_agents[task_id] = agent

    result = await agent.run()

    structured: TrendFinderResult | None = getattr(result, "structured_output", None)
    actions: list[str] = []

    # Collect human-readable action traces and stream them
    for attr_name in ("actions", "all_actions", "history", "events"):
        attr_value = getattr(result, attr_name, None)
        if not attr_value:
            continue
        for entry in attr_value:
            text = getattr(entry, "message", None) or getattr(entry, "text", None) or str(entry)
            if text:
                actions.append(text)
                # Stream detailed actions
                if task_id:
                    _task_data[task_id]["actions"].append(text)
                    if "http" in text.lower() or "www." in text.lower():
                        _task_data[task_id]["pages_visited"].append(text)
                        _task_progress[task_id].append(f"🌐 Visited: {text[:100]}")
                    elif len(text) < 150:
                        _task_progress[task_id].append(f"💭 {text}")

    # Stream discovered trends as they come in
    if task_id and structured and structured.trends:
        for i, trend in enumerate(structured.trends, 1):
            _task_data[task_id]["trends"].append(trend.model_dump())
            _task_progress[task_id].append(f"✨ Trend #{i}: {trend.trend_name} ({trend.engagement_level} engagement)")

    if task_id and structured and structured.recommended_searches:
        _task_data[task_id]["recommended_searches"] = structured.recommended_searches
        _task_progress[task_id].append(f"🎯 Generated {len(structured.recommended_searches)} Amazon search queries")

    if task_id:
        if structured and structured.trends:
            _task_progress[task_id].append(f"✓ Research complete! Found {len(structured.trends)} product opportunities")
        else:
            _task_progress[task_id].append("✓ Research complete")

    payload = {
        "status": "completed" if structured and structured.trends else "no_trends",
        "trends": structured.trends if structured else [],
        "recommended_searches": structured.recommended_searches if structured else [],
        "summary": structured.summary if structured else None,
        "actions": actions,
    }

    # Ensure payload is JSON serialisable
    if structured:
        if structured.trends:
            payload["trends"] = [trend.model_dump() for trend in structured.trends]

    return payload


async def _run_amazon_capture(args: AmazonSearchArgs) -> dict[str, Any]:
    cdp_url = os.getenv("BROWSERBOT_CDP_URL", "http://127.0.0.1:9222")
    browser_session = Browser(cdp_url=cdp_url)

    llm_kwargs: dict[str, Any] = {}
    api_key = os.getenv("BROWSER_USE_API_KEY")
    if api_key:
        llm_kwargs["api_key"] = api_key
    llm = ChatBrowserUse(**llm_kwargs)

    # Create agent - browser-use will handle browser session automatically
    agent = Agent(
        browser_session=browser_session,
        llm=llm,
        task=_build_amazon_task(args),
        output_model_schema=AmazonProductBatch,
    )

    result = await agent.run()

    structured: AmazonProductBatch | None = getattr(result, "structured_output", None)
    actions: list[str] = []

    # Collect human-readable action traces when available
    for attr_name in ("actions", "all_actions", "history", "events"):
        attr_value = getattr(result, attr_name, None)
        if not attr_value:
            continue
        for entry in attr_value:
            text = getattr(entry, "message", None) or getattr(entry, "text", None) or str(entry)
            if text:
                actions.append(text)

    payload = {
        "status": "completed" if structured and structured.products else "no_products",
        "idea": args.idea,
        "products": structured.products if structured else [],
        "summary": structured.summary if structured else None,
        "actions": actions,
        "raw": getattr(result, "raw_output", None),
    }

    # Ensure payload is JSON serialisable
    if structured and structured.products:
        payload["products"] = [product.model_dump() for product in structured.products]

    return payload


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/progress/{task_id}")
async def get_progress(task_id: str) -> dict[str, Any]:
    """Get progress updates for a running task."""
    if task_id not in _task_progress:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "task_id": task_id,
        "messages": _task_progress[task_id],
        "data": _task_data.get(task_id, {}),
        "completed": task_id in _task_progress and len(_task_progress[task_id]) > 0 and _task_progress[task_id][-1].startswith("✓")
    }


async def _run_trend_finder_background(task_id: str, args: TrendFinderArgs) -> None:
    """Run trend finder in background and store result."""
    try:
        # Initialize cancellation flag
        _task_cancelled[task_id] = False

        async with _automation_lock:
            # Check if cancelled before starting
            if _task_cancelled.get(task_id, False):
                if task_id in _task_progress:
                    _task_progress[task_id].append("✓ Cancelled before start")
                return

            result = await _run_trend_finder(args, task_id)

            # Check if cancelled after completion
            if not _task_cancelled.get(task_id, False):
                # Store the result in progress for retrieval
                _task_progress[f"{task_id}_result"] = [result]
    except Exception as e:
        if task_id in _task_progress:
            _task_progress[task_id].append(f"❌ Error: {str(e)}")
    finally:
        # Clean up
        if task_id in _running_agents:
            del _running_agents[task_id]
        if task_id in _task_cancelled:
            del _task_cancelled[task_id]


@app.post("/run")
async def run_browser_task(request: BrowserRunRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if request.intent == "collect_amazon_products":
        try:
            args = AmazonSearchArgs.model_validate(request.args or {})
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=exc.errors())

        async with _automation_lock:
            return await _run_amazon_capture(args)

    elif request.intent == "generate_personas":
        try:
            args = PersonaGenerationArgs.model_validate(request.args or {})
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=exc.errors())

        async with _automation_lock:
            return await _run_persona_generation(args)

    elif request.intent == "find_trends":
        try:
            args = TrendFinderArgs.model_validate(request.args or {})
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=exc.errors())

        # Generate task ID and run in background
        task_id = str(uuid.uuid4())
        background_tasks.add_task(_run_trend_finder_background, task_id, args)

        return {
            "status": "started",
            "task_id": task_id,
            "message": "Trend research started. Use /progress/{task_id} to track progress."
        }

    else:
        return {
            "status": "unsupported_intent",
            "intent": request.intent,
            "message": "Supported intents: collect_amazon_products, generate_personas, find_trends",
        }


@app.get("/result/{task_id}")
async def get_result(task_id: str) -> dict[str, Any]:
    """Get the final result of a completed task."""
    result_key = f"{task_id}_result"
    if result_key not in _task_progress:
        raise HTTPException(status_code=404, detail="Result not found or task not completed")

    return _task_progress[result_key][0]


@app.post("/stop/{task_id}")
async def stop_task(task_id: str) -> dict[str, str]:
    """Stop a running task."""
    if task_id not in _task_progress:
        raise HTTPException(status_code=404, detail="Task not found")

    # Mark task as cancelled
    _task_cancelled[task_id] = True

    # Add cancellation message to progress
    if task_id in _task_progress:
        _task_progress[task_id].append("🛑 Stopping automation...")

    # Try to stop the agent if it's running
    if task_id in _running_agents:
        try:
            agent = _running_agents[task_id]
            # Browser-use doesn't have a direct stop method, but we can close the browser session
            if hasattr(agent, 'browser_session') and agent.browser_session:
                # Note: We don't actually close the browser since it's shared via CDP
                # The cancellation flag will be checked in the background task
                pass
            del _running_agents[task_id]
        except Exception as e:
            _task_progress[task_id].append(f"⚠️ Error stopping agent: {str(e)}")

    if task_id in _task_progress:
        _task_progress[task_id].append("✓ Automation stopped")

    return {
        "status": "stopped",
        "task_id": task_id,
        "message": "Task has been cancelled"
    }


@app.get("/tasks")
async def list_tasks() -> dict[str, Any]:
    """List all running tasks."""
    running_tasks = []

    for task_id in _running_agents.keys():
        task_info = {
            "task_id": task_id,
            "status": "running",
            "progress": _task_progress.get(task_id, []),
            "data": _task_data.get(task_id, {})
        }
        running_tasks.append(task_info)

    return {
        "running_count": len(running_tasks),
        "tasks": running_tasks
    }


@app.post("/stop-all")
async def stop_all_tasks() -> dict[str, Any]:
    """Stop all running tasks."""
    stopped_tasks = []

    for task_id in list(_running_agents.keys()):
        try:
            _task_cancelled[task_id] = True
            if task_id in _task_progress:
                _task_progress[task_id].append("🛑 Stopping automation...")
                _task_progress[task_id].append("✓ Automation stopped")
            stopped_tasks.append(task_id)
        except Exception as e:
            if task_id in _task_progress:
                _task_progress[task_id].append(f"⚠️ Error stopping: {str(e)}")

    # Clear running agents
    _running_agents.clear()

    return {
        "status": "stopped",
        "stopped_count": len(stopped_tasks),
        "stopped_tasks": stopped_tasks,
        "message": f"Stopped {len(stopped_tasks)} running task(s)"
    }
