"""Genera el informe técnico (HTML + PDF) del Figma final del flujo de artista.

Lee output/figma-final-artista/reports/*.json (uno por área) más
output/figma-final-artista/central.json (decisiones del orquestador: rutas
eliminadas, commits, tests) y escribe docs/entrega-figma-final-artista-20261028/.
Uso: python build_report.py
"""
import html
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'output' / 'figma-final-artista'
REPORTS = BASE / 'reports'
THUMBS = BASE / 'thumbs'
OUT = ROOT / 'docs' / 'entrega-figma-final-artista-20261028'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

AREA_ORDER = ['acceso', 'dashboard', 'cotizaciones', 'cotizaciones-detalle', 'calendario', 'cuenta',
              'perfil-estadisticas', 'oportunidades', 'invitaciones', 'travel-inbox']
AREA_TITLE = {
    'acceso': 'Acceso y registro', 'dashboard': 'Dashboard y navegación', 'cotizaciones': 'Cotizaciones',
    'cotizaciones-detalle': 'Detalle de cotización y notas', 'calendario': 'Calendario', 'cuenta': 'Centro de la cuenta',
    'perfil-estadisticas': 'Perfil público y estadísticas', 'oportunidades': 'Job board, postulaciones y spots',
    'invitaciones': 'Invitaciones de estudios', 'travel-inbox': 'Travel e Inbox'}
RESULT_LABEL = {'rediseñada': 'Rediseñada', 'creada': 'Creada desde 0', 'estado-nuevo': 'Estado nuevo',
                'sin-cambios': 'Ya fiel (sin cambios)'}

e = lambda v: html.escape(str(v if v is not None else ''))


def thumb(rel, width=520):
    if not rel:
        return None
    src = ROOT / rel
    if not src.exists() or src.stat().st_size == 0:
        return None
    THUMBS.mkdir(parents=True, exist_ok=True)
    dst = THUMBS / (src.stem + f'-w{width}.jpg')
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        with Image.open(src) as im:
            im = im.convert('RGB')
            ratio = width / im.width
            h = min(int(im.height * ratio), int(width * 2.2))  # recorta frames muy altos
            im = im.resize((width, int(im.height * ratio)), Image.LANCZOS).crop((0, 0, width, h))
            im.save(dst, 'JPEG', quality=78, optimize=True)
    return dst.as_uri()


def load():
    areas = []
    for name in AREA_ORDER:
        p = REPORTS / f'{name}.json'
        if p.exists():
            data = json.loads(p.read_text(encoding='utf-8'))
            data.setdefault('area', name)
            areas.append(data)
    central = {}
    cp = BASE / 'central.json'
    if cp.exists():
        central = json.loads(cp.read_text(encoding='utf-8'))
    return areas, central


