"""Browserbot FastAPI service that bridges browser-use automation."""
from __future__ import annotations

import asyncio
import os
from typing import Any

import pyotp
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError

try:
    from browser_use import Agent, Browser, ChatBrowserUse
except ImportError as exc:  # pragma: no cover - surfaced during runtime if deps missing
    raise RuntimeError(
        "browser-use must be installed. Did you run `pip install -r requirements.txt`?"
    ) from exc

load_dotenv()

app = FastAPI(title="Browserbot", version="0.1.0")

_automation_lock = asyncio.Lock()


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


async def _run_amazon_capture(args: AmazonSearchArgs) -> dict[str, Any]:
    cdp_url = os.getenv("BROWSERBOT_CDP_URL", "http://127.0.0.1:9222")
    browser = Browser(cdp_url=cdp_url)

    llm_kwargs: dict[str, Any] = {}
    api_key = os.getenv("BROWSER_USE_API_KEY")
    if api_key:
        llm_kwargs["api_key"] = api_key
    llm = ChatBrowserUse(**llm_kwargs)

    agent = Agent(
        browser=browser,
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


@app.post("/run")
async def run_browser_task(request: BrowserRunRequest) -> dict[str, Any]:
    if request.intent != "collect_amazon_products":
        return {
            "status": "unsupported_intent",
            "intent": request.intent,
            "message": "Only collect_amazon_products is implemented during Phase 0",
        }

    try:
        args = AmazonSearchArgs.model_validate(request.args or {})
    except ValidationError as exc:  # pragma: no cover - FastAPI handles formatting
        raise HTTPException(status_code=400, detail=exc.errors())

    async with _automation_lock:
        return await _run_amazon_capture(args)
