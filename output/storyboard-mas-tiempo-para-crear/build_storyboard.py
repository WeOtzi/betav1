from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "frames"
FONT_SOURCE = ROOT.parents[1] / "landing" / "shared" / "fonts"
FONT_CACHE = ROOT / "fonts"

CANVAS_W = 4096
CANVAS_H = 3264
MARGIN_X = 112
HEADER_H = 244
PANEL_W = 944
PANEL_H = 531
CAPTION_H = 160
ROW_GAP = 32
COL_GAP = 32

INK = "#07080B"
CREAM = "#F2EFE6"
ICE = "#EAF3F7"
AMBER = "#E8893B"
OCHRE = "#C75B1E"
MUTED = "#5A554E"
LINE = "#CFC8BB"


PANELS = [
    ("01-ritual-manana.png", "E1", "Ritual de mañana", "00:00–00:05", "PD · 85 mm", "La mano activa la cafetera; bocetos y equipo abren el día.", ""),
    ("02-agenda-dia.png", "E1", "La agenda del día", "00:05–00:12", "PG · 35 mm", "Desayuna junto a la ventana y consulta el resumen del día.", "Tu agenda. Tus sesiones. Todo conectado."),
    ("03-nueva-solicitud.png", "E2", "Nueva solicitud", "00:12–00:16", "PMC · 50 mm", "La notificación interrumpe el silencio; Mara reacciona.", ""),
    ("04-contexto-completo.png", "E2", "Contexto completo", "00:16–00:23", "OTS · 75 mm", "Revisa referencias, datos y chat antes de responder.", "Cotizaciones en We Ötzi."),
    ("05-eleccion.png", "E3", "La elección", "00:23–00:27", "CEN · 50 mm", "Compara dos bocetos y corrige el segundo diseño.", ""),
    ("06-enviar-cotizacion.png", "E3", "Enviar cotización", "00:27–00:32", "OTS · 50 mm", "Completa la propuesta y la envía con decisión.", "Toda la información. La decisión sigue siendo tuya."),
    ("07-aceptada-agendada.png", "E4", "Aceptada y agendada", "00:32–00:35", "PD · 85 mm", "La aceptación enlaza con la futura sesión del calendario.", ""),
    ("08-preparar-salir.png", "E4", "Preparar y salir", "00:35–00:41", "PM · 35 mm", "Guarda el equipo, cierra el maletín y toma las llaves.", "Cotizaciones y agenda. Un solo recorrido."),
    ("09-en-movimiento.png", "E5", "En movimiento", "00:41–00:47", "SEG · 28 mm", "Botas y maletín avanzan hacia la estación.", ""),
    ("10-sede-equivocada.png", "E5", "La sede equivocada", "00:47–00:55", "OTS · 35 mm", "Comprueba la ficha frente a la fachada y corrige el rumbo.", "Spots, residencias y estudios."),
    ("11-segundo-trayecto.png", "E6", "Segundo trayecto", "00:55–00:58", "PM · 50 mm", "Viaja hacia la sede correcta y observa la ciudad.", ""),
    ("12-trabajo-encuentra-neutral.png", "E6", "Su trabajo la encuentra", "00:58–01:02", "OTS · 50 mm", "Otra persona descubre el perfil y solicita una cotización.", "Tu trabajo llega antes que vos."),
    ("13-reaccion-solicitud.png", "E6", "Una nueva oportunidad", "01:02–01:04", "PM · 50 mm", "El teléfono se ilumina; Mara recibe la solicitud y sonríe.", ""),
    ("13-llegada-estudio.png", "E6", "Llegada al estudio", "01:04–01:06", "PMA · 35 mm", "Abre el maletín en el puesto preparado; puede comenzar.", ""),
    ("15-cierre-campana.png", "E7", "Cierre de campaña", "01:06–01:22", "PLACA · 16:9", "Cuatro placas sucesivas: mensaje, marca, lema y beta.", ""),
]


def convert_font(source_name: str, target_name: str) -> Path:
    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    target = FONT_CACHE / target_name
    if not target.exists():
        font = TTFont(FONT_SOURCE / source_name)
        font.flavor = None
        font.save(target)
    return target


