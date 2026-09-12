from PIL import Image, ImageDraw, ImageFont, ImageFilter
import glob
import math
import os
import subprocess
import shutil


W, H = 1080, 1920
FPS = 20
DURATION = 15
OUT = "/Users/yoshitakaosawa/Desktop/sumasai-tiktok-15s.mp4"
GIF_OUT = "/Users/yoshitakaosawa/Desktop/sumasai-tiktok-15s.gif"
POSTER = "/Users/yoshitakaosawa/Desktop/sumasai-tiktok-poster.png"
FRAMES_DIR = "/tmp/sumasai_tiktok_frames"
SWIFT_ENCODER = "/Users/yoshitakaosawa/ai-grading-app/scripts/png_frames_to_mp4.swift"


def font_path(weight="W6"):
    candidates = glob.glob(f"/System/Library/Fonts/*角*{weight}.ttc")
    if candidates:
        return candidates[0]
    candidates = glob.glob("/System/Library/Fonts/ヒラ*角*.ttc")
    if candidates:
        return candidates[-1]
    return "/System/Library/Fonts/Helvetica.ttc"


FONT_BOLD = font_path("W7")
FONT_MED = font_path("W5")


def f(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_MED, size)


RED = (190, 22, 25)
DARK = (22, 28, 42)
MUTED = (95, 108, 130)
PALE = (248, 250, 252)
BLUE = (79, 70, 229)
GREEN = (20, 168, 98)


