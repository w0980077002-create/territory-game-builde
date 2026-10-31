"""Real stage1 components/CSS; offline UI fixtures only, no real accounts or rewards."""
from pathlib import Path
from urllib.parse import urlparse
import json
import shutil
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=Path('/tmp/territory-stage1-ui');OUT.mkdir(exist_ok=True)
ORIGIN='http://127.0.0.1:4173'
report={'environment':'Chromium headless, actual production React components and CSS, offline UI fixtures','physical_telegram_device':False,'viewports':[],'screenshots':[],'errors':[]}
def serve(route):
    route.fulfill(body=Path('/tmp/territory-stage1-preview.html').read_bytes(),content_type='text/html')
def load(browser,width,height,screen,member=False,english=False):
    page=browser.new_page(viewport={'width':width,'height':height})
    page.route(ORIGIN+'/**',serve)
    page.route('https://**/*',lambda route:route.abort())
    page.on('pageerror',lambda error:report['errors'].append(str(error)))
    if english:page.add_init_script("localStorage.setItem('territory-language','en')")
    page.goto(ORIGIN+'/?screen='+screen+('&member=1' if member else ''))
    page.wait_for_timeout(150)
    return page

def check(page,label):
    assert page.locator('.viking-screen').count()==1, f'{label}: missing real-route wooden style marker'
    assert page.locator('.viking-screen').evaluate("el=>getComputedStyle(el).color")!='rgb(0, 0, 0)', f'{label}: unreadable themed text'
    if not page.evaluate('document.documentElement.scrollWidth<=innerWidth'):
        overflowing=page.evaluate("[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,classes:el.className,text:el.textContent.slice(0,100),rect:el.getBoundingClientRect().toJSON()}))")
        page.screenshot(path=str(OUT/(label+'-overflow.png')),full_page=True)
        raise AssertionError(f'{label}: document overflow {overflowing}')
    wide=page.evaluate("""[...document.querySelectorAll('main input,main select,main button')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.classList.contains('sr-only')&&(r.x<0||r.right>innerWidth+1)}).map(el=>({tag:el.tagName,text:el.textContent,placeholder:el.placeholder,rect:el.getBoundingClientRect().toJSON()}))""")
    assert not wide,f'{label}: clipped controls {wide}'
    assert not page.locator('[role=alert]').count(),f'{label}: unexpected alert'

def shot(page,name):
    page.screenshot(path=str(OUT/(name+'.jpg')),full_page=True,type='jpeg',quality=80)
    report['screenshots'].append(name+'.jpg')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    for width,height in [(320,640),(390,844),(430,740)]:
        page=load(browser,width,height,'clan')
        expect(page.get_by_role('heading',name='Клан',exact=True)).to_be_visible()
        check(page,f'clan-home-{width}')
        page.get_by_role('button',name='Рейтинг кланов',exact=True).click()
        expect(page.get_by_role('heading',name='Рейтинг кланов',exact=True)).to_be_visible()
        expect(page.get_by_text('Северные волки',exact=False)).to_be_visible()
        check(page,f'clan-rankings-{width}');shot(page,f'clan-rankings-{width}')
        page=load(browser,width,height,'clan')
        page.get_by_role('button',name='Найти клан',exact=True).first.click()
        page.get_by_placeholder('Название клана или тег…').fill('Север')
        page.get_by_role('button',name='Найти',exact=True).click()
        page.get_by_role('button',name='Подать заявку',exact=True).click()
        expect(page.get_by_role('button',name='Отменить заявку',exact=True)).to_be_visible()
        check(page,f'clan-search-{width}');shot(page,f'clan-search-{width}')
        page=load(browser,width,height,'clan')
        page.get_by_role('button',name='Принять',exact=True).click()
        expect(page.get_by_role('heading',name='Заявки и приглашения')).to_be_visible()
        page.get_by_role('button',name='Принять',exact=True).click()
        expect(page.get_by_text('Бьёрн · 22')).to_have_count(0)
        page.get_by_placeholder('Имя игрока (от 2 символов)').fill('Хара')
        page.get_by_role('button',name='Найти',exact=True).click()
        page.get_by_role('button',name='Пригласить',exact=True).click()
        expect(page.get_by_text('Харальд · 28')).to_have_count(0)
        page.get_by_placeholder('Написать сообщение…').fill('Вперёд, воины!')
        page.get_by_placeholder('Написать сообщение…').press('Enter')
        expect(page.get_by_text('Вперёд, воины!',exact=True)).to_be_visible()
        check(page,f'clan-detail-{width}');shot(page,f'clan-detail-{width}')
        assert page.evaluate("window.__uiCalls.some(c=>c.name==='accept_invite')&&window.__uiCalls.some(c=>c.name==='invite_player')&&window.__uiCalls.some(c=>c.name==='chat_send')")
        page=load(browser,width,height,'auction')
        expect(page.get_by_role('heading',name='Аукционный дом')).to_be_visible()
        page.get_by_label('Поиск предмета или продавца').fill('Секира')
        page.get_by_label('Редкость',exact=True).select_option('epic')
        page.get_by_label('Сортировка',exact=True).select_option('price_asc')
        page.get_by_role('button',name='Найти',exact=True).click()
        assert page.evaluate("window.__uiCalls.some(c=>c.name==='auction_overview'&&c.args.search==='Секира'&&c.args.rarity==='epic'&&c.args.sort==='price_asc')")
        check(page,f'auction-lots-{width}');shot(page,f'auction-lots-{width}')
        page.get_by_role('tab',name='Мои лоты',exact=True).click()
        expect(page.get_by_role('heading',name='Выставить предмет мастера')).to_be_visible()
        check(page,f'auction-mine-{width}')
        page.get_by_role('tab',name='История',exact=True).click()
        expect(page.get_by_role('heading',name='История сделок')).to_be_visible()
        expect(page.get_by_text('Комиссия: 100 · Получено: 900')).to_be_visible()
        check(page,f'auction-history-{width}')
        page=load(browser,width,height,'season')
        expect(page.get_by_role('heading',name='Недельный чемпионат')).to_be_visible()
        page.get_by_test_id('season-prize-rules').locator('summary').click()
        expect(page.get_by_text('№10',exact=True)).to_be_visible()
        page.get_by_test_id('season-winners-history').locator('summary').click()
        expect(page.get_by_text('История чемпионов',exact=True)).to_be_visible()
        check(page,f'season-{width}');shot(page,f'season-{width}')
        report['viewports'].append({'width':width,'height':height,'clan_search_application_invite_chat':True,'auction_filters_history':True,'season_ten_prizes_history':True})
    assert not report['errors'],report['errors']
    browser.close()
(OUT/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