def build():
    areas, central = load()
    frames = [dict(f, area=a['area']) for a in areas for f in a.get('frames', [])]
    count = lambda r: sum(1 for f in frames if f.get('result') == r)
    missing = [dict(m, area=a['area']) for a in areas for m in a.get('missing_functions', [])]
    sev_rank = {'alta': 0, 'media': 1, 'baja': 2}
    missing.sort(key=lambda m: sev_rank.get(m.get('severity'), 3))
    backend, seen = [], set()
    for a in areas:
        for b in a.get('backend', []):
            key = Path(str(b.get('migration', '')).split(' ')[0]).name
            if key and key not in seen:
                seen.add(key)
                backend.append(dict(b, area=a['area']))
    deleted = central.get('deleted_routes', [])

    css = (ROOT / 'output' / 'figma-final-artista' / 'tools' / 'report.css').read_text(encoding='utf-8')
    parts = [f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe técnico · Flujo de artista · Figma final</title><style>{css}</style></head><body>']

    # Portada
    parts.append(f'''<section class="cover"><div class="marks"><span class="sq"></span><span class="ci"></span><span class="tr"></span></div>
<p class="eyebrow">We Ötzi · Informe técnico · {e(central.get('date', '28 oct 2026'))}</p>
<h1>Flujo de artista<br><span class="hl">Figma final</span> implementado</h1>
<p class="lead">Implementación local y reversible del archivo Figma “We Otzi Pantallas final” (página Flujo artistas) sobre la web de We Ötzi: pantallas rediseñadas, creadas desde cero y eliminadas, funciones pendientes y forma de revertir.</p>
<table class="kv"><tr><th>Rama</th><td><code>{e(central.get('branch', 'feature/figma-final-artista'))}</code></td></tr>
<tr><th>Punto de restauración</th><td><code>{e(central.get('tag', 'pre-figma-final-artista-20261028'))}</code> (commit <code>{e(central.get('base_commit', 'f695f31'))}</code>)</td></tr>
<tr><th>Figma</th><td><code>w3JA83CcP5ISKjyOu87mx1</code> · página <code>0:1</code> · 107 frames únicos ({len(frames)} registros con las instancias repetidas)</td></tr>
<tr><th>Despliegue</th><td>Ninguno. Cambios solo en local; migraciones escritas pero no aplicadas.</td></tr></table></section>''')

    # Resumen
    parts.append(f'''<section><h2>1 · Resumen</h2><div class="stats">
<div><b>107</b><span>frames únicos del Figma</span></div>
<div><b>{count('rediseñada')}</b><span>rediseñados</span></div>
<div><b>{count('creada') + count('estado-nuevo')}</b><span>creados desde 0 ({count('creada')} pantallas · {count('estado-nuevo')} estados)</span></div>
<div><b>{count('sin-cambios')}</b><span>ya fieles</span></div>
<div><b>{len(deleted)}</b><span>rutas eliminadas</span></div>
<div><b>{len(backend)}</b><span>migraciones nuevas</span></div></div>
{''.join(f'<p>{e(p)}</p>' for p in central.get('summary', []))}</section>''')

    # Metodología
    parts.append('<section><h2>2 · Método</h2>' + ''.join(f'<p>{e(p)}</p>' for p in central.get('method', [])) + '</section>')

    # Inventario por área
    parts.append('<section><h2>3 · Inventario frame → pantalla</h2><p>Cada fila es un frame del Figma final. “Creado desde 0” agrupa pantallas y estados (modales, pasos, variantes) que no existían en la web.</p>')
    for a in areas:
        parts.append(f'<h3>{e(AREA_TITLE.get(a["area"], a["area"]))}</h3><table class="grid"><tr><th>Nodo</th><th>Frame</th><th>Ruta / estado</th><th>Resultado</th><th>Fidelidad</th></tr>')
        for f in a.get('frames', []):
            parts.append(f'<tr><td><code>{e(f.get("node"))}</code></td><td>{e(str(f.get("name", "")).replace("Artista / ", ""))}<div class="sub">{e(f.get("summary"))}</div></td>'
                         f'<td><code>{e(f.get("state_url") or f.get("route"))}</code></td><td><span class="tag tag-{e(f.get("result"))}">{e(RESULT_LABEL.get(f.get("result"), f.get("result")))}</span></td>'
                         f'<td>{e(f.get("fidelity"))}<div class="sub">{e(f.get("fidelity_notes"))}</div></td></tr>')
        parts.append('</table>')
    parts.append('</section>')

    # Eliminadas
    parts.append('<section><h2>4 · Pantallas eliminadas</h2><p>Rutas del artista que no aparecen en el Figma final. Se borró su carpeta en <code>public/</code> y la URL redirige (301) a la pantalla que la reemplaza (<code>lib/legacy-routes.js</code>). Restaurar la carpeta con git vuelve a servir la página original.</p><table class="grid"><tr><th>Ruta</th><th>Redirige a</th><th>Motivo</th></tr>')
    for d in deleted:
        parts.append(f'<tr><td><code>{e(d.get("route"))}</code></td><td><code>{e(d.get("redirect_to"))}</code></td><td>{e(d.get("reason"))}</td></tr>')
    parts.append('</table>')
    removed_in_page = [(a['area'], r) for a in areas for r in a.get('removed_in_page', [])]
    if removed_in_page:
        parts.append('<h3>Elementos quitados dentro de pantallas</h3><ul>' + ''.join(f'<li><b>{e(AREA_TITLE.get(ar, ar))}:</b> {e(r)}</li>' for ar, r in removed_in_page) + '</ul>')
    parts.append('</section>')

    # Funciones faltantes
    parts.append('<section><h2>5 · Funciones importantes que faltan</h2><table class="grid"><tr><th>Severidad</th><th>Área</th><th>Función</th><th>Detalle</th></tr>')
    for m in missing:
        parts.append(f'<tr><td><span class="sev sev-{e(m.get("severity"))}">{e(m.get("severity"))}</span></td><td>{e(AREA_TITLE.get(m["area"], m["area"]))}</td><td><b>{e(m.get("title"))}</b></td><td>{e(m.get("detail"))}</td></tr>')
    parts.append('</table></section>')

    # Backend
    parts.append('<section><h2>6 · Backend nuevo (no aplicado)</h2><p>Todas las migraciones son aditivas, están en <code>supabase/migrations/</code> y tienen su reversa en <code>supabase/rollbacks/</code>. Ninguna se aplicó al proyecto vivo <code>flbgmlvfiejfttlawnfu</code>: hasta aplicarlas, las pantallas que dependen de ellas funcionan en el preview local con datos ficticios y degradan con un aviso en el entorno real.</p><table class="grid"><tr><th>Área</th><th>Migración</th><th>Propósito</th></tr>')
    for b in backend:
        parts.append(f'<tr><td>{e(AREA_TITLE.get(b["area"], b["area"]))}</td><td><code>{e(Path(str(b.get("migration", ""))).name)}</code><div class="sub">reversa: <code>{e(Path(str(b.get("rollback", ""))).name)}</code></div></td><td>{e(b.get("purpose"))}</td></tr>')
    parts.append('</table></section>')

    # Otras cosas
    parts.append('<section><h2>7 · Otras cosas que tenés que saber</h2>')
    for p in central.get('notes', []):
        parts.append(f'<p>{e(p)}</p>')
    for a in areas:
        notes = a.get('notes', []) + [f'Asset faltante: {x}' for x in a.get('missing_assets', [])]
        if notes:
            parts.append(f'<h3>{e(AREA_TITLE.get(a["area"], a["area"]))}</h3><ul>' + ''.join(f'<li>{e(n)}</li>' for n in notes) + '</ul>')
    fixes = [(a['area'], c) for a in areas for c in a.get('copy_fixes', [])]
    if fixes:
        parts.append('<h3>Correcciones de texto respecto del Figma</h3><ul>' + ''.join(f'<li><b>{e(AREA_TITLE.get(ar, ar))}:</b> {e(c)}</li>' for ar, c in fixes) + '</ul>')
    parts.append('</section>')

    # Reversibilidad y pruebas
    parts.append('<section><h2>8 · Cómo revertir</h2>' + ''.join(f'<p>{e(p)}</p>' for p in central.get('revert', [])) +
                 '<pre>' + e('\n'.join(central.get('revert_commands', []))) + '</pre>')
    commits = central.get('commits', [])
    if commits:
        parts.append('<h3>Commits de la rama (uno por área)</h3><table class="grid"><tr><th>Commit</th><th>Mensaje</th></tr>' + ''.join(f'<tr><td><code>{e(c[0])}</code></td><td>{e(c[1])}</td></tr>' for c in commits) + '</table>')
    parts.append('</section>')
    parts.append('<section><h2>9 · Pruebas</h2>' + ''.join(f'<p>{e(p)}</p>' for p in central.get('tests', [])) + '</section>')

    # Anexo comparativo
    parts.append('<section class="annex"><h2>Anexo · Figma vs implementación</h2><p>Miniaturas recortadas a la parte superior de cada frame. Izquierda: Figma. Derecha: captura del preview local con datos ficticios.</p>')
    for a in areas:
        parts.append(f'<h3>{e(AREA_TITLE.get(a["area"], a["area"]))}</h3>')
        for f in a.get('frames', []):
            fp, ip = thumb(f.get('figma_png')), thumb(f.get('impl_png'))
            if not fp and not ip:
                continue
            parts.append(f'<figure class="pair"><figcaption><code>{e(f.get("node"))}</code> {e(str(f.get("name", "")).replace("Artista / ", ""))}</figcaption><div>'
                         + (f'<img src="{fp}" alt="Figma">' if fp else '<div class="noimg">sin captura Figma</div>')
                         + (f'<img src="{ip}" alt="Implementación">' if ip else '<div class="noimg">sin captura</div>') + '</div></figure>')
    parts.append('</section></body></html>')

    write_manifest(areas, deleted)
    OUT.mkdir(parents=True, exist_ok=True)
    html_path = OUT / 'informe-tecnico.html'
    html_path.write_text(''.join(parts), encoding='utf-8')
    pdf_path = OUT / 'Informe-tecnico-flujo-artista-Figma-final.pdf'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files',
                    f'--print-to-pdf={pdf_path}', html_path.as_uri()], check=False, capture_output=True)
    print('html', html_path)
    print('pdf', pdf_path, pdf_path.exists() and pdf_path.stat().st_size)


