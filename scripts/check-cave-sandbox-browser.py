"""Playable Dark Cave preview: real React UI + offline fake server, never a player account.

Walks the whole loop on four phone widths in RU and EN: blessing slots, a
server-confirmed victory, test loot, the 12-slot dark gear with comparison,
enhancement, dismantle protection, gems with sockets and 3:1 synthesis, and
the fund. Also proves that these test mechanics send nothing to the server and
write only their own storage key.
"""
from pathlib import Path
from urllib.parse import urlparse
import json, os, shutil
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
fixture = Path('/tmp/adventure-preview.html')
url = 'http://127.0.0.1:4175/'
out = Path('/tmp/cave-sandbox-screenshots')
out.mkdir(exist_ok=True)
KEY = 'territory_cave_sandbox_v1'
TYPES = {'.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png'}
# Gems only: items come from real UI flows below (fund claims and a victory).
SEED = json.dumps({'v': 1, 'gems': {'ruby:1': 7, 'azure:2': 3, 'moon:9': 2}, 'elixirs': {'cave_bless_gems': 1, 'cave_bless_gear': 2}})

def serve(route):
    path = urlparse(route.request.url).path
    if path == '/':
        route.fulfill(body=fixture.read_bytes(), content_type='text/html')
        return
    asset = (root / 'public' / path.lstrip('/')).resolve()
    if asset.is_relative_to(root / 'public') and asset.is_file():
        route.fulfill(body=asset.read_bytes(), content_type=TYPES.get(asset.suffix, 'application/octet-stream'))
    else:
        route.fulfill(status=404)

def sandbox(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))

