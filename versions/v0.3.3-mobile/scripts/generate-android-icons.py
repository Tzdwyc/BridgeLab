from pathlib import Path
import sys

from PIL import Image


SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate-android-icons.py SOURCE_ICON RES_DIRECTORY")
    source = Path(sys.argv[1]).resolve()
    res = Path(sys.argv[2]).resolve()
    image = Image.open(source).convert("RGBA")
    for folder, size in SIZES.items():
        target_dir = res / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        image.resize((size, size), Image.Resampling.LANCZOS).save(target_dir / "ic_launcher.png")


if __name__ == "__main__":
    main()
