"""Smoke the actual profile component with an offline in-memory player."""
import os, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        public_file = os.path.join(os.getcwd(), 'public', path.lstrip('/'))
        if os.path.isfile(public_file):
            return public_file
        return super().translate_path(path)
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory='/tmp'))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (320, 360, 390, 430):
        for lang in ('ru', 'en'):
            page=browser.new_page(viewport={'width':width, 'height':500})
            page.add_init_script(f"localStorage.setItem('territory-language', '{lang}')")
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html')
            hero = page.locator('[data-testid="living-hero-showcase"]')
            hero.wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert hero.locator('.hero-showcase__stat').count() == 4
            assert hero.locator('.hero-showcase__slot').count() == 7
            image = hero.locator('.hero-showcase__hero-art')
            assert image.evaluate('(el) => el.complete && el.naturalWidth > 0'), 'Missing canonical hero art'
            assert image.bounding_box()['height'] >= 190, 'Hero art is still too small'
            assert hero.get_by_role('progressbar').count() == 2, 'Saved XP and chapter progress must be visible'
            chapter = hero.locator('.hero-showcase__chapter-track')
            assert chapter.get_attribute('aria-valuemin') == '0'
            assert chapter.get_attribute('aria-valuemax') == '5', 'Real chapter generator defines five enemies'
            assert chapter.get_attribute('aria-valuenow') == '0', 'New player has zero chapter victories'
            boss_art = hero.locator('.hero-showcase__boss-art')
            assert boss_art.evaluate('(el) => el.complete && el.naturalWidth > 0'), 'Missing approved boss art'
            # The owner-approved wooden titles must be visually centered on the
            # carved background, not just painted with the same texture.
            for title in hero.locator('.hero-showcase__plaque-title').all():
                metrics = title.evaluate("""el => {
                  const box=el.getBoundingClientRect();
                  const range=document.createRange(); range.selectNodeContents(el);
                  const glyph=range.getBoundingClientRect();
                  const css=getComputedStyle(el);
                  return { centerError:Math.abs((box.left+box.right-glyph.left-glyph.right)/2),
                           centerStyle:css.textAlign,
                           weight:parseInt(css.fontWeight,10),
                           withinViewport:box.left >= 0 && box.right <= innerWidth+1,
                           textured:css.backgroundImage.includes('wooden-plaque') };
                }""")
                assert metrics['centerStyle'] == 'center', (width,lang,'heading is left-aligned',metrics)
                assert metrics['centerError'] < 9, (width,lang,'heading text displaced on wood',metrics)
                assert metrics['weight'] >= 900, (width,lang,'heading is not bold enough',metrics)
                assert metrics['withinViewport'] and metrics['textured'], (width,lang,'heading plaque misfit',metrics)
            if width == 360 and lang == 'ru':
                hero.screenshot(path='/tmp/territory-hero-360.png')
            page.evaluate('window.__route = null')
            hero.locator('.hero-showcase__equipment-link').click()
            assert page.evaluate('window.__route') == 'equipment'
            page.evaluate('window.__route = null')
            hero.locator('.hero-showcase__adventure').click()
            assert page.evaluate('window.__route') == 'campaign'
            companion = hero.locator('[data-testid="hero-companion-journey"]')
            assert companion.count() == 1
            assert companion.locator('img').evaluate('(el) => el.complete && el.naturalWidth > 0')
            page.evaluate('window.__route = null')
            companion.locator('[data-testid="hero-open-companions"]').click()
            assert page.evaluate('window.__route') == 'companions'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.locator('[data-testid="profile-appearance"] summary').click()
            assert page.locator('[data-testid="profile-appearance"] button').count() >= 4
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 360 and lang == 'ru':
                page.locator('.territory-shell').evaluate('(el) => el.scrollTop = 0')
                page.screenshot(path='/tmp/territory-profile-360.png')
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?companion')
            companion = page.locator('[data-testid="hero-companion-journey"]')
            companion.wait_for()
            assert ('Loyal Shield' if lang == 'en' else 'Верный щит') in companion.inner_text()
            assert ('Lv. 1' if lang == 'en' else 'Ур. 1') in companion.inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            # A saved chapter with enough victories must announce the boss;
            # the art and CTA stay bound to the existing campaign, not a fake reward.
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?boss-ready')
            hero = page.locator('[data-testid="living-hero-showcase"]')
            hero.wait_for()
            assert hero.locator('.hero-showcase__chapter-track').get_attribute('aria-valuenow') == '5'
            expected = 'Boss battle unlocked!' if lang == 'en' else 'Босс готов к бою!'
            assert hero.locator('.hero-showcase__next-copy strong').inner_text() == expected
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            # Only existing inventory gear is advertised. Tapping opens the
            # actual equipment route and never auto-equips or grants an item.
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?loot')
            hero = page.locator('[data-testid="living-hero-showcase"]')
            hero.wait_for()
            loot = hero.locator('.hero-showcase__loot')
            assert loot.count() == 1
            assert 'Шлем дозорного' in loot.inner_text()
            assert loot.locator('img').evaluate('(el) => el.complete && el.naturalWidth > 0')
            loot.click()
            assert page.evaluate('window.__route') == 'equipment'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?inventory')
            assert page.locator('.warehouse-tile__name').evaluate_all('names => names.every(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)')
            assert page.locator('.warehouse-tile').evaluate_all('tiles => tiles.every(el => { const r=el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })')
            tile = page.locator('.warehouse-tile').first
            tile.click()
            dialog = page.get_by_role('dialog')
            assert dialog.count() == 1
            assert dialog.locator('.inventory-item-detail').count() == 1
            close = dialog.locator('.territory-modal-close')
            rect = close.bounding_box()
            assert rect and rect['width'] >= 44 and rect['height'] >= 44
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            if width == 360 and lang == 'ru': page.screenshot(path='/tmp/territory-item-360.png')
            close.click()
            assert dialog.count() == 0
            assert tile.evaluate('(el) => document.activeElement === el')
            stone = page.locator('.warehouse-tile').filter(has_text='Awakening Stone' if lang == 'en' else 'Камень пробуждения')
            stone.click()
            assert ('not yet confirmed' if lang == 'en' else 'пока не подтверждён') in dialog.inner_text()
            dialog.locator('.territory-modal-close').click()
            forge = page.locator('.warehouse-tile--forge')
            forge.click()
            assert dialog.locator('.warehouse-info-content').count() == 1
            page.keyboard.press('Escape')
            assert dialog.count() == 0
            assert forge.evaluate('(el) => document.activeElement === el')
            # A long warehouse stays searchable and keeps the pinned controls reachable.
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?inventory-companions')
            bar = page.locator('[data-testid="companion-journey-actions"]')
            bar.wait_for()
            assert bar.is_visible()
            assert page.get_by_role('tab', name='Companions' if lang == 'en' else 'Спутники').get_attribute('aria-selected') == 'true'
            page.evaluate('window.__route = null')
            bar.get_by_role('button', name='Open Campaign' if lang == 'en' else 'Открыть Поход').click()
            assert page.evaluate('window.__route') == 'campaign'
            page.evaluate('window.__route = null')
            bar.get_by_role('button', name='Hero' if lang == 'en' else 'Герой').click()
            assert page.evaluate('window.__route') == 'hero'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?inventory-many')
            search = page.locator('.compact-warehouse__search input')
            assert page.locator('.warehouse-tile').count() >= 40
            search.fill('Test material 39')
            assert page.locator('.warehouse-tile').count() == 1
            assert 'Test material 39' in page.locator('.warehouse-tile').inner_text()
            assert page.locator('[data-testid="inventory-pinned-belt"]').is_visible()
            assert page.get_by_role('tablist', name='Inventory sections' if lang == 'en' else 'Разделы инвентаря').is_visible()
            search.fill('')
            page.goto(f'http://127.0.0.1:{server.server_port}/territory-profile-preview.html?city')
            page.locator('.home-game-scene').wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.home-side').count() >= 6
            assert page.locator('.home-side').evaluate_all('buttons => buttons.every(b => { const r=b.getBoundingClientRect(); return r.width >= 40 && r.height >= 40 && r.left >= 0 && r.right <= innerWidth; })')
            page.locator('.home-profile-chip').click()
            assert page.evaluate('window.__route') == 'hero'
            if width == 360 and lang == 'ru': page.screenshot(path='/tmp/territory-city-360.png')
            page.close()
    browser.close()
server.shutdown()
print('City, profile and inventory browser checks passed: 320/360/390/430, RU/EN, short height and item dialogs.')