def no_overflow(page, where):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'horizontal overflow: {where}'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SLOT_BROWSER_EXECUTABLE') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    for lang in ('ru', 'en'):
        en = lang == 'en'
        for width, height in ((320, 568), (360, 740), (390, 844), (430, 932)):
            page = browser.new_page(viewport={'width': width, 'height': height})
            errors, missing = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: missing.append(r.url) if r.status == 404 else None)
            page.on('dialog', lambda d: d.accept())
            page.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(SEED)});")
            page.route(url + '**', serve)
            page.goto(f'{url}?lang={lang}&cleared=99')
            page.get_by_test_id('dark-cave-challenge').wait_for()
            tag = f'{lang}-{width}'
            other_storage = page.evaluate(f"JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== '{KEY}'))")

            # --- Cave blessing: three slots, owned elixirs only.
            slots = page.get_by_test_id('cave-blessing-slot')
            assert slots.count() == 3
            slots.nth(0).click()
            page.get_by_test_id('cave-blessing-dialog').wait_for()
            assert page.get_by_test_id('cave-blessing-pick').count() == 2, 'only owned elixir kinds are offered'
            page.get_by_test_id('cave-blessing-pick').first.click()
            assert page.locator('.cv-bless-slot--full').count() == 1
            page.screenshot(path=str(out / f'lobby-{tag}.png'))
            no_overflow(page, 'lobby')

            # --- Fund: claims follow the confirmed depth, once each.
            page.get_by_test_id('cave-tab-fund').click()
            rows = page.get_by_test_id('cave-fund-claim')
            assert rows.count() == 20
            assert rows.nth(19).is_disabled(), 'floor 100 is not cleared in this fixture'
            for index in (4, 9, 14):  # floors 25, 50, 75 -> a dark item each
                rows.nth(index).click()
                assert rows.nth(index).is_disabled(), 'a threshold is claimed once'
            assert sorted(sandbox(page)['fundClaimed']) == [25, 50, 75]
            page.screenshot(path=str(out / f'fund-{tag}.png'))

            # --- A server-confirmed victory on the boss floor produces test loot once.
            page.get_by_test_id('cave-tab-floors').click()
            page.get_by_test_id('dark-cave-challenge').click()
            page.get_by_test_id('dark-cave-battle-background').wait_for()
            assert page.get_by_test_id('dark-cave-hud').is_visible()
            page.get_by_role('button', name='Continue battle' if en else 'Продолжить бой').click()
            page.get_by_test_id('cave-loot-reveal').wait_for()
            page.get_by_test_id('cave-loot-boosted').wait_for()
            loot = sandbox(page)['lastLoot']
            assert loot['floor'] == 100 and len(loot['items']) == 3 and loot['boosted'] == ['gear'], 'boss floor test loot, gear boosted by the placed elixir'
            assert all(1 <= g['level'] <= 3 for g in loot['gems']) and len(loot['gems']) == 2, 'gems drop at Lv.1-3 only'
            items_after_loot = len(sandbox(page)['items'])
            assert items_after_loot == 6
            page.screenshot(path=str(out / f'victory-{tag}.png'))
            no_overflow(page, 'victory')
            page.locator('#remount').evaluate('(e) => e.click()')  # resume replays the same confirmed victory
            page.get_by_test_id('cave-loot-reveal').wait_for()
            assert len(sandbox(page)['items']) == items_after_loot, 'a replayed victory must not loot twice'
            assert sandbox(page)['blessSlots'] == [None, None, None], 'the placed elixir is spent by the victory'
            page.get_by_role('button', name='Back to cave floors' if en else 'К этажам пещеры').click()
            page.get_by_test_id('dark-cave-realm').wait_for()
            calls = page.evaluate('JSON.stringify(window.__adventureCalls)')

            # --- Dark gear: 12 separate slots, equip, compare, enhance, protect, dismantle.
            page.get_by_test_id('cave-tab-gear').click()
            screen = page.get_by_test_id('umbra-screen')
            assert screen.get_by_test_id('umbra-slot').count() == 12
            assert screen.get_by_test_id('umbra-item').count() == 6
            assert page.locator('.cv-doll-figure').evaluate('(img) => img.complete && img.naturalWidth > 0'), 'hero artwork failed to load'
            hero = page.locator('.cv-doll-hero').bounding_box()
            assert hero and hero['width'] >= 110 and hero['height'] >= 220, f'hero must stay the centre of the 12-slot scene: {hero}'
            for slot in screen.get_by_test_id('umbra-slot').all():
                box = slot.bounding_box()
                assert box and box['height'] >= 30 and box['width'] >= 35, f'slot too small: {box}'
            assert page.get_by_test_id('umbra-power').inner_text().endswith(' 0')
            screen.get_by_test_id('umbra-item').first.click()
            page.get_by_test_id('umbra-item-dialog').wait_for()
            assert page.get_by_test_id('umbra-item-dialog').locator('img').first.evaluate('(img) => img.complete && img.naturalWidth > 0')
            page.get_by_test_id('umbra-equip').click()
            assert not page.get_by_test_id('umbra-power').inner_text().endswith(' 0'), 'equipping changes dark power'
            assert screen.get_by_test_id('umbra-item').count() == 5
            worn = list(sandbox(page)['loadout'].values())[0]
            essence = sandbox(page)['essence']
            screen.get_by_test_id('umbra-enhance-all').click()
            state = sandbox(page)
            assert 0 <= state['essence'] < essence and next(i for i in state['items'] if i['id'] == worn)['enhance'] > 0
            screen.get_by_test_id('umbra-slot').locator('img').first.click()  # the worn item
            page.get_by_test_id('umbra-item-dialog').wait_for()
            assert page.get_by_test_id('umbra-dismantle').count() == 0, 'a worn item cannot be dismantled'
            page.keyboard.press('Escape')
            screen.get_by_test_id('umbra-item').first.click()
            page.get_by_test_id('umbra-delta').wait_for()
            page.screenshot(path=str(out / f'compare-{tag}.png'))
            page.get_by_test_id('umbra-lock').click()
            page.get_by_test_id('umbra-dismantle').click()
            assert len(sandbox(page)['items']) == 6, 'a locked item is protected'
            page.get_by_test_id('umbra-lock').click()
            before = sandbox(page)['essence']
            page.get_by_test_id('umbra-dismantle').click()
            state = sandbox(page)
            assert len(state['items']) == 5 and state['essence'] > before
            screen.get_by_test_id('umbra-bulk').click()
            page.get_by_test_id('umbra-bulk-bar').wait_for()
            screen.get_by_test_id('umbra-item').first.click()
            page.get_by_test_id('umbra-bulk-confirm').click()
            assert len(sandbox(page)['items']) == 4
            screen.get_by_role('button', name='Guide' if en else 'Справочник', exact=True).click()
            page.get_by_test_id('umbra-guide').wait_for()
            page.keyboard.press('Escape')
            page.screenshot(path=str(out / f'gear-{tag}.png'))
            no_overflow(page, 'gear')
            page.get_by_role('button', name='Back to cave' if en else 'Назад в пещеру').click()

            # --- Gems: separate screen, sockets, 3:1 synthesis.
            page.get_by_test_id('cave-tab-gems').click()
            assert page.get_by_test_id('gem-socket').count() == 18
            gems_before = sandbox(page)['gems']
            page.get_by_test_id('gems-synth-open').click()
            dialog = page.get_by_test_id('gems-synth-dialog')
            dialog.locator('.cv-gemlist button[aria-label*="9 ×2"]').click()  # an incomplete stack: Lv.9 ×2
            assert page.get_by_test_id('gem-synth').is_disabled(), 'two gems never combine'
            page.get_by_test_id('gem-quick-synth').click()
            gems = sandbox(page)['gems']
            assert gems.get('ruby:1', 0) == gems_before['ruby:1'] % 3 and gems.get('azure:2', 0) == gems_before['azure:2'] % 3
            assert gems['moon:9'] == 2, 'an incomplete triple is untouched'
            assert all(count % 3 == count for key, count in gems.items()), 'quick synthesis leaves no complete triple'
            page.screenshot(path=str(out / f'synth-{tag}.png'))
            page.keyboard.press('Escape')
            total = sum(sandbox(page)['gems'].values())
            page.get_by_test_id('gem-socket').first.click()
            page.get_by_test_id('gem-insert').first.click()
            state = sandbox(page)
            assert sum(state['gems'].values()) == total - 1 and state['sockets']['weapon'][0]
            page.get_by_test_id('gems-totals').click()
            assert page.get_by_test_id('gems-totals-dialog').locator('.cv-line').count() == 1
            page.keyboard.press('Escape')
            page.get_by_test_id('gem-socket').first.click()
            page.get_by_test_id('gem-remove').click()
            assert sum(sandbox(page)['gems'].values()) == total, 'a removed gem returns to the pouch'
            page.screenshot(path=str(out / f'gems-{tag}.png'))
            no_overflow(page, 'gems')
            page.get_by_role('button', name='Back to cave' if en else 'Назад в пещеру').click()
            assert page.get_by_test_id('dark-cave-realm').is_visible()

            # --- Isolation: no server request and no foreign storage from any test mechanic.
            assert page.evaluate('JSON.stringify(window.__adventureCalls)') == calls, 'test mechanics must not call the server'
            now = page.evaluate(f"JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== '{KEY}' && !k.startsWith('territory_adventure_session_v1:')))")
            assert now == other_storage, 'test mechanics write only their own storage key'
            assert not errors, errors
            assert not missing, f'missing assets: {missing}'
            page.close()
    browser.close()
print('Dark Cave playable preview PASS: blessing slots, confirmed victory + single test loot, 12 dark slots, compare/enhance/protect/dismantle, gems sockets + 3:1, fund; RU/EN, 320/360/390/430; no server calls.')
