"""Measure actual App navigation with delayed chunks and an isolated boot profile."""
import asyncio, json, os, sys, threading, time
import re
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

build_dir = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/territory-navigation-preview')
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        public = Path.cwd() / 'public' / urlparse(path).path.lstrip('/')
        return str(public) if public.is_file() else super().translate_path(path)
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(build_dir)))
threading.Thread(target=server.serve_forever, daemon=True).start()

async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CAVE_BROWSER') or shutil.which('chromium') or p.chromium.executable_path, args=['--no-sandbox'])
        for width, lang in [(360,'ru'),(390,'en')]:
            page = await browser.new_page(viewport={'width':width,'height':720}, is_mobile=True, has_touch=True)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.add_init_script("""Object.defineProperty(navigator,'deviceMemory',{value:4});
                Object.defineProperty(navigator,'hardwareConcurrency',{value:4});
                window.__navMeasurement=false; window.__fallbackShown=false;
                new MutationObserver(()=>{if(window.__navMeasurement && document.querySelector('.territory-section-loading')) window.__fallbackShown=true}).observe(document,{subtree:true,childList:true});""")
            await page.add_init_script(f"localStorage.setItem('territory-language', '{lang}')")
            requests = []
            async def route_request(route):
                req = route.request
                if not req.url.startswith(f'http://127.0.0.1:{server.server_port}/'):
                    await route.abort(); return
                if req.resource_type in ('script','stylesheet') and await page.evaluate('!!window.__navMeasurement'):
                    requests.append(req.url)
                    await asyncio.sleep(0.7)  # Deliberate mobile round-trip latency.
                await route.continue_()
            await page.route('**/*', route_request)
            session = await page.context.new_cdp_session(page)
            await session.send('Emulation.setCPUThrottlingRate', {'rate':4})
            await page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='domcontentloaded')
            await page.locator('.territory-nav').wait_for(timeout=20000)
            assert await page.evaluate('innerWidth') == width, 'Use the real mobile CSS viewport'
            assert await page.evaluate('document.documentElement.lang') == lang
            for index in (5, 1, 2, 6):
                await page.evaluate('window.__navMeasurement=true;window.__fallbackShown=false')
                requests.clear(); started = time.perf_counter()
                await page.locator('.territory-nav button').nth(index).click()
                # Screen-specific rendering has begun once lazy fallback is gone;
                # backend data availability is deliberately outside this offline measurement.
                await page.wait_for_function('!document.querySelector(".territory-section-loading") && document.querySelector(".territory-nav button[aria-current=page]")',timeout=20000)
                await page.wait_for_timeout(120)
                assert await page.locator('.territory-nav button').nth(index).get_attribute('aria-current') == 'page'
                results.append({'width':width,'language':lang,'tab':index,'elapsedMs':round((time.perf_counter()-started)*1000),'chunkRequests':len(requests),'fallbackShown':await page.evaluate('window.__fallbackShown')})
                assert not await page.locator('[role="alert"]').filter(has_text=re.compile('Раздел пока не открылся|Section unavailable')).count(), errors
                if index == 5: await page.locator('[data-testid="game-hall"]').wait_for()
                if index == 2: await page.locator('[data-testid="living-hero-showcase"]').wait_for()
                await page.screenshot(path=str(build_dir / f'navigation-{width}-tab-{index}.png'))
                await page.evaluate('window.__navMeasurement=false')
                await page.locator('.territory-nav button').nth(0).click()
            assert not errors, errors
            await page.screenshot(path=str(build_dir / f'navigation-{width}.png'))
            await page.close()
        await browser.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))
    (build_dir / 'navigation-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    if '--expect-ready' in sys.argv:
        assert all(r['chunkRequests']==0 and not r['fallbackShown'] for r in results), results
try: asyncio.run(main())
finally: server.shutdown()
