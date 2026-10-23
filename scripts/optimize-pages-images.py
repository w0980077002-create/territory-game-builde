"""Fast GitHub Pages image optimization with Pillow instead of apt-get/ffmpeg.

The approved original artwork is never changed. These WebP files are placed
only in dist after Vite builds, preserving the existing paths and alpha.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DIST = ROOT / "dist"


def open_image(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"Required game art missing: {path}")
    return Image.open(path)


def scale(image: Image.Image, max_side: int, multiple: int) -> Image.Image:
    width, height = image.size
    if max(width, height) <= max_side:
        return image
    ratio = max_side / max(width, height)
    target = (
        max(multiple, int(width * ratio) // multiple * multiple),
        max(multiple, int(height * ratio) // multiple * multiple),
    )
    return image.resize(target, Image.Resampling.LANCZOS)


def save_webp(img: Image.Image, path: Path, quality: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    # RGB/RGBA both preserve the approved visual; RGBA retains transparency.
    img.save(path, format="WEBP", quality=quality, method=4)


for name in ("art-atlas", "hero-frames", "lagoon"):
    source = PUBLIC / "monopoly" / f"{name}.png"
    target = DIST / "monopoly" / f"{name}.webp"
    with open_image(source) as image:
        max_side = 1600 if name == "lagoon" else 2048
        converted = scale(image, max_side, 4)
        save_webp(converted, target, 84)
    if target.stat().st_size < 1024 or target.stat().st_size >= source.stat().st_size:
        raise RuntimeError(f"Invalid WebP optimization: {source} -> {target}")
    print(f"Monopoly {name}: {source.stat().st_size // 1024} KB -> {target.stat().st_size // 1024} KB")


for name in ("map-bg", "map-chamber", "map-forest", "map-mountain", "map-herbs", "map-hunting", "map-rare"):
    source = PUBLIC / f"{name}.webp"
    target = DIST / f"{name}.webp"
    if not target.is_file():
        raise FileNotFoundError(f"Vite must copy source map art before optimizing: {target}")
    old_size = target.stat().st_size
    temp = DIST / f"{name}.optimized.webp"
    try:
        with open_image(source) as image:
            max_side = 1200 if name == "map-bg" else 900 if name == "map-chamber" else 720
            save_webp(scale(image, max_side, 2), temp, 80)
        if 1024 <= temp.stat().st_size < old_size:
            temp.replace(target)
            print(f"Map {name}: {old_size // 1024} KB -> {target.stat().st_size // 1024} KB")
        else:
            print(f"Map {name}: retained original ({old_size // 1024} KB)")
    finally:
        temp.unlink(missing_ok=True)

print("Pages image optimization passed.")
