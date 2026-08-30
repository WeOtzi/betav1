# -*- coding: utf-8 -*-
"""Genera las placas de interfaz y cierre para el comercial."""

from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


HERE = Path(__file__).parent
UI = HERE / "ui"
UI.mkdir(exist_ok=True)

FRAUNCES = HERE.parent / "promo-a-ustedes" / "fonts_ttf" / "fraunces600.ttf"
INTER = HERE.parent / "promo-a-ustedes" / "fonts_ttf" / "intertight600.ttf"
MARA = HERE / "stills" / "mara-master.png"
TATTOO = HERE.parent / "promo-a-ustedes" / "stills" / "s7.webp"

W, H = 1920, 1080
IVORY = (242, 237, 228)
PAPER = (250, 247, 241)
OBSIDIAN = (7, 8, 11)
INK = (22, 23, 27)
AMBER = (232, 137, 59)
TAUPE = (151, 145, 135)
PALE = (226, 220, 210)


def font(size, serif=False):
    return ImageFont.truetype(str(FRAUNCES if serif else INTER), size=size)


def gradient(top, bottom):
    im = Image.new("RGB", (W, H), top)
    draw = ImageDraw.Draw(im)
    for y in range(H):
        t = y / max(1, H - 1)
        color = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        draw.line((0, y, W, y), fill=color)
    return im.convert("RGBA")


def add_shadow(im, box, radius=34, opacity=42, offset=(0, 18)):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    dx, dy = offset
    d.rounded_rectangle((x0 + dx, y0 + dy, x1 + dx, y1 + dy), radius=radius, fill=(0, 0, 0, opacity))
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(22)))


def rounded_panel(im, box, fill, radius=34, outline=None, width=1, shadow=True):
    if shadow:
        add_shadow(im, box, radius)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def label(draw, xy, text, fill=AMBER, size=26):
    draw.text(xy, text.upper(), font=font(size), fill=fill)


def brand(draw, dark=False):
    color = IVORY if dark else OBSIDIAN
    draw.text((118, 64), "WE ÖTZI", font=font(35, serif=True), fill=color)
    draw.ellipse((305, 77, 313, 85), fill=AMBER)


def paste_rounded(base, source, box, radius=26):
    x0, y0, x1, y1 = box
    size = (x1 - x0, y1 - y0)
    fitted = ImageOps.fit(source.convert("RGB"), size, method=Image.Resampling.LANCZOS)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    base.paste(fitted, (x0, y0), mask)


def save(im, name):
    im.convert("RGB").save(UI / name, quality=95)


def star_points(cx, cy, outer=12, inner=5):
    points = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        radius = outer if i % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def agenda():
    im = gradient(IVORY, (232, 224, 213))
    d = ImageDraw.Draw(im)
    brand(d)
    label(d, (118, 196), "AGENDA")
    d.multiline_text((118, 245), "Tu día,\nde un vistazo.", font=font(100, serif=True), fill=OBSIDIAN, spacing=-5)
    d.multiline_text((122, 505), "Sesiones, horarios y guest spots\nen una sola agenda.", font=font(34), fill=(73, 70, 66), spacing=12)
    d.line((122, 682, 690, 682), fill=(184, 176, 166), width=2)
    d.text((122, 718), "MENOS TIEMPO ORDENANDO.\nMÁS TIEMPO CREANDO.", font=font(25), fill=OBSIDIAN, spacing=10)

    panel = (850, 90, 1785, 990)
    rounded_panel(im, panel, PAPER, radius=54, shadow=True)
    d = ImageDraw.Draw(im)
    d.text((915, 145), "MARTES 18", font=font(31), fill=OBSIDIAN)
    d.text((1570, 151), "HOY", font=font(21), fill=AMBER)
    days = [("L", "17"), ("M", "18"), ("X", "19"), ("J", "20"), ("V", "21")]
    for i, (day, num) in enumerate(days):
        x = 920 + i * 155
        active = i == 1
        fill = OBSIDIAN if active else (236, 231, 222)
        fg = IVORY if active else (93, 89, 83)
        d.rounded_rectangle((x, 215, x + 112, 315), radius=25, fill=fill)
        d.text((x + 46, 233), day, font=font(20), fill=AMBER if active else TAUPE, anchor="ma")
        d.text((x + 56, 281), num, font=font(31), fill=fg, anchor="mm")

    events = [
        (375, "09:30", "DISEÑO", "Camila R.", AMBER),
        (525, "14:00", "SESIÓN", "Bruno L.", OBSIDIAN),
        (675, "19:00", "GUEST SPOT", "Nómade Studio", AMBER),
    ]
    for y, time, kind, who, accent in events:
        d.rounded_rectangle((915, y, 1720, y + 118), radius=24, fill=(255, 253, 249), outline=(224, 217, 207), width=2)
        d.rounded_rectangle((940, y + 22, 948, y + 96), radius=4, fill=accent)
        d.text((978, y + 25), time, font=font(24), fill=TAUPE)
        d.text((1110, y + 24), kind, font=font(25), fill=OBSIDIAN)
        d.text((1110, y + 66), who, font=font(22), fill=(94, 90, 84))
    d.rounded_rectangle((915, 865, 1720, 925), radius=28, fill=OBSIDIAN)
    d.text((1318, 895), "VER AGENDA", font=font(23), fill=IVORY, anchor="mm")
    save(im, "01-agenda.png")


