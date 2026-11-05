#!/usr/bin/env python3
"""VIP ART 52 integrity gate; does not replace visual owner approval."""
import hashlib
import re
import sys
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs/TERRITORY_VIP_ART_52_CODEX_TZ_RU.md"
PUBLIC = Path("public/assets/territory/vip/v2")
SOURCES = Path("artwork/territory/vip/v2")
BADGES = ROOT / "public/assets/territory/vip/badges"
ROW = re.compile(r"^\|\s*(\d+)\s*\|\s*\x60(public/assets/territory/vip/v2/[^\x60]+\.webp)\x60\s*\|.*?\|\s*(\d+)[×x](\d+)\s*\|\s*(Да|Нет)\s*\|")
OLD_SHA = (
    "2a39cd211f04f200cd8034152c630c66d1a1e962",
    "c2945c8a88bc07a3b545092857784ae27e217038",
    "cff0863095cb16f5a29490cd49acf465c3562186",
    "ca849db86157f34dfb7760f1d64bedebb879122a",
    "8248b0c07fbd57247ecff15c5cc469b3275b357a",
    "14ed835c6753cda1749586da7d8703f4d4bab372",
    "8ed8109d810c10008c572480535a6f410114ec74",
    "2be84822c4584d0b815f1411156233292493f861",
    "4f4a37609416078064e14ef98ec40f6392a7074b",
    "70506979a8d9cc49d9e9bdca9cd5d16dbf67c99a",
)

def run():
    errors = []
    rows = []
    for line in SPEC.read_text(encoding="utf-8").splitlines():
        m = ROW.match(line)
        if m:
            n, path, w, h, alpha = m.groups()
            rows.append((int(n), Path(path), (int(w), int(h)), alpha == "Да"))
    if len(rows) != 52 or [r[0] for r in rows] != list(range(1, 53)):
        errors.append("The art specification must list 52 numbered assets")
    paths = [r[1] for r in rows]
    if len(set(paths)) != len(paths):
        errors.append("Duplicate paths in manifest")
    expected = {ROOT / r[1] for r in rows}
    for extra in (ROOT / PUBLIC).rglob("*.webp"):
        if extra not in expected:
            errors.append(f"Unexpected client file: {extra.relative_to(ROOT)}")
    counts = {"WEBP": 0, "PNG": 0}
    seen = {"WEBP": {}, "PNG": {}}
    for _, webp, size, requires_alpha in rows:
        relative = webp.relative_to(PUBLIC)
        png = SOURCES / relative.with_suffix(".png")
        for path, fmt in ((webp, "WEBP"), (png, "PNG")):
            file = ROOT / path
            if not file.is_file() or file.stat().st_size < 128:
                errors.append(f"Missing or empty {path}")
                continue
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            if digest in seen[fmt]:
                errors.append(f"Repeated illustration: {path} identical to {seen[fmt][digest]}")
            seen[fmt][digest] = path
            try:
                with Image.open(file) as img:
                    if img.format != fmt or img.size != size:
                        errors.append(f"Wrong dimensions/format: {path}, got {img.format} {img.size}, expected {fmt} {size}")
                        continue
                    a_min, a_max = img.convert("RGBA").getchannel("A").getextrema()
                    if requires_alpha and (a_min >= 250 or a_max == 0):
                        errors.append(f"No genuine transparent background: {path}")
                        continue
                    if not requires_alpha and a_min != 255:
                        errors.append(f"Background scene must be opaque: {path}")
                        continue
                    counts[fmt] += 1
                    if fmt == "WEBP":
                        kind = relative.parts[0]
                        budget = 550000 if kind == "scene" else 450000 if kind in ("main", "skins", "thrones", "auras") else 250000
                        if file.stat().st_size > budget:
                            errors.append(f"Over WebP size target: {path}")
            except (OSError, ValueError, UnidentifiedImageError) as exc:
                errors.append(f"Unreadable image: {path}: {exc}")
    new_badges = 0
    for i, old in enumerate(OLD_SHA, start=1):
        path = BADGES / f"vip-{i:02}.svg"
        if not path.is_file():
            errors.append(f"Missing badge {path.relative_to(ROOT)}")
            continue
        data = path.read_bytes()
        try:
            if ElementTree.fromstring(data).tag.rsplit("}", 1)[-1] != "svg":
                raise ValueError("No svg root")
        except (ElementTree.ParseError, ValueError):
            errors.append(f"Corrupt badge {path.relative_to(ROOT)}")
            continue
        gitsha = hashlib.sha1(("blob " + str(len(data)) + "\0").encode() + data).hexdigest()
        if gitsha == old:
            errors.append(f"Old badge unchanged: {path.relative_to(ROOT)}")
        else:
            new_badges += 1
    print(f"VIP ART 52: {counts['WEBP']}/52 WebP; {counts['PNG']}/52 PNG masters; {new_badges}/10 badges updated")
    if errors:
        print(f"FAIL — {len(errors)} gate violations:")
        for e in errors[:15]:
            print(" - " + e)
        if len(errors) > 15:
            print(f" - and {len(errors) - 15} more")
        return 1
    print("PASS — integrity only; quality, composition, mobile QA and owner acceptance are separate gates")
    return 0

if __name__ == "__main__":
    sys.exit(run())
