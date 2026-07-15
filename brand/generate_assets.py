#!/usr/bin/env python3
"""Generate 2post brand assets from the canonical source logo.

Run:
  python brand/generate_assets.py
  python brand/generate_assets.py --check
"""

from __future__ import annotations

import argparse
import base64
import io
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(__file__).resolve().parent / "2post-logo-source.jpg"
BLACK_THRESHOLD = 28
TRANSPARENT_PADDING = 0.12
MASKABLE_SAFE_RATIO = 0.72


@dataclass(frozen=True)
class AssetSpec:
    relpath: str
    size: tuple[int, int]
    kind: str  # transparent | black | og | ico | svg
    format: str
    has_alpha: bool | None = None
    quality: int | None = None


ASSETS: tuple[AssetSpec, ...] = (
    AssetSpec("static/img/2post-logo.webp", (476, 476), "transparent", "WEBP", True, 90),
    AssetSpec(".github/assets/2post-logo.webp", (476, 476), "transparent", "WEBP", True, 90),
    AssetSpec("static/img/2post-mark.webp", (256, 256), "transparent", "WEBP", True, 90),
    AssetSpec("static/favicon/favicon-96x96.png", (96, 96), "black", "PNG", True),
    AssetSpec("static/favicon/apple-touch-icon.png", (180, 180), "black", "PNG", True),
    AssetSpec("static/favicon/web-app-manifest-192x192.png", (192, 192), "maskable", "PNG", True),
    AssetSpec("static/favicon/web-app-manifest-512x512.png", (512, 512), "maskable", "PNG", True),
    AssetSpec("static/img/2post-og.jpg", (1200, 630), "og", "JPEG", False, 90),
    AssetSpec("static/favicon/favicon.ico", (48, 48), "ico", "ICO", True),
    AssetSpec("static/favicon/favicon.svg", (96, 96), "svg", "SVG", True),
)


def load_source() -> Image.Image:
    if not SOURCE.exists():
        raise FileNotFoundError(f"missing source logo: {SOURCE}")
    return Image.open(SOURCE).convert("RGBA")


def content_bbox(image: Image.Image, threshold: int = BLACK_THRESHOLD) -> tuple[int, int, int, int]:
    pixels = image.load()
    width, height = image.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, _a = pixels[x, y]
            if max(r, g, b) > threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("source image has no visible logo content")
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def knock_out_black(image: Image.Image, threshold: int = BLACK_THRESHOLD) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if max(r, g, b) <= threshold:
                pixels[x, y] = (r, g, b, 0)
            else:
                pixels[x, y] = (r, g, b, a)
    return rgba


def fitted_mark(
    mark: Image.Image,
    canvas_size: tuple[int, int],
    *,
    background: tuple[int, int, int, int] | None,
    fill_ratio: float = 1.0 - TRANSPARENT_PADDING,
) -> Image.Image:
    canvas_w, canvas_h = canvas_size
    canvas = Image.new("RGBA", canvas_size, background or (0, 0, 0, 0))
    max_w = max(1, int(canvas_w * fill_ratio))
    max_h = max(1, int(canvas_h * fill_ratio))
    fitted = mark.copy()
    fitted.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    x = (canvas_w - fitted.width) // 2
    y = (canvas_h - fitted.height) // 2
    canvas.alpha_composite(fitted, (x, y))
    return canvas


def extract_mark(source: Image.Image) -> Image.Image:
    cropped = source.crop(content_bbox(source))
    return knock_out_black(cropped)


def render_asset(mark: Image.Image, spec: AssetSpec) -> bytes:
    if spec.kind == "transparent":
        image = fitted_mark(mark, spec.size, background=None)
        return encode_image(image, spec)
    if spec.kind == "black":
        image = fitted_mark(mark, spec.size, background=(0, 0, 0, 255))
        return encode_image(image, spec)
    if spec.kind == "maskable":
        image = fitted_mark(
            mark,
            spec.size,
            background=(0, 0, 0, 255),
            fill_ratio=MASKABLE_SAFE_RATIO,
        )
        return encode_image(image, spec)
    if spec.kind == "og":
        canvas = Image.new("RGB", spec.size, (0, 0, 0))
        max_side = int(min(spec.size) * 0.58)
        fitted = mark.copy()
        fitted.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        x = (spec.size[0] - fitted.width) // 2
        y = (spec.size[1] - fitted.height) // 2
        canvas.paste(fitted, (x, y), fitted)
        return encode_image(canvas, spec)
    if spec.kind == "ico":
        images = []
        for size in (16, 32, 48):
            images.append(fitted_mark(mark, (size, size), background=(0, 0, 0, 255)))
        buffer = io.BytesIO()
        images[-1].save(
            buffer,
            format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48)],
            append_images=images[:-1],
        )
        return buffer.getvalue()
    if spec.kind == "svg":
        png = fitted_mark(mark, spec.size, background=(0, 0, 0, 255))
        png_bytes = encode_image(png, AssetSpec(spec.relpath, spec.size, "black", "PNG", True))
        b64 = base64.b64encode(png_bytes).decode("ascii")
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {spec.size[0]} {spec.size[1]}">'
            f'<image href="data:image/png;base64,{b64}" width="{spec.size[0]}" height="{spec.size[1]}"/>'
            f"</svg>\n"
        )
        return svg.encode("utf-8")
    raise ValueError(f"unknown asset kind: {spec.kind}")