def quotation():
    im = gradient(OBSIDIAN, (20, 18, 17))
    d = ImageDraw.Draw(im)
    brand(d, dark=True)
    label(d, (118, 196), "SOLICITUDES + COTIZACIONES")
    d.multiline_text((118, 245), "Una idea\nllega completa.", font=font(88, serif=True), fill=IVORY, spacing=-2)
    d.multiline_text((122, 500), "Referencias, notas y conversación\nreunidas antes de cotizar.", font=font(33), fill=(199, 193, 183), spacing=12)
    d.text((122, 716), "EL CRITERIO SIGUE SIENDO TUYO.", font=font(25), fill=AMBER)

    rounded_panel(im, (835, 78, 1785, 1000), PAPER, radius=54, shadow=True)
    d = ImageDraw.Draw(im)
    d.text((905, 130), "NUEVA SOLICITUD", font=font(25), fill=AMBER)
    d.text((905, 185), "Camila R.", font=font(42, serif=True), fill=OBSIDIAN)
    d.text((905, 247), "Antebrazo · Fine line", font=font(24), fill=(91, 87, 81))
    refs = [
        HERE.parent / "promo-a-ustedes" / "stills" / "s5a.webp",
        HERE.parent / "promo-a-ustedes" / "stills" / "s5b.webp",
        TATTOO,
    ]
    for i, ref in enumerate(refs):
        if ref.exists():
            paste_rounded(im, Image.open(ref), (905 + i * 250, 310, 1125 + i * 250, 448), radius=18)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((905, 490, 1708, 600), radius=24, fill=(235, 230, 221))
    d.text((936, 515), "NOTA DE LA CLIENTA", font=font(19), fill=TAUPE)
    d.text((936, 553), "“Quiero llevar conmigo un recuerdo de casa.”", font=font(22), fill=OBSIDIAN)
    d.text((905, 655), "DURACIÓN ESTIMADA", font=font(19), fill=TAUPE)
    d.text((905, 695), "3 horas", font=font(29), fill=OBSIDIAN)
    d.text((1280, 655), "SEÑA", font=font(19), fill=TAUPE)
    d.text((1280, 695), "30%", font=font(29), fill=OBSIDIAN)
    d.rounded_rectangle((905, 790, 1708, 862), radius=32, fill=AMBER)
    d.text((1306, 826), "ENVIAR COTIZACIÓN", font=font(24), fill=OBSIDIAN, anchor="mm")
    d.text((1306, 925), "Todo el contexto. Una decisión más clara.", font=font(21), fill=(101, 96, 89), anchor="mm")
    save(im, "02-cotizacion.png")


def guest_spot():
    im = gradient(IVORY, (229, 222, 212))
    d = ImageDraw.Draw(im)
    brand(d)
    label(d, (118, 196), "GUEST SPOTS + SEDES")
    d.multiline_text((118, 245), "Moverte,\nsin perderte.", font=font(100, serif=True), fill=OBSIDIAN, spacing=-5)
    d.multiline_text((122, 510), "La oportunidad, la sede y la dirección\nviajan contigo.", font=font(33), fill=(73, 70, 66), spacing=12)
    d.text((122, 716), "DE LA OPORTUNIDAD AL LUGAR CORRECTO.", font=font(24), fill=AMBER)

    rounded_panel(im, (830, 75, 1788, 1000), PAPER, radius=54, shadow=True)
    d = ImageDraw.Draw(im)
    map_box = (880, 125, 1738, 600)
    d.rounded_rectangle(map_box, radius=35, fill=(231, 226, 217))
    for x in (980, 1160, 1370, 1570):
        d.line((x, 145, x - 75, 580), fill=(204, 198, 188), width=9)
    for y in (230, 350, 485):
        d.line((900, y, 1715, y + 30), fill=(211, 205, 196), width=8)
    route = [(1000, 510), (1100, 430), (1270, 455), (1400, 340), (1585, 255)]
    d.line(route, fill=OBSIDIAN, width=13, joint="curve")
    for x, y in (route[0], route[-1]):
        d.ellipse((x - 24, y - 24, x + 24, y + 24), fill=AMBER, outline=PAPER, width=8)
    d.rounded_rectangle((905, 645, 1715, 890), radius=28, fill=(255, 253, 249), outline=(222, 215, 204), width=2)
    d.text((950, 685), "GUEST SPOT CONFIRMADO", font=font(20), fill=AMBER)
    d.text((950, 730), "Nómade Studio", font=font(37, serif=True), fill=OBSIDIAN)
    d.text((950, 790), "Viernes 20 · 10:00–18:00", font=font(23), fill=(91, 87, 81))
    d.text((950, 830), "Sede Palermo · Dirección confirmada", font=font(22), fill=(91, 87, 81))
    d.rounded_rectangle((1450, 708, 1668, 842), radius=26, fill=OBSIDIAN)
    d.text((1559, 775), "VER RUTA", font=font(22), fill=IVORY, anchor="mm")
    save(im, "03-guest-spot.png")


