"""Real workshop, shop and profession screens; all transport and purchases are stubbed."""
import os,threading,shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
class Handler(SimpleHTTPRequestHandler):
 def translate_path(self,path):
  asset=os.path.join(os.getcwd(),'public',path.lstrip('/').split('?')[0]);return asset if os.path.isfile(asset) else super().translate_path(path)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory='/tmp'));threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 # Chromium can report 43.999996 for a CSS 44px box.
 for width in (320,360,390,430):
  for lang in ('ru','en'):
   for ios in (False,True):
    page=browser.new_page(viewport={'width':width,'height':500},reduced_motion='reduce');page.add_init_script(f"localStorage.setItem('territory-language','{lang}')" + (";document.addEventListener('DOMContentLoaded',()=>document.documentElement.classList.add('territory-ios-webapp'))" if ios else ''));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?forge');page.wait_for_timeout(400);assert not errors,errors
    # No emoji placeholders: the forged-set row uses only the player's actually equipped gear.
    set_row=page.get_by_test_id('forge-equipped-set')
    assert set_row.locator('button').count()==7, (width,lang,'wrong equipped slot count')
    assert set_row.get_by_test_id('forge-equipped-item-art').count()==1, (width,lang,'generic art instead of equipped gear')
    assert set_row.get_by_test_id('forge-empty-slot').count()==6, (width,lang,'unequipped slots must be empty')
    assert set_row.get_by_test_id('forge-equipped-item-art').first.evaluate(
      '(img)=>img.complete && img.naturalWidth>0'), (width,lang,'equipped image failed to load')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,lang,'Forge horizontal overflow')
    if lang=='ru' and not ios:
      os.makedirs('/tmp/territory-stage1-ui',exist_ok=True)
      page.screenshot(path=f'/tmp/territory-stage1-ui/forge-equipped-{width}.png',full_page=True)
    equipped_button=set_row.get_by_test_id('forge-equipped-slot')
    equipped_name=equipped_button.get_attribute('title')
    equipped_button.click()
    assert equipped_name in page.get_by_role('dialog').inner_text(),(width,lang,'equipped item did not open')
    page.keyboard.press('Escape')
    assert page.get_by_role('dialog').count()==0
    gear=page.get_by_role('button',name='Iron Helmet' if lang=='en' else 'Железный шлем');gear.click();dialog=page.get_by_role('dialog');close=dialog.get_by_role('button',name='Close' if lang=='en' else 'Закрыть');r=close.bounding_box();assert r['width']>=43.99 and r['height']>=43.99,(width,lang,ios,r)
    assert close.evaluate('(e)=>document.activeElement===e');page.keyboard.press('Escape');assert dialog.count()==0 and gear.evaluate('(e)=>document.activeElement===e')
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?shop');page.wait_for_timeout(400);assert not errors,errors
    # Full stage, hanging sign, horizontal product rows and all visual assets.
    assert page.locator('.territory-shop-facade__scenery').evaluate(
      "(el) => getComputedStyle(el).backgroundImage.includes('" + ('shop-approved-facade.webp' if lang=='ru' else 'shop-market-stage.svg') + "')"
    ), (width,lang,'owner-approved market missing')
    assert page.evaluate("""async () => {
      const paths = ['shop-wood-planks.webp','shop-wood-beams.webp','shop-rope-wrap.svg','shop-iron-corner.svg','shop-market-stage.svg','shop-hanging-sign.svg','shop-reference-sign.webp','shop-reference-market.webp','shop-reference-license-frame.webp','shop-reference-product-frame.webp','shop-approved-facade.webp','shop-approved-license-border.webp','shop-approved-product-border.webp','shop-approved-product-border-v2.webp','shop-approved-tabs-border.webp','crafted-product-frame.svg','crafted-license-frame.svg','crafted-tab-frame.svg'];
      return (await Promise.all(paths.map(name => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = '/assets/territory/ui/shop/' + name;
      })))).every(Boolean);
    }"""), (width,lang,'shop asset missing')
    assert page.locator('.territory-shop-facade__scenery').evaluate(
      "(el) => getComputedStyle(el).backgroundImage.includes('" + ('shop-approved-facade.webp' if lang=='ru' else 'shop-market-stage.svg') + "')"
    ), (width,lang,'painted shop background missing')
    assert page.locator('.territory-shop-license').evaluate(
      "(el) => getComputedStyle(el,'::after').borderImageSource.includes('crafted-license-frame.svg')"
    ), (width,lang,'license illustrated frame missing')
    assert page.locator('.territory-shop-product').first.evaluate(
      "(el) => getComputedStyle(el,'::before').borderImageSource.includes('crafted-product-frame.svg')"
    ), (width,lang,'product illustrated frame missing')
    assert page.locator('.territory-shop-facade').count()==1
    assert page.locator('.territory-shop-approved').count()==1
    assert page.locator('.territory-shop-facade').evaluate(
      "(el) => Math.abs(el.getBoundingClientRect().width/el.getBoundingClientRect().height - 941/291)<0.06"
    ),(width,lang,'approved fascia aspect ratio distorted')
    if page.locator('.territory-shop-license__owned').count():
      assert page.locator('.territory-shop-license__buy').count()==0,(width,lang,'redundant purchased license button')
    assert page.locator('.territory-shop-products .territory-shop-product').count()>=2
    assert page.locator('.territory-shop-product__buy').first.bounding_box()['height']>=43.99
    assert page.locator('.territory-shop-tab').first.evaluate(
      "(el)=>getComputedStyle(el,'::before').borderImageSource.includes('crafted-tab-frame.svg')"
    ),(width,lang,'new forged tab border not applied')
    assert page.locator('.territory-shop-product').first.evaluate(
      """(el) => {
        const art=el.querySelector('.territory-shop-product__art').getBoundingClientRect();
        const info=el.querySelector('.territory-shop-product__information').getBoundingClientRect();
        const actions=el.querySelector('.territory-shop-product__actions').getBoundingClientRect();
        const outer=el.getBoundingClientRect();
        const separated=(a,b)=>a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1;
        return separated(art,info)&&separated(info,actions)&&separated(art,actions)&&
          actions.right<=outer.right+1 && art.left>=outer.left-1 &&
          el.scrollWidth<=el.clientWidth+2;
      }"""
    ), (width,lang,'product layout collision or overflow')
    if lang=='ru':
      assert page.locator('.territory-shop-sign__title').evaluate("(el)=>getComputedStyle(el).opacity==='0'"),'duplicate printed title'
    else:
      assert page.locator('.territory-shop-sign__title').evaluate("(el)=>getComputedStyle(el).opacity!=='0'"),'English translation invisible'
    assert page.locator('.territory-shop-product__stock').first.count()==1
    assert page.locator('.territory-shop-wallet__cell').count()==4
    assert page.locator('.territory-shop-product').count()>0
    assert page.locator('.territory-shop-tab').count()==3
    assert page.locator('.territory-shop-tab').evaluate_all(
      """(tabs) => tabs.every(tab => {
        const label=tab.querySelector('span').getBoundingClientRect();
        const outer=tab.getBoundingClientRect();
        return label.left>=outer.left+7 && label.right<=outer.right-7;
      })"""
    ),(width,lang,'tab text touches forged border')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,lang,'shop overflow')
    if width in (320,360,390,430) and lang=='ru' and not ios:
      os.makedirs('/tmp/territory-stage1-ui',exist_ok=True)
      # The fixture shell scrolls at 100dvh; a 500px screenshot cuts off
      # the actual product rows. Capture a taller mobile viewport too.
      page.set_viewport_size({'width':width,'height':1050})
      page.wait_for_timeout(100)
      page.screenshot(path=f'/tmp/territory-stage1-ui/shop-approved-{width}.png',full_page=True)
      page.set_viewport_size({'width':width,'height':500})
    item=page.get_by_role('button').filter(has_text='Health Potion' if lang=='en' else 'Зелье здоровья').first;item.click();dialog=page.get_by_role('dialog');assert ('Health Potion' if lang=='en' else 'Зелье здоровья') in dialog.locator('h2').inner_text();close=dialog.locator('.territory-modal-close');assert close.bounding_box()['height']>=43.99
    plus=dialog.get_by_role('button',name='Increase quantity' if lang=='en' else 'Увеличить количество');assert plus.bounding_box()['width']>=43.99;plus.click();assert dialog.locator('input[type="range"]').input_value()=='2';page.keyboard.press('Escape');assert dialog.count()==0 and item.evaluate('(e)=>document.activeElement===e')
    # Stone packs must switch without backing out of the dialog. The max is
    # 25 *stones*, not 25 packs. All purchases remain inert in this fixture.
    # Owner-approved window-size reference: "Материалы кузницы".
    # Compare REAL React purchase sheets in a normal mobile viewport, not
    # the short 500px test window which would clamp both to max-height.
    page.set_viewport_size({'width':width,'height':760})
    page.locator('.territory-shop-tab').last.click()
    page.locator('.territory-shop-product__art').last.click()
    reference_dialog=page.get_by_role('dialog')
    assert ('Материалы кузницы' if lang=='ru' else 'Forge Materials') in reference_dialog.inner_text() or reference_dialog.locator('h2').count()==1
    reference_height=reference_dialog.locator('.territory-modal-panel').bounding_box()['height']
    if width==360 and lang=='ru' and not ios:
      os.makedirs('/tmp/territory-stage1-ui',exist_ok=True)
      reference_dialog.screenshot(path='/tmp/territory-stage1-ui/shop-material-reference-360.png')
    page.keyboard.press('Escape')
    assert reference_dialog.count()==0
    page.locator('.territory-shop-product__art').first.click()
    stone_dialog=page.get_by_role('dialog')
    pack_nav=stone_dialog.get_by_role('navigation',name='Battle stone pack size' if lang=='en' else 'Выбор набора боевых камней')
    assert pack_nav.locator('button').count()==2,(width,lang,ios,'both stone pack sizes unavailable')
    pack_nav.locator('button').nth(1).click()
    assert pack_nav.locator('button').nth(1).get_attribute('aria-pressed')=='true'
    stone_plus=stone_dialog.get_by_role('button',name='Increase quantity' if lang=='en' else 'Увеличить количество')
    for _ in range(4): stone_plus.click()
    assert stone_dialog.locator('input[type="range"]').input_value()=='5',(width,lang,ios,'five packs must equal 25 stones')
    assert stone_plus.is_disabled(),(width,lang,ios,'daily cap should disable plus')
    assert ('Today\'s maximum' if lang=='en' else 'Максимум на сегодня') in stone_dialog.inner_text(),(width,lang,ios,'missing explanation for disabled plus')
    # Unlike the previous overgrown stone sheet, it must fit alongside the
    # materials reference without requiring a swipe to reach Buy or Close.
    stone_panel=stone_dialog.locator('.territory-modal-panel')
    stone_box=stone_panel.bounding_box()
    assert stone_box['height']<=reference_height+18,(width,lang,ios,'stone modal taller than materials reference',stone_box['height'],reference_height)
    assert stone_dialog.locator('.territory-modal-content').evaluate('(e)=>e.scrollHeight<=e.clientHeight+2'),(width,lang,ios,'stone sheet still overflows in normal viewport')
    buy=stone_dialog.get_by_role('button',name=('Buy x5' if lang=='en' else 'Купить x5'))
    buy_box=buy.bounding_box()
    assert buy_box and buy_box['y']+buy_box['height'] <= stone_box['y']+stone_box['height']-4,(width,lang,ios,'buy button below stone frame')
    if width==360 and lang=='ru' and not ios:
      os.makedirs('/tmp/territory-stage1-ui',exist_ok=True)
      stone_dialog.screenshot(path='/tmp/territory-stage1-ui/shop-stones-limit-360.png')
    pack_nav.locator('button').first.click()
    assert pack_nav.locator('button').first.get_attribute('aria-pressed')=='true'
    assert stone_dialog.locator('input[type="range"]').get_attribute('max')=='25',(width,lang,ios,'individual stones should allow 25')
    # Short viewports may scroll internally, but the header and exit must
    # stay visible. At normal height the entire purchase including Buy is visible.
    page.set_viewport_size({'width':width,'height':500})
    body=stone_dialog.locator('.territory-modal-content')
    assert body.evaluate('(e)=>{e.scrollTop=e.scrollHeight;return e.scrollTop>0;}'),(width,lang,ios,'short stone modal must allow internal scrolling')
    assert stone_dialog.locator('.territory-modal-close').is_visible(),(width,lang,ios,'close button hidden')
    page.keyboard.press('Escape');assert stone_dialog.count()==0 and not errors,(width,lang,ios,errors)
    page.goto(f'http://127.0.0.1:{server.server_port}/territory-workshop-after.html?professions');page.wait_for_timeout(300);assert not errors,errors
    assert page.locator('.profession-choice').count()==5;assert page.locator('.profession-choice__action').first.bounding_box()['height']>=43.99
    page.get_by_role('tab',name='Crafting' if lang=='en' else 'Крафт').click();assert page.locator('.profession-choice').count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.close()
 browser.close()
server.shutdown()
print('Workshop browser checks passed: real forge, shop and professions with inert transport, 320/360/390/430, RU/EN.')
