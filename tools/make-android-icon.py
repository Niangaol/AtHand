"""生成顺手 App 图标：墨绿底 + 纸白「顺」，输出各 dpi 尺寸。"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

INK_GREEN = (0x2F, 0x5A, 0x45, 255)
PAPER = (0xFD, 0xFD, 0xF9, 255)
FONT_PATH = r"C:\Windows\Fonts\simhei.ttf"
OUT = Path(r"D:\AgentPrograms\AtHand\android\app\src\main\res")

# Android 各 dpi 的 launcher 图标边长
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def render(size: int) -> Image.Image:
    # 先用 4 倍尺寸绘制再缩小，边缘更平滑
    scale = 4
    big = size * scale
    img = Image.new("RGBA", (big, big), INK_GREEN)
    draw = ImageDraw.Draw(img)

    # 字号约占边长 60%，留出均衡留白
    font_size = int(big * 0.60)
    font = ImageFont.truetype(FONT_PATH, font_size)

    text = "顺"
    # 用 anchor="mm" 让文字以中心对齐
    draw.text((big / 2, big / 2), text, font=font, fill=PAPER, anchor="mm")

    return img.resize((size, size), Image.LANCZOS)


for folder, px in SIZES.items():
    target = OUT / folder
    target.mkdir(parents=True, exist_ok=True)
    icon = render(px)
    icon.save(target / "ic_launcher.png", "PNG")
    print(f"{folder}/ic_launcher.png  {px}x{px}")

# 顺手也给一个高分辨率的自适应图标前景（108dp 基准，取 432px）
adaptive = OUT / "drawable-nodpi"
adaptive.mkdir(parents=True, exist_ok=True)
render(432).save(adaptive / "ic_launcher_large.png", "PNG")
print("drawable-nodpi/ic_launcher_large.png  432x432")
