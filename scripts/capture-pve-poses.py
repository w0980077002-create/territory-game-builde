"""Record the actual PvE component with local state; no server or real account."""
from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urlparse
import mimetypes, os, shutil
root=Path(__file__).resolve().parents[1]
out=Path(os.environ.get('TERRITORY_CAPTURE_DIR','/tmp/territory-pve-pose-capture'))
out.mkdir(parents=True,exist_ok=True)
def serve(route):
    path=urlparse(route.request.url).path
    file=Path('/tmp/territory-combat-preview.html') if path=='/' else root/'public'/path.lstrip('/')
    if file.is_file(): route.fulfill(body=file.read_bytes(),content_type='text/html' if path=='/' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
    else: route.fulfill(status=404,body='missing')
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-breakpad','--disable-crash-reporter'])
    c=b.new_context(viewport={'width':390,'height':844},record_video_dir=str(out),record_video_size={'width':390,'height':844})
    page=c.new_page(); page.route('http://127.0.0.1:4173/**',serve); page.route('https://**/*',lambda r:r.abort())
    page.goto('http://127.0.0.1:4173/?scene=pve&appearance=m1&enemy=bandit'); page.wait_for_selector('img[src*=bandit]'); page.wait_for_timeout(1000)
    page.get_by_role('button',name='Защита: Голова',exact=True).click()
    page.get_by_role('button',name='Защита: Грудь',exact=True).click()
    page.get_by_role('button',name='Удар: Живот',exact=True).click()
    page.get_by_role('button',name='УДАР',exact=True).click(); page.wait_for_timeout(2500)
    page.get_by_role('button',name='Скорость боя',exact=True).click()
    page.get_by_role('button',name='Защита: Голова',exact=True).click()
    page.get_by_role('button',name='Защита: Грудь',exact=True).click()
    page.get_by_role('button',name='Удар: Живот',exact=True).click()
    page.get_by_role('button',name='УДАР',exact=True).click(); page.wait_for_timeout(1800)
    video=page.video; c.close(); print(video.path()); b.close()
