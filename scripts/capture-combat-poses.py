"""Record real FighterFigure components with synthetic events; no network or player data."""
from pathlib import Path
from urllib.parse import urlparse
import mimetypes, os, shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('TERRITORY_CAPTURE_DIR', '/tmp/territory-pose-capture'))
OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = 'http://127.0.0.1:4173'
def serve(route):
    path = urlparse(route.request.url).path
    file = Path('/tmp/territory-combat-preview.html') if path == '/' else ROOT / 'public' / path.lstrip('/')
    if file.is_file():
        route.fulfill(body=file.read_bytes(), content_type='text/html' if path == '/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
    else:
        route.fulfill(status=404, body='missing fixture asset')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox', '--disable-breakpad', '--disable-crash-reporter'])
    context = browser.new_context(viewport={'width':390, 'height':650}, record_video_dir=str(OUT), record_video_size={'width':390,'height':650})
    page = context.new_page()
    page.route(ORIGIN+'/**', serve)
    page.route('https://**/*', lambda route: route.abort())
    page.goto(ORIGIN+'/')
    page.wait_for_function('!!window.__combat')
    page.evaluate("window.__combat.set({appearance:'m1',enemy:'bandit'})")
    page.wait_for_function("document.querySelector('#fixture-hero img[src*=male_rogue]') && document.querySelector('#fixture-enemy img[src*=bandit]')")
    page.wait_for_timeout(1200)
    for speed in (1,2):
        page.evaluate('(speed)=>window.__combat.set({speed,strike:null})', speed)
        page.wait_for_timeout(400)
        for i,tone in enumerate(('hit','block','dodge','crit')):
            event={'key': speed*100+i, 'attacker':'Рагнар' if i%2==0 else 'Противник', 'target':'Противник' if i%2==0 else 'Рагнар', 'tone':tone, 'amount':17 if tone in ('hit','crit') else None}
            page.evaluate('(strike)=>window.__combat.set({strike})',event)
            page.wait_for_timeout(1050 if speed==1 else 650)
    page.evaluate('window.__combat.set({strike:null,heroWon:true,foeAlive:false})')
    page.wait_for_timeout(1200)
    video = page.video
    context.close()
    print(video.path())
    browser.close()
