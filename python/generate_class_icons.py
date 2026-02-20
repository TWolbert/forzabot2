#!/usr/bin/env python3
"""Generate Forza class icons as PNG files.

Requires Pillow:
  pip install pillow
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:
    raise SystemExit(
        "Pillow is required. Install with: pip install pillow"
    ) from exc

CLASSES = ["D", "C", "B", "A", "S1", "S2"]
COLORS: Dict[str, str] = {
    "D": "#3dbaea",
    "C": "#f6bf31",
    "B": "#ff6533",
    "A": "#fc355a",
    "S1": "#bd5ee4",
    "S2": "#1567d6",
}
MAX_PI: Dict[str, int] = {
        "D": 500,
        "C": 600,
        "B": 700,
        "A": 800,
        "S1": 900,
        "S2": 998,
}

OUTPUT_DIR = Path("media/classes")
WIDTH = 1280
HEIGHT = 720
CLASS_TEXT_COLOR = "#ffffff"
PI_TEXT_COLOR = "#000000"
PI_BG_COLOR = "#ffffff"


def find_font_path() -> Path | None:
    candidates = [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
    ]
    preferred = []

    for root in candidates:
        root_path = Path(root)
        if not root_path.exists():
            continue
        for font_path in root_path.rglob("*.ttf"):
            name = font_path.name.lower()
            if "bold" in name or "black" in name:
                preferred.append(font_path)
            else:
                preferred.append(font_path)

    return preferred[0] if preferred else None


FONT_PATH = find_font_path()


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if FONT_PATH:
        return ImageFont.truetype(str(FONT_PATH), size=size)
    return ImageFont.load_default()


def fit_font(
    label: str, max_width: int, max_size: int
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = max_size
    while size >= 80:
        font = load_font(size)
        bbox = font.getbbox(label)
        width = bbox[2] - bbox[0]
        if width <= max_width:
            return font
        size -= 10
    return load_font(80)


def create_icon(label: str, color: str, out_path: Path, max_pi: int) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), color)
    draw = ImageDraw.Draw(image)

    class_block_width = int(WIDTH * 0.43)
    pi_block_x = class_block_width
    pi_block_width = WIDTH - class_block_width
    inset_x = int(HEIGHT * 0.05)
    inset_y = int(HEIGHT * 0.12)

    draw.rectangle(
        [
            pi_block_x + inset_x,
            inset_y,
            pi_block_x + pi_block_width - inset_x,
            HEIGHT - inset_y,
        ],
        fill=PI_BG_COLOR,
    )

    label_font = fit_font(label, int(class_block_width * 0.85), int(HEIGHT * 0.95))
    pi_text = str(max_pi)
    pi_font = fit_font(pi_text, int(pi_block_width * 0.75), int(HEIGHT * 0.9))

    label_box = label_font.getbbox(label)
    label_w = label_box[2] - label_box[0]
    label_h = label_box[3] - label_box[1]
    label_x = (class_block_width - label_w) // 2
    label_y = (HEIGHT - label_h) // 2 - label_box[1] // 2
    draw.text((label_x, label_y), label, font=label_font, fill=CLASS_TEXT_COLOR)

    pi_box = pi_font.getbbox(pi_text)
    pi_w = pi_box[2] - pi_box[0]
    pi_h = pi_box[3] - pi_box[1]
    pi_x = pi_block_x + (pi_block_width - pi_w) // 2
    pi_y = (HEIGHT - pi_h) // 2 - pi_box[1] // 2
    draw.text((pi_x, pi_y), pi_text, font=pi_font, fill=PI_TEXT_COLOR)

    image.save(out_path, format="PNG")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if not FONT_PATH:
        print("Warning: no TTF font found; text size may be limited.")
    for label in CLASSES:
        color = COLORS[label]
        file_name = f"{label.lower()}.png"
        out_path = OUTPUT_DIR / file_name
        create_icon(label, color, out_path, MAX_PI[label])
    print(f"Generated {len(CLASSES)} icons in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
