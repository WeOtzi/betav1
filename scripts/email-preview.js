#!/usr/bin/env node
/*
 * Previews de todos los correos renderizados en el servidor (y de las
 * plantillas de Supabase Auth) para revisión manual en navegador y clientes.
 *
 *   node scripts/email-preview.js            → output/email-previews/
 *   node scripts/email-preview.js --dark     → además fuerza el modo oscuro en el visor
 *
 * Escribe <evento>[--<rol>].html y .txt, las plantillas auth-*.html y un
 * index.html con el asunto, el preheader, el tamaño y un visor a 375 / 768 /
 * 1024 px. Usa payloads ficticios (lib/email-render/fixtures.js). No envía nada.
 */

const fs = require('fs');
const path = require('path');
const { EVENTS, resolveRecipientRoles } = require('../services/email-event-mapping');
const { renderEmail, getSpec } = require('../lib/email-render');
const { fixtureFor } = require('../lib/email-render/fixtures');
const { buildAuthTemplate, SUPABASE_TEMPLATES } = require('./redesign-email-templates');
const { escapeHtml } = require('../lib/email-format');

const OUT = path.resolve(__dirname, '..', 'output', 'email-previews');

function rolesFor(eventId, payload) {
    const roles = resolveRecipientRoles(eventId, payload).map(r => r.role);
    if (roles.length) return roles;
    const spec = getSpec(eventId);
    return [payload.recipient_role || (spec && spec.audience) || 'client'];
}

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const rows = [];
    for (const eventId of Object.keys(EVENTS).sort()) {
        const payload = fixtureFor(eventId);
        for (const role of rolesFor(eventId, payload)) {
            const out = renderEmail(eventId, payload, { role });
            const name = `${eventId}--${role}`;
            fs.writeFileSync(path.join(OUT, `${name}.html`), out.html, 'utf8');
            fs.writeFileSync(path.join(OUT, `${name}.txt`), `Asunto: ${out.subject}\nPreheader: ${out.preheader}\n${Object.entries(out.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${out.text}`, 'utf8');
            rows.push({ file: `${name}.html`, title: `${eventId} · ${role}`, subject: out.subject, preheader: out.preheader, kb: (Buffer.byteLength(out.html) / 1024).toFixed(1), category: out.category });
        }
    }
    for (const name of Object.keys(SUPABASE_TEMPLATES)) {
        const html = buildAuthTemplate(name);
        fs.writeFileSync(path.join(OUT, `auth-${name}.html`), html, 'utf8');
        rows.push({ file: `auth-${name}.html`, title: `Supabase · ${name}`, subject: SUPABASE_TEMPLATES[name].subject, preheader: SUPABASE_TEMPLATES[name].preheader, kb: (Buffer.byteLength(html) / 1024).toFixed(1), category: 'auth' });
    }
    const dark = process.argv.includes('--dark');
    const index = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Previews de email · We Ötzi</title>
<style>
:root{color-scheme:${dark ? 'dark' : 'light dark'}}
body{margin:0;font:14px/1.45 Inter,Arial,sans-serif;background:#F2EFE6;color:#24211D}
header{padding:16px;background:#24211D;color:#FAF8F3}
main{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:16px;padding:16px}
@media (max-width:860px){main{grid-template-columns:1fr}}
ul{list-style:none;margin:0;padding:0;max-height:80vh;overflow:auto}
li{padding:10px;border-bottom:1px solid #DCD6C9}
button{font:inherit;border:1px solid #24211D;background:#FAF8F3;padding:4px 8px;margin:4px 4px 0 0;cursor:pointer}
button:focus-visible{outline:3px solid #F2B519;outline-offset:2px}
small{color:#6B6559}
.frame{background:#fff;border:1px solid #24211D;min-height:70vh;overflow:auto}
iframe{display:block;border:0;height:80vh;margin:0 auto;max-width:100%}
</style></head><body>
<header><strong>Previews de email</strong> · ${rows.length} piezas · datos ficticios · generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</header>
<main><ul>
${rows.map(r => `<li><strong>${escapeHtml(r.title)}</strong> <small>${escapeHtml(r.category)} · ${r.kb} KB</small><br>${escapeHtml(r.subject)}<br><small>${escapeHtml(r.preheader)}</small><br>
${[375, 768, 1024].map(w => `<button type="button" data-file="${escapeHtml(r.file)}" data-w="${w}">${w}px</button>`).join('')} <a href="${escapeHtml(r.file)}" target="_blank" rel="noopener">abrir</a></li>`).join('\n')}
</ul><section class="frame" aria-label="Vista previa"><iframe id="view" title="Vista previa del correo"></iframe></section></main>
<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-file]'); if (!b) return;
  var f = document.getElementById('view'); f.style.width = b.dataset.w + 'px'; f.src = b.dataset.file;
});
</script></body></html>`;
    fs.writeFileSync(path.join(OUT, 'index.html'), index, 'utf8');
    console.log(`Previews: ${rows.length} correos en ${path.relative(process.cwd(), OUT)}${path.sep}index.html`);
}

if (require.main === module) main();

module.exports = { main, rolesFor };
