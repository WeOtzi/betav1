'use strict';

// ===========================================================================
// Plantilla base común de los correos de We Ötzi (rediseño Bauhaus 2026)
// ---------------------------------------------------------------------------
// Calcada de templates/email/supabase-recovery.html (Figma 801:1116) con lo que
// esa pieza no tenía:
//   · ghost table MSO de 600px (Outlook desktop) y card fluida (max-width 600);
//   · gutter de 16px en móvil, h1 30/36 → 24/30, ficha clave-valor apilada;
//   · CTA "bulletproof": <a> con padding + v:roundrect VML + enlace de respaldo;
//   · preheader oculto (con relleno para que no se cuele el cuerpo);
//   · color-scheme / supported-color-schemes + reglas de modo oscuro
//     (prefers-color-scheme y [data-ogsc] de Outlook.com) que conservan la
//     cabecera ink y el CTA amarillo;
//   · pie con ayuda, privacidad, soporte y "Gestionar notificaciones".
//
// Escape: todo valor de texto pasa por escapeHtml. Solo los fragmentos
// marcados con raw() (placeholders de plantillas n8n / BillionMail / Supabase
// que arma scripts/redesign-email-templates.js) se insertan tal cual.
// ===========================================================================

const { escapeHtml, escapeMultiline, safeUrl } = require('../email-format');

const C = Object.freeze({
    bg: '#E8E3D7',
    card: '#FAF8F3',
    ink: '#24211D',
    title: '#001125',
    text: '#3B3730',
    muted: '#6B6559',
    faint: '#B4AEA1',
    line: '#DCD6C9',
    panel: '#F2EFE6',
    yellow: '#F2B519',
    red: '#E42121',
    blue: '#4C86FF',
    link: '#0044CC',
    paper: '#F4F0E6'
});

const FONT_DISPLAY = "'Archivo Black','Arial Black',Arial,Helvetica,sans-serif";
const FONT_BODY = 'Inter,Arial,Helvetica,sans-serif';
const FONT_MONO = "'JetBrains Mono',Consolas,'Courier New',monospace";

const SUPPORT_EMAIL = 'soporte@weotzi.com';
const HELP_URL = 'https://weotzi.com/faqs';

/** Marca un fragmento HTML ya seguro (placeholder de plantilla). */
function raw(html) {
    return { __raw: String(html) };
}

function isRaw(value) {
    return !!value && typeof value === 'object' && typeof value.__raw === 'string';
}

function isBlank(value) {
    if (isRaw(value)) return !value.__raw;
    return value === undefined || value === null || String(value).trim() === '';
}

function h(value) {
    return isRaw(value) ? value.__raw : escapeHtml(value);
}

function hm(value) {
    return isRaw(value) ? value.__raw : escapeMultiline(value);
}

/** URL para href: placeholder crudo o URL absoluta validada ('' si no sirve). */
function href(value) {
    if (isRaw(value)) return value.__raw;
    return escapeHtml(safeUrl(value));
}

function plain(value) {
    if (isRaw(value)) return value.__raw;
    return value === undefined || value === null ? '' : String(value);
}

const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(60);

