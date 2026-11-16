"""Extract only #540-approved clips from the pinned VIKING art baseline.
Usage: python scripts/art/import-cave-animation.py /path/to/territory-game-working
Pillow is a build-time tool only. No source runtime, masters or other IDs imported.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image

PIN = '645eab542a9f9ec42a26917dcb4ea9edc39b8175'
source = Path(sys.argv[1]).resolve()
assert subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() == PIN
root = Path(__file__).resolve().parents[2]
out = root / 'public/assets/territory/cave-expedition/animation'
out.mkdir(parents=True, exist_ok=True)
registry = json.loads((source / 'src/data/animation-frames.json').read_text())
result = {'sourceSha': PIN, 'clips': {}, 'textures': {}}
for actor in ['04_club_raider', '07_purple_mage', '08_armored_boar']:
    clip = registry[actor]
    atlas = Image.open(source / ('public/art/' + clip['atlas'] + '.webp')).convert('RGBA')
    frames = []
    width = sum(f['rect'][2] + 4 for f in clip['frames'])
    height = max(f['rect'][3] for f in clip['frames']) + 4
    sheet = Image.new('RGBA', (width, height))
    cursor = 2
    for f in clip['frames']:
        x, y, w, h = f['rect']
        tile = atlas.crop((x, y, x+w, y+h))
        assert tile.getbbox() and tile.getextrema()[3][0] == 0
        sheet.paste(tile, (cursor, 2))
        frames.append({'rect': [cursor, 2, w, h], 'pivot': f['pivot']})
        cursor += w + 4
    path = out / (actor + '.webp')
    sheet.save(path, 'WEBP', lossless=True, method=6)
    result['clips'][actor] = {'referenceHeight': clip['referenceHeight'], 'frames': frames,
        'width': width, 'height': height, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
for actor in ['senior_driller', 'moss_eater']:
    path = out / (actor + '.webp')
    original = source / ('public/art/bosses/' + actor + '.webp')
    image = Image.open(original).convert('RGBA')
    image.save(path, 'WEBP', lossless=True, method=6)
    result['textures'][actor] = {'width': image.width, 'height': image.height,
        'sourceSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
(root / 'src/components/pve/cavePreview/animationRegistry.json').write_text(json.dumps(result, indent=2) + '\n')
print('Imported 3 eight-pose clips and 2 approved biome textures. Existing six originals untouched.')