def encode_image(image: Image.Image, spec: AssetSpec) -> bytes:
    buffer = io.BytesIO()
    save_kwargs: dict = {}
    out = image
    if spec.format == "JPEG":
        out = image.convert("RGB")
        save_kwargs["quality"] = spec.quality or 90
        save_kwargs["optimize"] = True
    elif spec.format == "WEBP":
        save_kwargs["quality"] = spec.quality or 90
        save_kwargs["method"] = 6
    elif spec.format == "PNG":
        save_kwargs["optimize"] = True
    out.save(buffer, format=spec.format, **save_kwargs)
    return buffer.getvalue()


def write_asset(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def inspect_alpha(path: Path) -> bool | None:
    if path.suffix.lower() == ".svg":
        return True
    if path.suffix.lower() == ".ico":
        with Image.open(path) as image:
            return image.mode in {"RGBA", "LA", "P"}
    with Image.open(path) as image:
        if image.mode in {"RGBA", "LA"}:
            return True
        if image.mode == "P":
            return "transparency" in image.info
        return False


def inspect_size(path: Path) -> tuple[int, int] | None:
    if path.suffix.lower() == ".svg":
        return (96, 96)
    with Image.open(path) as image:
        return image.size


def corner_is_black(path: Path) -> bool:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        width, height = rgba.size
        samples = [
            rgba.getpixel((0, 0)),
            rgba.getpixel((width - 1, 0)),
            rgba.getpixel((0, height - 1)),
            rgba.getpixel((width - 1, height - 1)),
        ]
    return all(max(sample[:3]) <= BLACK_THRESHOLD and sample[3] > 200 for sample in samples)


def check_assets() -> list[str]:
    errors: list[str] = []
    for spec in ASSETS:
        path = ROOT / spec.relpath
        if not path.exists():
            errors.append(f"missing {spec.relpath}")
            continue
        if path.stat().st_size < 64:
            errors.append(f"too small: {spec.relpath}")
        if spec.kind == "svg":
            text = path.read_text(encoding="utf-8")
            if "data:image/png;base64," not in text:
                errors.append(f"svg missing embedded png: {spec.relpath}")
            continue
        size = inspect_size(path)
        if size != spec.size and spec.kind != "ico":
            errors.append(f"size mismatch for {spec.relpath}: {size} != {spec.size}")
        has_alpha = inspect_alpha(path)
        if spec.has_alpha is not None and has_alpha is not None and has_alpha != spec.has_alpha and spec.kind != "ico":
            errors.append(f"alpha mismatch for {spec.relpath}: {has_alpha} != {spec.has_alpha}")
        if spec.kind in {"black", "maskable", "og"} and path.suffix.lower() != ".ico":
            if not corner_is_black(path if path.suffix.lower() != ".svg" else path):
                # OG and black canvases should keep black corners.
                with Image.open(path) as image:
                    rgb = image.convert("RGB")
                    corners = [
                        rgb.getpixel((0, 0)),
                        rgb.getpixel((rgb.size[0] - 1, 0)),
                        rgb.getpixel((0, rgb.size[1] - 1)),
                        rgb.getpixel((rgb.size[0] - 1, rgb.size[1] - 1)),
                    ]
                if not all(max(c) <= BLACK_THRESHOLD for c in corners):
                    errors.append(f"expected black corners: {spec.relpath}")
        if spec.kind == "transparent":
            with Image.open(path) as image:
                rgba = image.convert("RGBA")
                corners = [
                    rgba.getpixel((0, 0)),
                    rgba.getpixel((rgba.size[0] - 1, 0)),
                    rgba.getpixel((0, rgba.size[1] - 1)),
                    rgba.getpixel((rgba.size[0] - 1, rgba.size[1] - 1)),
                ]
            if not all(c[3] == 0 for c in corners):
                errors.append(f"expected transparent corners: {spec.relpath}")
        if spec.kind == "maskable":
            with Image.open(path) as image:
                rgba = image.convert("RGBA")
                width, height = rgba.size
                left = int(width * 0.2)
                top = int(height * 0.2)
                right = int(width * 0.8)
                bottom = int(height * 0.8)
                bright = 0
                for y in range(top, bottom):
                    for x in range(left, right):
                        if max(rgba.getpixel((x, y))[:3]) > BLACK_THRESHOLD:
                            bright += 1
            if bright < 40:
                errors.append(f"maskable center empty: {spec.relpath}")
    return errors


def generate() -> None:
    mark = extract_mark(load_source())
    for spec in ASSETS:
        payload = render_asset(mark, spec)
        write_asset(ROOT / spec.relpath, payload)
        print(f"wrote {spec.relpath} ({len(payload)} bytes)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate generated assets without writing")
    args = parser.parse_args(argv)

    if args.check:
        errors = check_assets()
        if errors:
            for error in errors:
                print(error, file=sys.stderr)
            return 1
        print(f"ok: {len(ASSETS)} brand assets")
        return 0

    generate()
    errors = check_assets()
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"ok: generated and checked {len(ASSETS)} brand assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