def write_manifest(areas, deleted):
    """Manifiesto versionado frame ↔ ruta (fuente de verdad para la próxima iteración del Figma)."""
    md = ['# Mapeo Figma final ↔ web · flujo de artista', '',
          '**Fuente de verdad**: Figma “We Otzi Pantallas final”, fileKey `w3JA83CcP5ISKjyOu87mx1`, página `0:1` (Flujo artistas).',
          'Implementado el 28 oct 2026 en la rama `feature/figma-final-artista` (punto de partida: tag `pre-figma-final-artista-20261028`).',
          'Reemplaza como referencia a `2026-08-25-rediseno-figma-mapeo.md` (archivo Figma anterior `UmVbDewiAHkfLedTR5uyFj`).', '',
          'Para re-auditar una pantalla: tomá el node-id de la tabla, pedí `get_screenshot` y `get_design_context` al MCP de Figma y capturá la implementación con el `state_url` en el preview local (`npm run dev:safe`, `http://localhost:4647/preview/preview-local-safe<state_url>`).', '']
    for a in areas:
        md += [f'## {AREA_TITLE.get(a["area"], a["area"])}', '', '| Nodo | Frame | Ruta / estado | Resultado | Fidelidad |', '| --- | --- | --- | --- | --- |']
        for f in a.get('frames', []):
            name = str(f.get('name', '')).replace('Artista / ', '').replace('|', '/')
            md.append(f'| `{f.get("node")}` | {name} | `{f.get("state_url") or f.get("route")}` | {RESULT_LABEL.get(f.get("result"), f.get("result"))} | {f.get("fidelity", "")} |')
        md.append('')
    md += ['## Rutas eliminadas', '', '| Ruta | Redirige a | Motivo |', '| --- | --- | --- |']
    md += [f'| `{d.get("route")}` | `{d.get("redirect_to")}` | {d.get("reason", "")} |' for d in deleted]
    (ROOT / 'docs' / 'plans' / '2026-10-28-figma-final-artista-mapeo.md').write_text('\n'.join(md) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(build())