function renderLogo() {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="wo-on-ink" style="font-family:${FONT_DISPLAY};font-size:20px;line-height:27px;font-weight:900;letter-spacing:0.6px;color:${C.card};">WE &Ouml;TZI</td>
<td align="right" style="font-size:0;line-height:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right">
<tr>
<td style="width:13px;height:13px;background:${C.red};font-size:0;line-height:0;">&nbsp;</td>
<td style="width:9px;font-size:0;line-height:0;">&nbsp;</td>
<td style="width:13px;height:13px;background:#F2B519;border-radius:50%;font-size:0;line-height:0;">&nbsp;</td>
<td style="width:9px;font-size:0;line-height:0;">&nbsp;</td>
<td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:13px;color:${C.blue};">&#9650;</td>
</tr>
</table>
</td>
</tr>
</table>`;
}

function renderHighlight(hl) {
    if (!hl || isBlank(hl.value)) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ink};margin:0 0 6px;" bgcolor="${C.ink}">
<tr>
<td align="center" class="wo-ink" style="padding:26px 20px 24px;">
${isBlank(hl.label) ? '' : `<p style="margin:0 0 11px;font-family:${FONT_MONO};font-size:11px;line-height:14.4px;letter-spacing:2.64px;text-transform:uppercase;color:${C.yellow};">${h(hl.label)}</p>`}
<p class="wo-code" style="margin:0 0 ${isBlank(hl.note) ? '0' : '12px'};font-family:${FONT_MONO};font-size:${hl.size || 40}px;line-height:1.2;font-weight:700;letter-spacing:${hl.spacing === undefined ? 8 : hl.spacing}px;color:${C.yellow};word-break:break-all;">${h(hl.value)}</p>
${isBlank(hl.note) ? '' : `<p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:16px;color:${C.paper};">${h(hl.note)}</p>`}
</td>
</tr>
</table>`;
}

function renderQuote(quote) {
    if (!quote || isBlank(quote.text)) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
<tr>
<td class="wo-panel" style="background:${C.panel};border-left:4px solid ${C.yellow};padding:16px 18px;" bgcolor="${C.panel}">
${isBlank(quote.label) ? '' : `<p class="wo-muted" style="margin:0 0 8px;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.98px;text-transform:uppercase;color:${C.muted};">${h(quote.label)}</p>`}
<p class="wo-text" style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:23px;color:${C.text};word-break:break-word;">${hm(quote.text)}</p>
</td>
</tr>
</table>`;
}

function renderRows(rows, title) {
    const list = (rows || []).filter(row => Array.isArray(row) && !isBlank(row[0]) && !isBlank(row[1]));
    if (!list.length) return '';
    const body = list.map(([label, value], i) => `<tr>
<td class="wo-row-label" valign="top" style="width:38%;padding:12px 12px 12px 0;border-top:${i === 0 ? `2px solid ${C.ink}` : `1px solid ${C.line}`};">
<p class="wo-muted" style="margin:0;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.32px;text-transform:uppercase;color:${C.muted};">${h(label)}</p>
</td>
<td class="wo-row-value" valign="top" style="padding:11px 0 12px;border-top:${i === 0 ? `2px solid ${C.ink}` : `1px solid ${C.line}`};">
<p class="wo-text" style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:21px;font-weight:700;color:${C.text};word-break:break-word;">${hm(value)}</p>
</td>
</tr>`).join('\n');
    return `${isBlank(title) ? '' : `<p class="wo-muted" style="margin:6px 0 10px;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.98px;text-transform:uppercase;color:${C.muted};">${h(title)}</p>`}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border-bottom:1px solid ${C.line};">
${body}
</table>`;
}

function renderLinks(links, title) {
    const list = (links || []).filter(link => link && !isBlank(link.label) && (isRaw(link.url) || safeUrl(link.url)));
    if (!list.length) return '';
    return `${isBlank(title) ? '' : `<p class="wo-muted" style="margin:0 0 8px;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.98px;text-transform:uppercase;color:${C.muted};">${h(title)}</p>`}
<p class="wo-text" style="margin:0 0 22px;font-family:${FONT_BODY};font-size:14px;line-height:24px;color:${C.text};">
${list.map(link => `<a href="${href(link.url)}" target="_blank" style="color:${C.link};text-decoration:underline;">${h(link.label)}</a>`).join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;\n')}
</p>`;
}