def load_fonts() -> dict[str, ImageFont.FreeTypeFont]:
    fraunces = convert_font("Fraunces-600-latin.woff2", "Fraunces-600.ttf")
    inter_regular = convert_font("InterTight-400-latin.woff2", "InterTight-400.ttf")
    inter_semibold = convert_font("InterTight-600-latin.woff2", "InterTight-600.ttf")
    mono = convert_font("SpaceMono-400-latin.woff2", "SpaceMono-400.ttf")
    mono_bold = convert_font("SpaceMono-700-latin.woff2", "SpaceMono-700.ttf")
    return {
        "brand": ImageFont.truetype(str(fraunces), 74),
        "headline": ImageFont.truetype(str(fraunces), 56),
        "panel_title": ImageFont.truetype(str(fraunces), 34),
        "body": ImageFont.truetype(str(inter_regular), 23),
        "body_small": ImageFont.truetype(str(inter_regular), 20),
        "body_tiny": ImageFont.truetype(str(inter_semibold), 17),
        "body_bold": ImageFont.truetype(str(inter_semibold), 22),
        "meta": ImageFont.truetype(str(mono), 21),
        "meta_bold": ImageFont.truetype(str(mono_bold), 22),
        "close_big": ImageFont.truetype(str(fraunces), 66),
        "close_mid": ImageFont.truetype(str(fraunces), 54),
        "close_body": ImageFont.truetype(str(inter_regular), 28),
        "close_small": ImageFont.truetype(str(inter_regular), 20),
    }


def centered(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font: ImageFont.FreeTypeFont, fill: str) -> None:
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    draw.text(((left + right - width) / 2, (top + bottom - height) / 2 - bbox[1]), text, font=font, fill=fill)


def make_closing_frame(fonts: dict[str, ImageFont.FreeTypeFont]) -> Path:
    out = FRAMES / "15-cierre-campana.png"
    image = Image.new("RGB", (1920, 1080), INK)
    draw = ImageDraw.Draw(image)
    draw.line((960, 52, 960, 1028), fill=AMBER, width=3)
    draw.line((52, 540, 1868, 540), fill=AMBER, width=3)

    for step, x, y in (("01", 82, 76), ("02", 992, 76), ("03", 82, 576), ("04", 992, 576)):
        draw.rounded_rectangle((x, y, x + 72, y + 44), radius=22, fill=AMBER)
        centered(draw, (x, y, x + 72, y + 44), step, fonts["close_small"], INK)

    centered(draw, (60, 60, 950, 525), "MENOS ADMINISTRACIÓN.", fonts["close_mid"], CREAM)
    draw.rectangle((405, 410, 605, 418), fill=AMBER)

    centered(draw, (970, 60, 1860, 525), "MÁS TIEMPO PARA CREAR.", fonts["close_mid"], CREAM)
    draw.rectangle((1325, 410, 1525, 418), fill=AMBER)

    centered(draw, (60, 585, 950, 805), "WE ÖTZI.", fonts["close_big"], CREAM)
    centered(draw, (60, 785, 950, 900), "TU ARTE. TU CAMINO. TU LUGAR.", fonts["close_body"], ICE)

    centered(draw, (970, 650, 1860, 860), "UNITE A LA BETA.", fonts["close_mid"], CREAM)
    draw.rectangle((1325, 865, 1525, 873), fill=AMBER)
    centered(draw, (970, 925, 1860, 1015), "Funciones y disponibilidad sujetas a cambios durante la beta.", fonts["close_small"], "#8D8982")
    image.save(out, quality=95)
    return out


