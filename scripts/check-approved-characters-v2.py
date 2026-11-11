"""Decode all imported art and compare bytes with the restored owner ZIP, if supplied."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, help='Extracted TERRITORY_ART_PACK_2026-11-11_v2')
parser.add_argument('--report', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
masters = root / 'docs/art-reference/approved-characters-20261111'
public = root / 'public/assets/territory/cave-expedition/characters-v2'
manifest = json.loads((masters / 'manifest.json').read_text())['files']
catalog = json.loads((root / 'src/game/cavePreviewWorld/approvedCharacters.json').read_text())
assert len(manifest) == len(catalog) == 21
assert len([p for p in masters.glob('*/*.png') if p.parent.name != 'originals']) == 21
assert len(list(public.glob('*/*/idle-still.webp'))) == 21
rows = []
for row, meta in zip(manifest, catalog):
    assert all(meta[k] == row[k] for k in meta), row['id']
    key = f"{row['category']}/{row['id']}"
    png = masters / f'{key}.png'
    webp = public / key / 'idle-still.webp'
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    assert digest(png) == row['sha256'], key
    record = {'id': key, 'png_sha256': digest(png), 'webp_sha256': digest(webp)}
    for path, fmt in [(png, 'PNG'), (webp, 'WEBP')]:
        with Image.open(path) as image:
            image.load()
            assert image.format == fmt and image.mode == 'RGBA', path
            assert getattr(image, 'n_frames', 1) == 1, path
            alpha = image.getchannel('A')
            assert alpha.getextrema() == (0, 255), path
            w, h = image.size
            assert all(alpha.getpixel(pt) == 0 for pt in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]), path
            bbox = alpha.getbbox()
            assert bbox and 0 < bbox[0] < bbox[2] < w and 0 < bbox[1] < bbox[3] < h, path
            if fmt == 'PNG':
                assert [w, h] == [row['master_width_px'], row['master_height_px']]
                assert list(bbox) == row['alpha_bbox']
            record[fmt.lower()] = {'dimensions': [w, h], 'alpha_bbox': list(bbox), 'frames': 1}
    if args.source:
        assert png.read_bytes() == (args.source / row['master']).read_bytes()
        assert webp.read_bytes() == (args.source / row['still_preview']).read_bytes()
    rows.append(record)
originals = sorted((masters / 'originals').iterdir())
assert len(originals) == 10
for path in originals:
    with Image.open(path) as image:
        image.load()
    if args.source:
        assert path.read_bytes() == (args.source / '03_original_owner_references' / path.name).read_bytes()
result = {'png': 21, 'webp': 21, 'originals': 10, 'source_bytes_compared': bool(args.source), 'characters': rows,
          'owner_originals': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in originals},
          'limits': 'Still art only. Owner likeness approval, animation, physical Android/Telegram and deployment not established.'}
if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print('PASS: decoded 21 PNG + 21 single-frame WebP; SHA256, metadata, alpha, margins, 10 originals' + ('; all bytes match source ZIP' if args.source else ''))
