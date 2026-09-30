"""Generate the three synthetic PDF fixtures used by the Travel Figma demo.

The files intentionally contain no real reservation identifiers or contact data.
Run with the bundled Codex Python runtime so ReportLab is available.
"""

from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "supabase" / "fixtures" / "travel-figma-20260830"

INK = HexColor("#1A1A1A")
BLUE = HexColor("#1E3FA6")
YELLOW = HexColor("#F5D90A")
PAPER = HexColor("#F7F4EC")
MUTED = HexColor("#666666")

DOCUMENTS = (
    {
        "filename": "Pasaje_ida_vuelta.pdf",
        "eyebrow": "TRAVEL / PASAJE",
        "title": "Reserva de traslado - Demo",
        "subtitle": "Barcelona, Espana",
        "rows": (
            ("Trayecto", "Buenos Aires - Barcelona - Buenos Aires"),
            ("Salida", "15 de agosto de 2026"),
            ("Regreso", "22 de agosto de 2026"),
            ("Estado", "Reserva de demostracion confirmada"),
        ),
        "note": "Fixture sintetico para validar la descarga privada de documentos en Travel.",
    },
    {
        "filename": "Reserva_hotel_barcelona.pdf",
        "eyebrow": "TRAVEL / HOSPEDAJE",
        "title": "Reserva de alojamiento - Demo",
        "subtitle": "Barcelona, Espana",
        "rows": (
            ("Ingreso", "15 de agosto de 2026"),
            ("Salida", "22 de agosto de 2026"),
            ("Noches", "7"),
            ("Estado", "Reserva de demostracion confirmada"),
        ),
        "note": "No representa una reserva comercial ni contiene datos de una persona real.",
    },
    {
        "filename": "Acuerdo_costa_ink.pdf",
        "eyebrow": "TRAVEL / ACUERDO",
        "title": "Acuerdo de guest spot - Demo",
        "subtitle": "Zorro Rojo Tattoo - Barcelona",
        "rows": (
            ("Periodo", "15 al 22 de agosto de 2026"),
            ("Modalidad", "Guest spot"),
            ("Condiciones", "65% para el artista; agenda de 5 dias"),
            ("Materiales", "Incluidos por el estudio"),
        ),
        "note": "Documento sintetico sin validez contractual, creado solo para QA del producto.",
    },
)


def draw_wrapped(canvas: Canvas, text: str, x: float, y: float, max_width: float, size: int, leading: int) -> float:
    words = text.split()
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and stringWidth(candidate, "Helvetica", size) > max_width:
            canvas.drawString(x, y, line)
            y -= leading
            line = word
        else:
            line = candidate
    if line:
        canvas.drawString(x, y, line)
        y -= leading
    return y


def render_document(spec: dict[str, object]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUTPUT_DIR / str(spec["filename"])
    width, height = A4
    canvas = Canvas(str(target), pagesize=A4, pageCompression=1)
    canvas.setTitle(str(spec["title"]))
    canvas.setAuthor("We Otzi - Travel demo")
    canvas.setSubject("Synthetic Travel fixture without personal data")

    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(INK)
    canvas.rect(0, height - 142, width, 142, fill=1, stroke=0)
    canvas.setFillColor(YELLOW)
    canvas.rect(48, height - 102, 64, 6, fill=1, stroke=0)

    canvas.setFillColor(YELLOW)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(48, height - 56, str(spec["eyebrow"]))
    canvas.setFillColor(PAPER)
    canvas.setFont("Helvetica-Bold", 23)
    canvas.drawString(48, height - 88, str(spec["title"]))
    canvas.setFont("Helvetica", 12)
    canvas.drawString(48, height - 121, str(spec["subtitle"]))

    y = height - 202
    for label, value in spec["rows"]:
        canvas.setStrokeColor(Color(0.72, 0.72, 0.72))
        canvas.setLineWidth(0.8)
        canvas.line(48, y + 18, width - 48, y + 18)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(48, y, str(label).upper())
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 12)
        y = draw_wrapped(canvas, str(value), 168, y, width - 216, 12, 16) - 26

    canvas.setFillColor(BLUE)
    canvas.rect(48, 108, width - 96, 76, fill=1, stroke=0)
    canvas.setFillColor(PAPER)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(64, 160, "DOCUMENTO DE DEMOSTRACION")
    canvas.setFont("Helvetica", 10)
    draw_wrapped(canvas, str(spec["note"]), 64, 140, width - 128, 10, 14)

    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(48, 54, "We Otzi Travel - fixture travel-figma-20260830")
    canvas.drawRightString(width - 48, 54, "Pagina 1 de 1")
    canvas.save()
    return target


if __name__ == "__main__":
    for document in DOCUMENTS:
        print(render_document(document))
