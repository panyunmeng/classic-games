"""程序化生成 fnOS 应用图标：深色圆角底 + 霓虹「CG」字样 + 四色游戏格。
零外部素材，完全由 Pillow 绘制。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "packaging" / "fnapp"
BG = (10, 13, 22, 255)
COLORS = [(108, 240, 168), (106, 217, 255), (242, 184, 75), (240, 132, 156)]


def font(size):
    for path in [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        p = Path(path)
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def make(size, name):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    r = int(size * 0.22)
    d.rounded_rectangle([2, 2, size - 3, size - 3], radius=r, fill=BG,
                        outline=(40, 52, 78, 255), width=max(2, size // 128))

    # 四色小格，暗示「多款游戏」
    cell = size * 0.13
    gap = size * 0.035
    ox = (size - (2 * cell + gap)) / 2
    oy = size * 0.16
    for i, color in enumerate(COLORS):
        x = ox + (i % 2) * (cell + gap)
        y = oy + (i // 2) * (cell + gap)
        d.rounded_rectangle([x, y, x + cell, y + cell], radius=cell * 0.28, fill=color + (255,))

    f = font(int(size * 0.30))
    text = "CG"
    box = d.textbbox((0, 0), text, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((size - tw) / 2, size * 0.55 - th / 2), text, font=f, fill=(232, 237, 247, 255))

    img.save(OUT / name)
    print(f"生成 {name}: {size}x{size}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make(64, "ICON.PNG")
    make(256, "ICON_256.PNG")
    src64 = OUT / "ICON.PNG"
    # app/ui/images/icon_64.png / icon_256.png
    images = OUT / "app" / "ui" / "images"
    images.mkdir(parents=True, exist_ok=True)
    Image.open(src64).save(images / "icon_64.png")
    Image.open(OUT / "ICON_256.PNG").save(images / "icon_256.png")
    print("图标就绪")
