#!/usr/bin/env python3
"""
Quotex login helper — refreshes the auth token + cookies by performing a real
browser login via Playwright. This is the only reliable way to bypass Quotex's
Cloudflare bot protection, because the cf_clearance / __cf_bm cookies are
IP + TLS-fingerprint bound.

USAGE (on the SAME machine that runs the OTC engine mini-service):

    # Install dependencies (one-time)
    pip install playwright beautifulsoup4
    python -m playwright install firefox

    # Set credentials via env vars (don't hardcode them)
    export QX_EMAIL="your@email.com"
    export QX_PASSWORD="yourpassword"

    # Run the login (will write session.json next to this script)
    python3 scripts/qx-login.py

    # Or specify a custom output path
    python3 scripts/qx-login.py --output /path/to/session.json

    # Or use a non-headless browser to see what's happening
    python3 scripts/qx-login.py --headed

The script:
  1. Launches a real Firefox browser via Playwright (bypasses Cloudflare)
  2. Navigates to https://qxbroker.com/en/sign-in/
  3. Fills email + password, clicks "Sign In"
  4. Waits for redirect to /en/trade
  5. Extracts window.settings.token from the page (this is the auth token)
  6. Captures all cookies from the browser context
  7. Writes session.json in the format our OTC engine expects

After running this, restart the mini-service:
    bash mini-services/otc-engine/start.sh

Tokens expire after ~1-2 hours of inactivity. Re-run this script when that
happens (the engine will fall back to simulated mode automatically).
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed. Run:")
    print("  pip install playwright")
    print("  python -m playwright install firefox")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: beautifulsoup4 not installed. Run: pip install beautifulsoup4")
    sys.exit(1)


async def login_and_extract_token(email: str, password: str, headed: bool = False):
    """Login to Quotex and extract the auth token + cookies."""
    async with async_playwright() as p:
        # Use Firefox — it's less likely to be detected as a bot than Chromium
        browser = await p.firefox.launch(
            headless=not headed,
            firefox_user_prefs={
                'dom.webdriver.enabled': False,
                'useAutomationExtension': False,
            }
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            locale='en-US',
        )

        # Mask the webdriver navigator property
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)

        page = await context.new_page()

        print("[login] Navigating to https://qxbroker.com/en/sign-in/ ...")
        try:
            await page.goto("https://qxbroker.com/en/sign-in/", wait_until="networkidle", timeout=60000)
        except Exception as e:
            print(f"[login] Initial navigation warning: {e}")

        # Check if we hit a Cloudflare challenge
        title = await page.title()
        if "Just a moment" in title or "moment" in title.lower():
            print("[login] Cloudflare challenge detected — waiting for it to solve...")
            try:
                await page.wait_for_url("**/sign-in**", timeout=30000)
            except:
                pass
            # If there's a checkbox, click it
            try:
                checkbox = page.frame_locator('iframe').locator('input[type="checkbox"]')
                if await checkbox.count() > 0:
                    await checkbox.first.click()
                    await page.wait_for_load_state('networkidle', timeout=30000)
            except:
                pass

        print("[login] Filling in credentials...")
        try:
            # Try multiple selectors for the email field
            email_input = page.locator('input[type="email"], input[name="email"]').first
            await email_input.wait_for(state='visible', timeout=15000)
            await email_input.fill(email)

            # Password
            password_input = page.locator('input[type="password"], input[name="password"]').first
            await password_input.fill(password)

            # Find and click the sign-in button
            print("[login] Clicking Sign In button...")
            sign_in_btn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Entrar")').first
            await sign_in_btn.click()

            # Wait for redirect to /trade
            print("[login] Waiting for redirect to /trade ...")
            try:
                await page.wait_for_url("**/trade**", timeout=30000)
            except:
                # Maybe there's a PIN prompt — warn the user
                content = await page.content()
                if "PIN" in content or "pin" in content:
                    print("[login] ⚠️  Quotex is asking for an email PIN code.")
                    print("[login]     This script can't handle PIN prompts automatically.")
                    print("[login]     Disable PIN in your Quotex account settings, or use --headed")
                    print("[login]     to enter the PIN manually in the visible browser window.")
                    await browser.close()
                    return None
                # Otherwise just wait a bit longer
                await page.wait_for_load_state('networkidle', timeout=30000)

        except Exception as e:
            print(f"[login] Login form interaction failed: {e}")
            content = await page.content()
            print(f"[login] Page content snippet: {content[:500]}")
            await browser.close()
            return None

        # Now we should be on /trade — extract window.settings.token
        print("[login] Extracting auth token from page...")
        try:
            # Wait for the page to fully load (the inline script with window.settings
            # is rendered server-side, so it should be available immediately)
            await page.wait_for_load_state('networkidle', timeout=15000)
        except:
            pass

        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")

        # Find all inline scripts and look for window.settings
        token = None
        for script in soup.find_all("script", {"type": "text/javascript"}):
            text = script.get_text()
            if "window.settings" in text:
                # Extract the JSON object after "window.settings = "
                match = re.search(r'window\.settings\s*=\s*(\{.*?\})\s*;', text, re.DOTALL)
                if match:
                    try:
                        settings = json.loads(match.group(1))
                        token = settings.get("token")
                        if token:
                            print(f"[login] ✓ Token found: {token[:8]}... ({len(token)} chars)")
                            break
                    except json.JSONDecodeError as je:
                        print(f"[login] JSON parse error: {je}")

        if not token:
            print("[login] ✗ Could not extract token from page.")
            print(f"[login] Page title: {await page.title()}")
            print(f"[login] Page URL: {page.url}")
            # Save the HTML for debugging
            debug_path = Path('/tmp/qx-trade-page.html')
            debug_path.write_text(html)
            print(f"[login] Saved page HTML to {debug_path} for inspection.")
            await browser.close()
            return None

        # Get the user agent
        user_agent = await page.evaluate("() => navigator.userAgent")

        # Get all cookies
        cookies = await context.cookies()
        cookie_string = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
        print(f"[login] ✓ Captured {len(cookies)} cookies ({len(cookie_string)} chars)")

        await browser.close()

        return {
            "ssid": token,         # pyquotex convention — "ssid" field holds the token
            "token": token,        # also include as "token" for clarity
            "cookies": cookie_string,
            "user_agent": user_agent,
        }


async def main():
    parser = argparse.ArgumentParser(description="Refresh Quotex auth token via Playwright login")
    parser.add_argument('--output', '-o', default='session.json',
                        help='Output path for session.json (default: ./session.json)')
    parser.add_argument('--headed', action='store_true',
                        help='Show the browser window (for debugging / PIN entry)')
    parser.add_argument('--email', default=os.environ.get('QX_EMAIL', ''),
                        help='Quotex email (or set QX_EMAIL env var)')
    parser.add_argument('--password', default=os.environ.get('QX_PASSWORD', ''),
                        help='Quotex password (or set QX_PASSWORD env var)')
    args = parser.parse_args()

    if not args.email or not args.password:
        print("ERROR: Email and password required.")
        print("Set QX_EMAIL and QX_PASSWORD env vars, or use --email and --password flags.")
        sys.exit(1)

    print(f"[login] Email: {args.email}")
    print(f"[login] Output: {args.output}")
    print(f"[login] Headed: {args.headed}")
    print()

    session = await login_and_extract_token(args.email, args.password, headed=args.headed)
    if not session:
        print("\n[login] ✗ Login failed. See messages above.")
        sys.exit(1)

    # Write session.json
    output_path = Path(args.output)
    output_path.parent.mkdir(exist_ok=True, parents=True)
    output_path.write_text(json.dumps(session, indent=4))
    print(f"\n[login] ✓ Session written to {output_path.resolve()}")
    print()
    print("Next steps:")
    print("  1. Restart the OTC engine mini-service:")
    print("     bash mini-services/otc-engine/start.sh")
    print("  2. The engine will auto-detect session.json and use the live feed")
    print()
    print("If you want to use env vars instead of session.json, add these to .env:")
    print(f"  QX_TOKEN={session['token']}")
    print(f"  QX_COOKIES={session['cookies'][:80]}...")


if __name__ == '__main__':
    asyncio.run(main())