function renderNote(note) {
    if (isBlank(note)) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">
<tr>
<td valign="top" style="width:22px;padding-top:5px;"><div style="width:11px;height:11px;background:${C.red};font-size:0;line-height:0;">&nbsp;</div></td>
<td class="wo-text" style="font-family:${FONT_BODY};font-size:13.5px;line-height:20.25px;color:${C.text};">${hm(note)}</td>
</tr>
</table>`;
}

function ctaWidth(label) {
    const text = plain(label);
    return Math.min(520, Math.max(220, Math.round(text.length * 10.5) + 90));
}

/** Botón a prueba de clientes: <a> con padding (todos) + VML (Outlook desktop). */
function renderCta(cta) {
    if (!cta || isBlank(cta.label)) return '';
    const url = href(cta.url);
    if (!url) return '';
    const label = h(cta.label);
    const width = ctaWidth(cta.label);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="wo-btn" style="margin:26px 0 14px;">
<tr>
<td class="wo-cta" align="center" bgcolor="${C.yellow}" style="background:${C.yellow};mso-padding-alt:0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:${width}px;" arcsize="0%" stroke="f" fillcolor="${C.yellow}"><w:anchorlock/><center style="color:${C.ink};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${label} &rarr;</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" target="_blank" class="wo-cta-link" style="display:inline-block;padding:16px 26px;font-family:${FONT_BODY};font-size:14px;line-height:16.8px;font-weight:700;letter-spacing:1.26px;text-transform:uppercase;color:${C.ink};text-decoration:none;mso-hide:all;">${label}<span style="padding-left:12px;letter-spacing:0;">&rarr;</span></a><!--<![endif]-->
</td>
</tr>
</table>
<p class="wo-muted" style="margin:0 0 22px;font-family:${FONT_BODY};font-size:12.5px;line-height:18px;color:${C.muted};">Si el botón no funciona, copiá este enlace en tu navegador:<br><a href="${url}" target="_blank" style="color:${C.link};text-decoration:underline;word-break:break-all;">${url}</a></p>`;
}

function renderSecondary(link) {
    if (!link || isBlank(link.label) || !href(link.url)) return '';
    return `<p class="wo-text" style="margin:0 0 22px;font-family:${FONT_BODY};font-size:14px;line-height:21px;color:${C.text};"><a href="${href(link.url)}" target="_blank" style="color:${C.link};text-decoration:underline;">${h(link.label)}</a></p>`;
}

