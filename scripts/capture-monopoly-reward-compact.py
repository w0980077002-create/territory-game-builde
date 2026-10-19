#!/usr/bin/env python3
"""Check real Monopoly reward popup against Telegram sheet heights on iOS + Android.
Local-only Monopoly React fixture. Does NOT touch live accounts or reward balances.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import sys

source = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/monopoly-visual-review.html").resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/monopoly-screenshots")
out.mkdir(parents=True, exist_ok=True)
if not source.exists():
    raise SystemExit("Missing offline fixture " + str(source))

sizes = [(320,740,560),(375,812,650),(393,852,690),(430,932,770)]
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    for platform in ["android","ios"]:
        for width,height,sheet_height in sizes:
            for scenario in ["gift","large","event"]:
                page = browser.new_page(viewport={"width":width,"height":height},device_scale_factor=1)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.route("https://**/*",lambda route: route.abort())
                try:
                    page.goto(source.as_uri())
                    page.locator(".mono-wallet b").wait_for()
                    page.wait_for_function("document.querySelector('.mono-wallet b')?.textContent === '16'")
                    # The real App makes the game shell before Monopoly mounts.
                    # Moving the local fixture before a dialog mounts is equivalent
                    # and allows the native portal to anchor to the measured shell.
                    page.evaluate("""({platform,sheet}) => {
                        const html=document.documentElement;
                        html.classList.add('territory-telegram-webapp');
                        html.classList.toggle('territory-ios-webapp',platform==='ios');
                        html.classList.remove('territory-desktop-webapp');
                        html.style.setProperty('--territory-viewport-height',sheet+'px');
                        html.style.setProperty('--territory-top-inset','0px');
                        html.style.setProperty('--territory-bottom-inset','0px');
                        const root=document.getElementById('root');
                        const host=document.createElement('div');
                        host.className='territory-shell';
                        host.style.cssText='position:relative;width:100%;margin:0 auto;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;';
                        host.style.height=sheet+'px';
                        const scroll=document.createElement('main');
                        scroll.style.cssText='flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;';
                        const nav=document.createElement('nav');
                        nav.style.cssText='flex:0 0 70px;min-height:70px;background:#101923;border-top:1px solid #d9b36a44;';
                        nav.setAttribute('aria-label','Game navigation fixture');
                        root.parentNode.insertBefore(host,root);
                        host.appendChild(scroll);
                        scroll.appendChild(root);
                        host.appendChild(nav);
                    }""", {"platform":platform,"sheet":sheet_height})
                    # Ignore entrance animation keyframes when measuring the final layout.
                    page.add_style_tag(content="*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}")
                    if scenario=="gift":
                        page.get_by_role("button",name="Подарки",exact=True).click()
                        page.get_by_role("button",name="ЗАБРАТЬ БЕСПЛАТНО",exact=True).click()
                    elif scenario=="large":
                        page.get_by_role("button",name="Спецпредложения",exact=True).click()
                        page.locator(".mono-quest").first.get_by_role("button",name="Забрать",exact=True).click()
                    else:
                        page.get_by_label("Пропустить анимацию").check()
                        page.get_by_role("button",name="Бросить кубик").click()
                    dialog = page.locator(".mono-celebration")
                    dialog.wait_for(state="visible",timeout=8000)
                    panel = page.locator(".mono-celebration > section")
                    panel.wait_for(state="visible",timeout=4000)
                    page.wait_for_timeout(100)
                    shell_rect = page.locator(".territory-shell").bounding_box()
                    rect = panel.bounding_box()
                    button = panel.get_by_role("button",name="ПРОДОЛЖИТЬ",exact=True)
                    cta = button.bounding_box()
                    assert rect and shell_rect and cta, "Missing popup or action coordinates"
                    assert rect["width"] <= 351, f"Popup too wide: {rect}"
                    assert rect["height"] <= 412, f"Popup too tall: {rect}"
                    assert rect["x"] >= shell_rect["x"] - 2, f"Popup outside shell left: {rect}"
                    assert rect["x"]+rect["width"] <= shell_rect["x"]+shell_rect["width"]+2, f"Popup outside shell right: {rect}"
                    assert rect["y"] >= shell_rect["y"] - 2, f"Popup hides above Telegram: {rect}"
                    assert rect["y"]+rect["height"] <= shell_rect["y"]+sheet_height-68, f"Popup overlaps bottom nav: {rect}"
                    assert cta["y"] >= rect["y"] - 1 and cta["y"]+cta["height"] <= rect["y"]+rect["height"]+1, f"Continue clipped: {cta}"
                    assert cta["height"] >= 42, f"Continue touch target too short: {cta}"
                    assert page.evaluate("""() => {
                        const button=document.querySelector('.mono-celebration .mono-cta');
                        const r=button.getBoundingClientRect();
                        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                        return hit===button||button.contains(hit)
                    }"""), "Continue visible but another layer intercepts taps"
                    expected = 5 if scenario == "large" else 1
                    assert panel.locator(".mono-resource").count() >= expected, "Missing actual prize tiles"
                    if scenario == "event":
                        assert panel.locator(".mono-event").is_visible(), "Board event missing from treasure reward"
                    page.screenshot(path=str(out / f"09-{platform}-{width}-{scenario}-compact-reward.png"))
                    button.click(timeout=2500)
                    assert dialog.count() == 0, "Continue must close just reward popup"
                    assert page.locator('[data-cell-index]').count() == 28, "Returning to the board must preserve play"
                    assert not errors, errors
                    results.append(f"{platform} {width} {scenario}: {rect['height']:.0f}px, continue visible")
                finally:
                    page.close()
    browser.close()

(out / "compact-reward-verification.json").write_text(
    json.dumps({"cases":len(results),"passed":len(results),"results":results,"production_network":False},ensure_ascii=False,indent=2),
    encoding="utf-8")
print("Monopoly treasure reward mobile PASS",len(results),"real Chromium scenarios")
