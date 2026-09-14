from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
LOGO = ROOT / "mqtt-local-devtools-logo-final.png"
MQTT_SCREENSHOT = ROOT / "juejin-intro-02-mqtt-panel.png"
HTTP_SCREENSHOT = ROOT / "juejin-intro-03-http-client.png"
FONT = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT), size)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_ratio = size[0] / size[1]
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        height = size[1]
        width = round(height * source_ratio)
    else:
        width = size[0]
        height = round(width / source_ratio)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    left = (width - size[0]) // 2
    top = (height - size[1]) // 2
    return image.crop((left, top, left + size[0], top + size[1]))


def current_screenshot() -> Image.Image:
    return Image.open(MQTT_SCREENSHOT).convert("RGB")


def http_screenshot() -> Image.Image:
    return Image.open(HTTP_SCREENSHOT).convert("RGB")


def gradient_background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            t = y / max(1, height - 1)
            glow = max(0.0, 1.0 - (((x - 930) / 620) ** 2 + ((y - 270) / 520) ** 2))
            pixels[x, y] = (
                int(5 + 3 * t),
                int(13 + 8 * t + 8 * glow),
                int(29 + 12 * t + 21 * glow),
            )
    return image


def add_glow(base: Image.Image, box: tuple[int, int, int, int], color: tuple[int, int, int], radius: int) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(box, fill=(*color, 105))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    base.alpha_composite(layer)


def pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, accent: tuple[int, int, int]) -> int:
    label_font = font(18, bold=True)
    text_box = draw.textbbox((0, 0), text, font=label_font)
    width = text_box[2] - text_box[0] + 42
    x, y = xy
    draw.rounded_rectangle((x, y, x + width, y + 38), 19, fill=(12, 31, 52), outline=(*accent, 165), width=1)
    draw.ellipse((x + 14, y + 15, x + 22, y + 23), fill=accent)
    draw.text((x + 29, y + 7), text, font=label_font, fill=(218, 239, 248))
    return width


def make_cover() -> Image.Image:
    width, height = 1280, 720
    base = gradient_background((width, height)).convert("RGBA")
    add_glow(base, (-180, 340, 470, 990), (0, 214, 255), 110)
    add_glow(base, (820, -240, 1480, 420), (24, 239, 172), 120)
    draw = ImageDraw.Draw(base)

    # Subtle engineering grid.
    for x in range(0, width, 48):
        draw.line((x, 0, x, height), fill=(35, 105, 135, 18), width=1)
    for y in range(0, height, 48):
        draw.line((0, y, width, y), fill=(35, 105, 135, 18), width=1)

    logo = Image.open(LOGO).convert("RGB").resize((176, 176), Image.Resampling.LANCZOS)
    logo_mask = rounded_mask(logo.size, 38)
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((65, 77, 253, 265), 42, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    base.alpha_composite(shadow)
    base.paste(logo, (71, 79), logo_mask)

    draw.text((72, 286), "MQTT Local", font=font(50, bold=True), fill=(239, 250, 255))
    draw.text((72, 342), "DevTools", font=font(50, bold=True), fill=(44, 226, 238))
    draw.text((74, 420), "在浏览器开发者工具中", font=font(25), fill=(167, 192, 211))
    draw.text((74, 458), "实时看懂 MQTT 与 HTTP", font=font(25, bold=True), fill=(218, 241, 249))

    pill(draw, (72, 535), "MQTT 实时监听", (34, 211, 238))
    pill(draw, (72, 583), "cURL HTTP 调试", (32, 231, 166))
    pill(draw, (72, 631), "Payload 字段分类", (55, 143, 255))

    # Real product screenshot in a browser-style frame.
    frame = (486, 92, 1230, 626)
    frame_shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(frame_shadow).rounded_rectangle((frame[0] - 8, frame[1] + 8, frame[2] + 8, frame[3] + 18), 24, fill=(0, 0, 0, 180))
    frame_shadow = frame_shadow.filter(ImageFilter.GaussianBlur(22))
    base.alpha_composite(frame_shadow)
    draw.rounded_rectangle(frame, 22, fill=(11, 22, 35), outline=(49, 177, 213, 110), width=2)
    draw.rounded_rectangle((frame[0], frame[1], frame[2], frame[1] + 44), 22, fill=(16, 33, 49))
    draw.rectangle((frame[0], frame[1] + 22, frame[2], frame[1] + 44), fill=(16, 33, 49))
    for index, color in enumerate(((255, 100, 106), (255, 196, 89), (51, 217, 147))):
        cx = frame[0] + 24 + index * 24
        draw.ellipse((cx - 6, frame[1] + 16, cx + 6, frame[1] + 28), fill=color)
    draw.text((frame[0] + 110, frame[1] + 10), "MQTT + HTTP · DevTools", font=font(17, bold=True), fill=(172, 203, 220))

    content_size = (frame[2] - frame[0] - 20, frame[3] - frame[1] - 58)
    half_height = (content_size[1] - 6) // 2
    screenshot = Image.new("RGB", content_size, (10, 17, 25))
    screenshot.paste(fit_cover(current_screenshot(), (content_size[0], half_height)), (0, 0))
    screenshot.paste(fit_cover(http_screenshot(), (content_size[0], half_height)), (0, half_height + 6))
    ImageDraw.Draw(screenshot).rectangle((0, half_height, content_size[0], half_height + 5), fill=(24, 48, 66))
    screenshot_mask = rounded_mask(content_size, 12)
    base.paste(screenshot, (frame[0] + 10, frame[1] + 50), screenshot_mask)

    draw.text((493, 653), "Chrome / Edge · MQTT over WebSocket · Open Source", font=font(18), fill=(116, 161, 185))
    return base.convert("RGB")


def main() -> None:
    cover = make_cover()
    cover.save(ROOT / "juejin-intro-01-cover.png", optimize=True, compress_level=9)


if __name__ == "__main__":
    main()
