#!/usr/bin/env python3
"""Verify the repository's split v2 art package, optionally extract for local QA.

No downloads, game integration, production access or execution of archive scripts.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

EXPECTED_SHA = 'd8bd7c242accd3396232a53cae7fe47478c4b6aae558b95dbad0c68edf5c1fa1'
ROOT = Path(__file__).resolve().parents[1]


def verify(extract_to=None):
    parts = []
    for number in range(1, 4):
        with zipfile.ZipFile(ROOT / f'TERRITORY_art_v2_Codex_{number}_of_3.zip') as transport:
            matches = [n for n in transport.namelist() if n.endswith(f'.part{number:02}')]
            if len(matches) != 1:
                raise ValueError(f'Expected one part {number}, got {matches}')
            parts.append(transport.read(matches[0]))
    data = b''.join(parts)
    actual = hashlib.sha256(data).hexdigest()
    if actual != EXPECTED_SHA:
        raise ValueError(f'Archive SHA256 mismatch: {actual}')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in entry.filename:
                raise ValueError(f'Unsafe archive path: {entry.filename}')
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f'Corrupt archive entry: {corrupt}')
        manifests = [n for n in archive.namelist() if n.endswith('/manifest.json')]
        if len(manifests) != 1:
            raise ValueError('Expected one manifest')
        base = str(PurePosixPath(manifests[0]).parent)
        records = json.loads(archive.read(manifests[0]))['files']
        if len(records) != 21 or len({r['id'] for r in records}) != 21:
            raise ValueError('Expected 21 unique characters')
        for row in records:
            master = archive.read(f"{base}/{row['master']}")
            if hashlib.sha256(master).hexdigest() != row['sha256']:
                raise ValueError(f"PNG checksum mismatch: {row['id']}")
            archive.read(f"{base}/{row['still_preview']}")
        if extract_to:
            target = Path(extract_to).resolve()
            # A fresh directory prevents overwrites and symlink traversal.
            target.mkdir(parents=True, exist_ok=False)
            archive.extractall(target)
            print(f'Extracted for local QA: {target / base}')
    print(f'PASS: archive SHA256 {actual}; ZIP CRC; 21 unique PNG hashes and previews')
    print('Still images verified. Animation, visual approval and game integration require separate work.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-to', help='New local directory; fails if it already exists')
    args = parser.parse_args()
    verify(args.extract_to)