def profile():
    im = gradient(OBSIDIAN, (18, 16, 15))
    d = ImageDraw.Draw(im)
    label(d, (1090, 195), "PERFIL + PORTAFOLIO + RESEÑAS")
    d.multiline_text((1090, 245), "Tu obra habla\nantes que tú.", font=font(88, serif=True), fill=IVORY, spacing=-2)
    d.multiline_text((1094, 485), "Para que te encuentren por tu estilo,\ntu trabajo y la confianza que construiste.", font=font(30), fill=(198, 192, 183), spacing=12)

    rounded_panel(im, (105, 78, 985, 1002), PAPER, radius=54, shadow=True)
    if MARA.exists():
        paste_rounded(im, Image.open(MARA), (160, 135, 930, 480), radius=30)
    d = ImageDraw.Draw(im)
    d.text((165, 535), "MARA", font=font(45, serif=True), fill=OBSIDIAN)
    d.text((165, 595), "Fine line · Blackwork", font=font(23), fill=(92, 88, 82))
    d.rounded_rectangle((730, 535, 920, 598), radius=27, fill=AMBER)
    d.text((825, 567), "DISPONIBLE", font=font(19), fill=OBSIDIAN, anchor="mm")
    d.text((165, 665), "PORTAFOLIO", font=font(18), fill=TAUPE)
    thumbs = [TATTOO, HERE.parent / "promo-a-ustedes" / "stills" / "s5a.webp", HERE.parent / "promo-a-ustedes" / "stills" / "s5b.webp"]
    for i, ref in enumerate(thumbs):
        if ref.exists():
            paste_rounded(im, Image.open(ref), (165 + i * 245, 705, 380 + i * 245, 845), radius=18)
    d.rounded_rectangle((165, 875, 925, 955), radius=28, fill=(232, 226, 217))
    for i in range(5):
        d.polygon(star_points(220 + i * 30, 915), fill=AMBER)
    d.text((385, 915), "RESEÑA VERIFICADA", font=font(20), fill=OBSIDIAN, anchor="lm")
    d.ellipse((855, 893, 895, 933), fill=AMBER)
    d.line((865, 913, 873, 921), fill=OBSIDIAN, width=4)
    d.line((873, 921, 887, 904), fill=OBSIDIAN, width=4)
    d.text((1090, 64), "WE ÖTZI", font=font(35, serif=True), fill=IVORY)
    d.ellipse((1277, 77, 1285, 85), fill=AMBER)
    d.text((1094, 735), "TU PERFIL VIAJA CONTIGO.", font=font(24), fill=AMBER)
    save(im, "04-perfil.png")


def end_cards():
    for name, main, sub in [
        ("05-end-1.png", "MENOS ADMINISTRACIÓN.", ""),
        ("06-end-2.png", "MÁS TIEMPO PARA CREAR.", ""),
    ]:
        im = gradient(OBSIDIAN, (9, 8, 8))
        d = ImageDraw.Draw(im)
        d.text((W // 2, H // 2 - 25), main, font=font(72, serif=True), fill=IVORY, anchor="mm")
        d.line((W // 2 - 70, H // 2 + 75, W // 2 + 70, H // 2 + 75), fill=AMBER, width=4)
        save(im, name)

    im = gradient(OBSIDIAN, (9, 8, 8))
    d = ImageDraw.Draw(im)
    d.text((W // 2, 380), "WE ÖTZI", font=font(142, serif=True), fill=IVORY, anchor="mm")
    d.text((W // 2, 565), "TU ARTE. TU CAMINO. TU LUGAR.", font=font(34), fill=(211, 204, 194), anchor="mm")
    d.rounded_rectangle((W // 2 - 190, 665, W // 2 + 190, 745), radius=38, fill=AMBER)
    d.text((W // 2, 706), "UNITE A LA BETA", font=font(25), fill=OBSIDIAN, anchor="mm")
    d.text((W // 2, 925), "Producto en etapa beta. Funciones sujetas a evolución.", font=font(19), fill=(121, 116, 109), anchor="mm")
    save(im, "07-end-3.png")


if __name__ == "__main__":
    agenda()
    quotation()
    guest_spot()
    profile()
    end_cards()
    print(f"Placas generadas en {UI}")
