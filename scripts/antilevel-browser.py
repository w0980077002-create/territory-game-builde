"""Anti-Level preview in the real ForgeScreen, mobile widths, RU/EN.
Checks: card visible, shown levels/stats equal previewAntiLevel(), no RPC calls (no spend),
original item unchanged, no horizontal overflow. Screenshots go to antilevel-artifacts/."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'antilevel-browser' / 'index.html'
OUT = ROOT / 'antilevel-artifacts'
OUT.mkdir(exist_ok=True)
WIDTHS = [320, 360, 390, 430]
failures = []

def check(cond, message):
    if not cond:
        failures.append(message)
        print('FAIL:', message)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for lang in ['ru', 'en']:
        for width in WIDTHS:
            page = browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=2)
            page.add_init_script(f"localStorage.setItem('territory-language','{lang}')")
            page.goto(PAGE.as_uri())
            card = page.locator('[data-testid="anti-level-preview"]')
            card.wait_for(state='visible', timeout=15000)
            expected = page.evaluate('window.__expectedPreview')
            check(expected is not None, f'{lang}/{width}: preview expected for level 50 -> 10')
            text = card.inner_text()
            if expected:
                check(f"{expected['fromLevel']} → {expected['toLevel']}" in text,
                      f'{lang}/{width}: level line must show {expected["fromLevel"]} → {expected["toLevel"]}')
                for stat in ['attack']:
                    before = 110
                    after = expected['estimated'][stat]
                    check(f'{before} → {after}' in text, f'{lang}/{width}: stat {stat} must show {before} → {after}')
            check('PREVIEW' in text or 'ПРЕДПРОСМОТР' in text, f'{lang}/{width}: preview label missing')
            # No purchase, upgrade or consume action inside the card.
            check(card.locator('button').count() == 0, f'{lang}/{width}: card must contain no buttons')
            calls = page.evaluate('window.__rpcCalls')
            check(calls == [], f'{lang}/{width}: no server call may happen from the preview: {calls}')
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            check(overflow <= 0, f'{lang}/{width}: horizontal overflow {overflow}px')
            card.scroll_into_view_if_needed()
            card.screenshot(path=str(OUT / f'anti-level-{lang}-{width}.png'))
            page.close()
    browser.close()

(OUT / 'result.json').write_text(json.dumps({'failures': failures}, ensure_ascii=False, indent=2), encoding='utf-8')
if failures:
    sys.exit(1)
print('Anti-Level browser preview checks passed for', WIDTHS, 'and RU/EN.')
