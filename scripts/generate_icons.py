from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src-tauri" / "icons"


def make_icon(size: int) -> Image.Image:
    scale = size / 512
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (24 * scale, 24 * scale, 488 * scale, 488 * scale),
        radius=116 * scale,
        fill=(18, 25, 48, 255),
    )
    draw.rounded_rectangle(
        (58 * scale, 58 * scale, 454 * scale, 454 * scale),
        radius=92 * scale,
        fill=(79, 95, 221, 255),
    )

    bars = (
        (139, 205, 189, 345),
        (218, 132, 268, 361),
        (297, 226, 347, 339),
    )
    for left, top, right, bottom in bars:
        draw.rounded_rectangle(
            (
                left * scale,
                top * scale,
                right * scale,
                bottom * scale,
            ),
            radius=24 * scale,
            fill=(255, 255, 255, 255),
        )

    return image.rotate(-12, resample=Image.Resampling.BICUBIC)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    outputs = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for filename, size in outputs.items():
        make_icon(size).save(ICON_DIR / filename, optimize=True)

    make_icon(256).save(
        ICON_DIR / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