def ease(x):
    x = max(0, min(1, x))
    return 1 - (1 - x) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def rounded_rect(draw, xy, r, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def draw_center(draw, text, y, font, fill, max_width=None, spacing=10):
    lines = []
    if max_width:
        current = ""
        for part in text.split(" "):
            trial = part if not current else current + " " + part
            if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = part
        if current:
            lines.append(current)
    else:
        lines = text.split("\n")
    total_h = sum(draw.textbbox((0, 0), line, font=font)[3] for line in lines) + spacing * (len(lines) - 1)
    yy = y - total_h / 2
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        draw.text(((W - (bbox[2] - bbox[0])) / 2, yy), line, font=font, fill=fill)
        yy += (bbox[3] - bbox[1]) + spacing


def draw_logo(draw, x, y, scale=1.0):
    size = int(112 * scale)
    rounded_rect(draw, (x, y, x + size, y + size), int(20 * scale), RED)
    draw.text((x + size * 0.33, y + size * 0.18), "S", font=f(int(68 * scale), True), fill="white")
    draw.text((x + size + int(22 * scale), y + int(22 * scale)), "スマサイ", font=f(int(44 * scale), True), fill=RED)


def draw_phone(draw, x, y, w, h, progress=1.0):
    rounded_rect(draw, (x, y, x + w, y + h), 46, (255, 255, 255), (222, 226, 232), 3)
    rounded_rect(draw, (x + 34, y + 30, x + w - 34, y + h - 30), 34, (250, 250, 250))
    draw.text((x + 72, y + 86), "慶應義塾大学 英語", font=f(30, True), fill=DARK)
    rounded_rect(draw, (x + 72, y + 150, x + w - 72, y + 210), 8, (255, 244, 244), (245, 190, 190), 2)
    draw.text((x + 94, y + 164), "記述問題", font=f(24, True), fill=RED)
    for i in range(4):
        yy = y + 250 + i * 92
        rounded_rect(draw, (x + 72, yy, x + w - 72, yy + 54), 8, (242, 245, 249), (229, 233, 240), 1)
        draw.rectangle((x + 92, yy + 20, x + int(lerp(220, w - 116, min(1, progress + i * 0.08))), yy + 34), fill=(178, 188, 204))
    rounded_rect(draw, (x + 72, y + 670, x + w - 72, y + 748), 10, RED)
    draw_center(draw, "採点する", y + 709, f(30, True), "white")
    rounded_rect(draw, (x + 72, y + 820, x + w - 72, y + 990), 10, (244, 249, 255), (207, 226, 245), 2)
    draw.text((x + 96, y + 846), "自由記述 採点結果", font=f(24, True), fill=DARK)
    draw.text((x + w - 210, y + 842), "13.0 / 15点", font=f(28, True), fill=(0, 113, 188))
    draw.text((x + 96, y + 908), "採点理由と次に直すことまで表示", font=f(24, True), fill=MUTED)


def bg():
    img = Image.new("RGB", (W, H), (255, 255, 255))
    pix = img.load()
    for y in range(H):
        r = int(255 - y / H * 8)
        g = int(255 - y / H * 10)
        b = int(255 - y / H * 12)
        for x in range(W):
            pix[x, y] = (r, g, b)
    return img


def frame_at(t):
    img = bg()
    draw = ImageDraw.Draw(img)

    draw_logo(draw, 72, 76, 0.78)
    rounded_rect(draw, (760, 92, 1008, 144), 26, (255, 248, 231), (246, 180, 70), 2)
    draw_center(draw, "2週間プレミアム無料", 118, f(22, True), (166, 90, 0))

    if t < 3:
        p = ease(t / 3)
        draw_center(draw, "過去問、\n解いたあと放置してない？", int(520 - 40 + 40 * p), f(76, True), DARK)
        draw_center(draw, "記述問題は、自分だけだと採点しにくい。", 790, f(36, True), MUTED)
        for i in range(5):
            yy = 1020 + i * 95
            alpha = ease((t - 0.5 - i * 0.18) / 0.8)
            x = int(90 + (1 - alpha) * 80)
            rounded_rect(draw, (x, yy, 990, yy + 62), 10, (255, 245, 245), (246, 210, 210), 2)
            draw.text((x + 28, yy + 15), f"問{i + 1}　記述答案", font=f(26, True), fill=(90, 90, 90))
    elif t < 6:
        p = ease((t - 3) / 3)
        draw_center(draw, "スマサイなら", 330, f(58, True), RED)
        draw_center(draw, "答案を入れるだけで\nAIが採点", 505, f(78, True), DARK)
        draw_phone(draw, int(295 + (1 - p) * 180), 760, 490, 680, p)
    elif t < 10:
        p = ease((t - 6) / 4)
        draw_center(draw, "点数だけじゃない", 300, f(58, True), RED)
        badges = [("採点理由", BLUE), ("詳細解説", GREEN), ("復習アドバイス", RED)]
        for i, (text, color) in enumerate(badges):
            yy = 470 + i * 165
            x = int(135 + (1 - ease((t - 6.3 - i * 0.25) / 0.9)) * 100)
            rounded_rect(draw, (x, yy, 945, yy + 108), 16, (255, 255, 255), (225, 231, 239), 2)
            draw.ellipse((x + 30, yy + 28, x + 82, yy + 80), fill=color)
            draw.text((x + 112, yy + 30), text, font=f(40, True), fill=DARK)
        draw_center(draw, "どこで失点したかが見える", 1120, f(46, True), MUTED)
    elif t < 13:
        p = ease((t - 10) / 3)
        draw_center(draw, "最初の2週間", 420, f(68, True), DARK)
        draw_center(draw, "プレミアム無料", 545, f(86, True), RED)
        rounded_rect(draw, (150, 760, 930, 1110), 18, PALE, (226, 232, 240), 3)
        rows = [("採点回数", "無制限"), ("詳細解説", "利用可能"), ("AI質問", "利用可能")]
        for i, (left, right) in enumerate(rows):
            yy = 820 + i * 92
            draw.text((210, yy), left, font=f(34, True), fill=DARK)
            draw.text((710, yy), right, font=f(34, True), fill=RED)
    else:
        p = ease((t - 13) / 2)
        draw_center(draw, "過去問採点を、\n次の一手につなげよう。", 520, f(68, True), DARK)
        rounded_rect(draw, (180, 940, 900, 1048), 16, RED)
        draw_center(draw, "スマサイで始める", 994, f(42, True), "white")
        draw_center(draw, "smart-saiten.com", 1155, f(38, True), MUTED)

    # subtle vignette
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rectangle((0, 0, W, 12), fill=(190, 22, 25, 255))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.isdir(FRAMES_DIR):
        shutil.rmtree(FRAMES_DIR)
    os.makedirs(FRAMES_DIR, exist_ok=True)

    first = frame_at(0)
    first.save(POSTER)

    frame_count = FPS * DURATION
    frames = []
    for i in range(frame_count):
        frame = frame_at(i / FPS)
        frame.save(os.path.join(FRAMES_DIR, f"frame_{i:04d}.png"))
        frames.append(frame)

    frames[0].save(
        GIF_OUT,
        save_all=True,
        append_images=frames[1:],
        duration=int(1000 / FPS),
        loop=0,
        optimize=False,
    )

    cmd = ["swift", SWIFT_ENCODER, FRAMES_DIR, OUT, str(FPS), str(W), str(H), str(frame_count)]
    code = subprocess.call(cmd)
    if code != 0:
        print(GIF_OUT)
        raise SystemExit(code)
    print(OUT)
    print(GIF_OUT)
    print(POSTER)


if __name__ == "__main__":
    main()