function renderAside(aside) {
    if (!aside || (isBlank(aside.title) && isBlank(aside.text))) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-top:2px solid ${C.ink};margin:8px 0 0;" bgcolor="${C.panel}">
<tr>
<td class="wo-panel" style="padding:23px 22px 22px;">
${isBlank(aside.title) ? '' : `<p class="wo-h2" style="margin:0 0 10px;font-family:${FONT_DISPLAY};font-size:16px;line-height:20.8px;font-weight:900;color:${C.title};">${h(aside.title)}</p>`}
${isBlank(aside.text) ? '' : `<p class="wo-text" style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:21.7px;color:${C.text};">${hm(aside.text)}</p>`}
</td>
</tr>
</table>`;
}

function renderFooter(footer = {}) {
    const base = footer.baseUrl;
    const privacy = isRaw(base) ? raw(`${base.__raw}/legal/privacy`) : (safeUrl(base) ? `${String(base).replace(/\/+$/, '')}/legal/privacy` : '');
    const prefs = footer.preferencesUrl;
    const items = [
        `<a href="${HELP_URL}" style="color:${C.link};text-decoration:underline;">Centro de ayuda</a>`,
        privacy ? `<a href="${href(privacy)}" style="color:${C.link};text-decoration:underline;">Privacidad</a>` : '',
        `<a href="mailto:${SUPPORT_EMAIL}" style="color:${C.link};text-decoration:underline;">${SUPPORT_EMAIL}</a>`
    ].filter(Boolean);
    const prefsLine = prefs && href(prefs)
        ? `<p class="wo-muted" style="margin:0 0 14px;font-family:${FONT_BODY};font-size:12.5px;line-height:18px;color:${C.muted};">${isBlank(footer.reason) ? '' : `${h(footer.reason)} `}<a href="${href(prefs)}" style="color:${C.link};text-decoration:underline;">Gestionar notificaciones</a></p>`
        : (isBlank(footer.reason) ? '' : `<p class="wo-muted" style="margin:0 0 14px;font-family:${FONT_BODY};font-size:12.5px;line-height:18px;color:${C.muted};">${h(footer.reason)}</p>`);
    return `<tr>
<td class="wo-pad" style="padding:0 40px 37px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};">
<tr>
<td style="padding-top:23px;">
<p class="wo-h2" style="margin:0 0 8px;font-family:${FONT_DISPLAY};font-size:13px;line-height:16px;font-weight:900;letter-spacing:0.65px;color:${C.title};">WE &Ouml;TZI</p>
<p class="wo-muted" style="margin:0 0 14px;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.32px;text-transform:uppercase;color:${C.muted};">ESTE ES UN MENSAJE AUTOMÁTICO DE WE ÖTZI</p>
${prefsLine}
<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:12.5px;line-height:18px;color:${C.faint};">
${items.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}
</p>
<p class="wo-muted" style="margin:0;font-family:${FONT_MONO};font-size:11px;line-height:15px;color:${C.muted};">&copy; ${footer.year ? h(footer.year) : new Date().getFullYear()} We Ötzi. Todos los derechos reservados.</p>
</td>
</tr>
</table>
</td>
</tr>`;
}

const STYLE = `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
u + #body a { color: inherit; text-decoration: none; }
@media only screen and (max-width: 620px) {
  .wo-shell { padding: 16px 16px !important; }
  .wo-card { width: 100% !important; }
  .wo-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .wo-body { padding-top: 28px !important; padding-bottom: 24px !important; }
  .wo-head { padding: 18px 20px !important; }
  .wo-h1 { font-size: 24px !important; line-height: 30px !important; }
  .wo-intro { margin-bottom: 24px !important; }
  .wo-code { font-size: 30px !important; letter-spacing: 5px !important; }
  .wo-row-label, .wo-row-value { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  .wo-row-label { padding: 12px 0 2px 0 !important; }
  .wo-row-value { border-top: 0 !important; padding: 0 0 12px 0 !important; }
  .wo-btn { width: 100% !important; }
  .wo-cta-link { display: block !important; text-align: center !important; }
}
@media (prefers-color-scheme: dark) {
  .wo-bg { background: #14120F !important; }
  .wo-card { background: #1E1B17 !important; border-color: #3A352D !important; }
  .wo-panel { background: #2A261F !important; }
  .wo-h1, .wo-h2 { color: #FAF8F3 !important; }
  .wo-text { color: #E9E4D8 !important; }
  .wo-muted { color: #B4AEA1 !important; }
  .wo-head, .wo-ink { background: #24211D !important; }
  .wo-cta { background: #F2B519 !important; }
  .wo-cta-link { color: #24211D !important; }
}
[data-ogsc] .wo-h1, [data-ogsc] .wo-h2 { color: #FAF8F3 !important; }
[data-ogsc] .wo-text { color: #E9E4D8 !important; }
[data-ogsc] .wo-muted { color: #B4AEA1 !important; }
[data-ogsb] .wo-bg { background: #14120F !important; }
[data-ogsb] .wo-card { background: #1E1B17 !important; }
[data-ogsb] .wo-panel { background: #2A261F !important; }
[data-ogsb] .wo-head, [data-ogsb] .wo-ink { background: #24211D !important; }
[data-ogsb] .wo-cta { background: #F2B519 !important; }
[data-ogsc] .wo-cta-link { color: #24211D !important; }
</style>`;

/**
 * HTML completo del correo.
 * @param {object} m modelo: subject, preheader, eyebrow, greeting, headline, intro,
 *   introMargin, highlight{label,value,note}, quote{label,text}, rows, rowsTitle,
 *   links, linksTitle, note, cta{label,url}, secondary{label,url}, aside{title,text},
 *   footer{baseUrl,preferencesUrl,reason}, comment (texto para el <!-- --> de cabecera)
 */
function renderLayout(m) {
    const introMargin = m.introMargin === undefined ? 26 : m.introMargin;
    const preheader = isBlank(m.preheader) ? '' : `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${h(m.preheader)}${PREHEADER_FILL}</div>`;
    return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${h(m.subject)}</title>
${m.comment ? `<!--\n${String(m.comment).replace(/--/g, '—')}\n-->\n` : ''}<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
${STYLE}
</head>
<body id="body" class="wo-bg" style="margin:0;padding:0;width:100%;background:${C.bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wo-bg" style="background:${C.bg};" bgcolor="${C.bg}">
<tr>
<td align="center" class="wo-shell" style="padding:40px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td width="600"><![endif]-->
<table class="wo-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.ink};" bgcolor="${C.card}">

<tr>
<td class="wo-head" bgcolor="${C.ink}" style="background:${C.ink};padding:20px 30px;">
${renderLogo()}
</td>
</tr>

<tr>
<td class="wo-pad wo-body" style="padding:34px 40px 28px;">
${isBlank(m.eyebrow) ? '' : `<p class="wo-muted" style="margin:0 0 18px;font-family:${FONT_MONO};font-size:11px;line-height:15px;letter-spacing:1.98px;text-transform:uppercase;color:${C.muted};">${h(m.eyebrow)}</p>`}
${isBlank(m.greeting) ? '' : `<p class="wo-text" style="margin:0 0 7px;font-family:${FONT_BODY};font-size:15px;line-height:18px;color:${C.text};">${h(m.greeting)}</p>`}
<h1 class="wo-h1" style="margin:0 0 14px;font-family:${FONT_DISPLAY};font-size:30px;line-height:36px;font-weight:900;letter-spacing:-0.3px;color:${C.title};">${h(m.headline)}</h1>
${isBlank(m.intro) ? '' : `<p class="wo-text wo-intro" style="margin:0 0 ${introMargin}px;max-width:519px;font-family:${FONT_BODY};font-size:15px;line-height:23.25px;color:${C.text};">${hm(m.intro)}</p>`}
${renderHighlight(m.highlight)}
${renderNote(m.note)}
${renderQuote(m.quote)}
${renderCta(m.cta)}
${renderRows(m.rows, m.rowsTitle)}
${renderLinks(m.links, m.linksTitle)}
${renderSecondary(m.secondary)}
${renderAside(m.aside)}
</td>
</tr>

${renderFooter(m.footer)}

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`.replace(/\n{3,}/g, '\n\n');
}

/** Versión de texto plano (multipart/alternative). */
function renderPlainText(m) {
    const lines = [];
    const push = (value) => { if (!isBlank(value)) lines.push(plain(value)); };
    push('WE ÖTZI');
    lines.push('');
    push(m.greeting);
    push(String(plain(m.headline)).toUpperCase());
    lines.push('');
    if (!isBlank(m.intro)) { push(m.intro); lines.push(''); }
    if (m.highlight && !isBlank(m.highlight.value)) {
        push(`${plain(m.highlight.label) || 'Código'}: ${plain(m.highlight.value)}`);
        push(m.highlight.note);
        lines.push('');
    }
    if (!isBlank(m.note)) { push(m.note); lines.push(''); }
    if (m.quote && !isBlank(m.quote.text)) {
        push(`${plain(m.quote.label) || 'Mensaje'}:`);
        push(`"${plain(m.quote.text)}"`);
        lines.push('');
    }
    if (m.cta && !isBlank(m.cta.label) && (isRaw(m.cta.url) || safeUrl(m.cta.url))) {
        push(`${plain(m.cta.label)}: ${isRaw(m.cta.url) ? m.cta.url.__raw : safeUrl(m.cta.url)}`);
        lines.push('');
    }
    const rows = (m.rows || []).filter(row => Array.isArray(row) && !isBlank(row[0]) && !isBlank(row[1]));
    if (rows.length) {
        if (!isBlank(m.rowsTitle)) push(String(plain(m.rowsTitle)).toUpperCase());
        for (const [label, value] of rows) push(`- ${plain(label)}: ${plain(value)}`);
        lines.push('');
    }
    const links = (m.links || []).filter(link => link && !isBlank(link.label) && safeUrl(link.url));
    if (links.length) {
        if (!isBlank(m.linksTitle)) push(plain(m.linksTitle));
        for (const link of links) push(`- ${plain(link.label)}: ${safeUrl(link.url)}`);
        lines.push('');
    }
    if (m.secondary && safeUrl(m.secondary.url)) { push(`${plain(m.secondary.label)}: ${safeUrl(m.secondary.url)}`); lines.push(''); }
    if (m.aside) { push(m.aside.title); push(m.aside.text); lines.push(''); }
    lines.push('--');
    lines.push('Este es un mensaje automático de We Ötzi.');
    const footer = m.footer || {};
    if (footer.preferencesUrl && safeUrl(footer.preferencesUrl)) {
        lines.push(`${plain(footer.reason) ? `${plain(footer.reason)} ` : ''}Gestionar notificaciones: ${safeUrl(footer.preferencesUrl)}`);
    }
    lines.push(`Ayuda: ${HELP_URL} · Soporte: ${SUPPORT_EMAIL}`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = { renderLayout, renderPlainText, raw, isRaw, COLORS: C, SUPPORT_EMAIL, HELP_URL };
