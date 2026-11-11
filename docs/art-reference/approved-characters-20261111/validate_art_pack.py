#!/usr/bin/env python3
"""Repeatable QA for the 21-character TERRITORY art package.
This proves format/transparency/integrity, NOT character likeness or gameplay readiness.
"""
from pathlib import Path
from PIL import Image
import hashlib, json, sys
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent/'TERRITORY_ART_PACK_2026-11-11_v2'
records=json.loads((root/'manifest.json').read_text(encoding='utf-8'))['files']
assert len(records)==21, f'Expected 21 PNGs, got {len(records)}'
ids=set()
for row in records:
    assert row['id'] not in ids, row['id']
    ids.add(row['id'])
    path=root/row['master']
    assert path.is_file(),path
    im=Image.open(path); im.load()
    assert im.mode=='RGBA',f'{path} not RGBA'
    assert min(im.getchannel('A').getextrema())==0 and max(im.getchannel('A').getextrema())==255
    w,h=im.size
    a=im.getchannel('A')
    assert all(a.getpixel(pt)==0 for pt in ((0,0),(w-1,0),(0,h-1),(w-1,h-1)))
    assert a.getbbox() is not None, f'Empty sprite {path}'
    expected=row['sha256'];actual=hashlib.sha256(path.read_bytes()).hexdigest()
    assert expected==actual, f'SHA mismatch on {path}'
    preview=root/row['still_preview']
    assert preview.is_file(),f'Missing preview: {preview}'
    if row['category']=='enemies':assert row['expected_facing']=='left'
print(f'OK: {len(records)} RGBA sprites, 21/21 SHA256 hashes, alpha, corners, separate previews')
print('Note: manual art-lock match, real facing in animations, WebView, and deployment remain unverified by this script.')