def crop_frame(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGB")
    target_ratio = PANEL_W / PANEL_H
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        crop_w = round(image.height * target_ratio)
        x0 = (image.width - crop_w) // 2
        image = image.crop((x0, 0, x0 + crop_w, image.height))
    elif source_ratio < target_ratio:
        crop_h = round(image.width / target_ratio)
        y0 = (image.height - crop_h) // 2
        image = image.crop((0, y0, image.width, y0 + crop_h))
    return image.resize((PANEL_W, PANEL_H), Image.Resampling.LANCZOS)


def draw_panel(
    board: Image.Image,
    fonts: dict[str, ImageFont.FreeTypeFont],
    panel: tuple[str, str, str, str, str, str, str],
    index: int,
    x: int,
    y: int,
) -> None:
    filename, scene, title, timecode, shot, description, super_text = panel
    frame = crop_frame(FRAMES / filename)
    board.paste(frame, (x, y))
    draw = ImageDraw.Draw(board)
    draw.rectangle((x, y, x + PANEL_W - 1, y + PANEL_H - 1), outline=INK, width=3)

    caption_y = y + PANEL_H
    draw.rectangle((x, caption_y, x + PANEL_W, caption_y + CAPTION_H), fill="#FAF7F0", outline=INK, width=2)
    badge_w = 78
    draw.rectangle((x, caption_y, x + badge_w, caption_y + CAPTION_H), fill=AMBER)
    centered(draw, (x, caption_y, x + badge_w, caption_y + 78), f"{index:02d}", fonts["meta_bold"], INK)
    centered(draw, (x, caption_y + 78, x + badge_w, caption_y + CAPTION_H), scene, fonts["meta"], INK)

    tx = x + badge_w + 22
    draw.text((tx, caption_y + 12), title, font=fonts["panel_title"], fill=INK)
    time_bbox = draw.textbbox((0, 0), timecode, font=fonts["meta"])
    draw.text((x + PANEL_W - (time_bbox[2] - time_bbox[0]) - 20, caption_y + 18), timecode, font=fonts["meta"], fill=OCHRE)
    draw.text((tx, caption_y + 62), shot, font=fonts["meta_bold"], fill=MUTED)

    draw.text((tx, caption_y + 101), description, font=fonts["body_small"], fill=INK)
    if super_text:
        draw.text((tx, caption_y + 132), f'TEXTO: “{super_text}”', font=fonts["body_tiny"], fill=OCHRE)


def build_board(fonts: dict[str, ImageFont.FreeTypeFont]) -> Path:
    missing = [filename for filename, *_ in PANELS if not (FRAMES / filename).exists()]
    if missing:
        raise FileNotFoundError(f"Missing storyboard frames: {', '.join(missing)}")

    board = Image.new("RGB", (CANVAS_W, CANVAS_H), CREAM)
    draw = ImageDraw.Draw(board)

    draw.text((MARGIN_X, 42), "WE ÖTZI", font=fonts["brand"], fill=INK)
    brand_box = draw.textbbox((MARGIN_X, 42), "WE ÖTZI", font=fonts["brand"])
    draw.ellipse((brand_box[2] + 10, 80, brand_box[2] + 26, 96), fill=AMBER)
    draw.text((MARGIN_X + 500, 38), "PARA ARTISTAS — MÁS TIEMPO PARA CREAR", font=fonts["headline"], fill=INK)
    draw.text((MARGIN_X + 504, 115), "STORYBOARD DE PRODUCCIÓN · V2 · 01:22 · COLOR · 16:9", font=fonts["meta"], fill=MUTED)
    draw.line((MARGIN_X, 198, CANVAS_W - MARGIN_X, 198), fill=AMBER, width=7)

    row_y = [HEADER_H + row * (PANEL_H + CAPTION_H + ROW_GAP) for row in range(4)]
    col_x = [MARGIN_X + col * (PANEL_W + COL_GAP) for col in range(4)]
    positions = [(col_x[i % 4], row_y[i // 4]) for i in range(12)]
    last_row_left = (CANVAS_W - (3 * PANEL_W + 2 * COL_GAP)) // 2
    positions.extend([(last_row_left + i * (PANEL_W + COL_GAP), row_y[3]) for i in range(3)])

    for index, (panel, (x, y)) in enumerate(zip(PANELS, positions), start=1):
        draw_panel(board, fonts, panel, index, x, y)

    footer_y = CANVAS_H - 56
    draw.line((MARGIN_X, footer_y - 20, CANVAS_W - MARGIN_X, footer_y - 20), fill=LINE, width=2)
    legend = "PD detalle · PG general · PMC medio corto · PM medio · PMA medio abierto · OTS sobrehombro · CEN cenital · SEG seguimiento"
    draw.text((MARGIN_X, footer_y), legend, font=fonts["body_small"], fill=MUTED, anchor="ls")
    note = "INTERFACES FINALES: usar capturas reales anonimizadas; no inventar funciones."
    note_box = draw.textbbox((0, 0), note, font=fonts["body_bold"])
    draw.text((CANVAS_W - MARGIN_X - (note_box[2] - note_box[0]), footer_y), note, font=fonts["body_bold"], fill=OCHRE, anchor="ls")

    out = ROOT / "storyboard-weotzi-mas-tiempo-para-crear.png"
    board.save(out, optimize=True)
    preview = board.resize((2048, 1632), Image.Resampling.LANCZOS)
    preview.save(ROOT / "storyboard-weotzi-mas-tiempo-para-crear-preview.png", optimize=True)
    return out


def main() -> None:
    fonts = load_fonts()
    make_closing_frame(fonts)
    out = build_board(fonts)
    print(out)


if __name__ == "__main__":
    main()
