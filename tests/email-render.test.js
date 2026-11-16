'use strict';

// Render de correos en el servidor (lib/email-render) y plantillas generadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EVENTS, resolveRecipientRoles, EXTENSION_SOURCES, buildAttribs } = require('../services/email-event-mapping');
const { renderEmail, getSpec } = require('../lib/email-render');
const { fixtureFor } = require('../lib/email-render/fixtures');
const { rolesFor } = require('../scripts/email-preview');
const fmt = require('../lib/email-format');
const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
const { loadEmailEvents, validateEvent } = require('../services/email-events');

const ROOT = path.resolve(__dirname, '..');
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ATTACK = '<script>alert(1)</script><a href="https://evil.example">x</a>"><img src=x onerror=alert(2)>';

function everyRender(cb) {
    for (const eventId of Object.keys(EVENTS)) {
        const payload = fixtureFor(eventId);
        for (const role of rolesFor(eventId, payload)) cb(eventId, role, payload, renderEmail(eventId, payload, { role }));
    }
}

test('todos los eventos tienen spec de render (built-in o services/email-events)', () => {
    for (const eventId of Object.keys(EVENTS)) assert.ok(getSpec(eventId), `${eventId} sin spec de render`);
});

test('ningún correo deja placeholders, undefined/null, booleanos ni fechas ISO crudas', () => {
    everyRender((eventId, role, payload, out) => {
        const tag = `${eventId}/${role}`;
        for (const [name, body] of [['html', out.html], ['text', out.text], ['subject', out.subject], ['preheader', out.preheader]]) {
            assert.doesNotMatch(body, /\{\{|\}\}/, `${tag} ${name}: placeholder`);
            assert.doesNotMatch(body, /\b(undefined|null|NaN)\b/, `${tag} ${name}: undefined/null`);
            assert.doesNotMatch(body, /\[object Object\]/, `${tag} ${name}: objeto`);
        }
        assert.doesNotMatch(out.text, /\b(true|false)\b/, `${tag}: booleano crudo`);
        assert.doesNotMatch(out.html.replace(/https?:\/\/[^"'\s<]+/g, ''), ISO_RE, `${tag}: ISO crudo en HTML`);
        assert.doesNotMatch(out.text.replace(/https?:\/\/\S+/g, ''), ISO_RE, `${tag}: ISO crudo en texto`);
    });
});

test('cada correo de usuario final tiene un CTA absoluto (también en Outlook y como enlace de respaldo)', () => {
    everyRender((eventId, role, payload, out) => {
        const tag = `${eventId}/${role}`;
        assert.ok(out.cta, `${tag}: sin CTA`);
        assert.match(out.cta.url, /^https:\/\//, `${tag}: CTA no absoluto`);
        const href = fmt.escapeHtml(out.cta.url);
        assert.ok(out.html.includes(`<a href="${href}"`), `${tag}: falta el <a> del CTA`);
        assert.ok(out.html.includes(`v:roundrect`) && out.html.includes(`href="${href}" style="height:50px`), `${tag}: falta el botón VML`);
        assert.match(out.html, /Si el botón no funciona, copia este enlace/, `${tag}: falta el enlace de respaldo`);
        assert.ok(out.text.includes(out.cta.url), `${tag}: el texto plano no trae el link`);
    });
});

test('preheader de 40 a 110 caracteres, HTML < 90 KB y base responsive/oscura completa', () => {
    everyRender((eventId, role, payload, out) => {
        const tag = `${eventId}/${role}`;
        assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110, `${tag}: preheader de ${out.preheader.length}`);
        assert.ok(Buffer.byteLength(out.html) < 90 * 1024, `${tag}: ${Buffer.byteLength(out.html)} bytes`);
        assert.ok(out.html.includes(fmt.escapeHtml(out.preheader)), `${tag}: preheader ausente`);
        assert.match(out.html, /<!--\[if mso\]><table role="presentation" width="600" align="center"/, `${tag}: ghost table`);
        assert.match(out.html, /<meta name="color-scheme" content="light dark">/, `${tag}: color-scheme`);
        assert.match(out.html, /<meta name="supported-color-schemes" content="light dark">/, `${tag}: supported-color-schemes`);
        assert.match(out.html, /@media \(prefers-color-scheme: dark\)/, `${tag}: reglas de modo oscuro`);
        assert.match(out.html, /\.wo-shell \{ padding: 16px 16px !important; \}/, `${tag}: gutter de 16px en móvil`);
        assert.match(out.html, /font-size:30px;line-height:36px/, `${tag}: h1 30/36`);
        assert.match(out.html, /\.wo-h1 \{ font-size: 24px !important; line-height: 30px !important; \}/, `${tag}: h1 móvil 24/30`);
        assert.match(out.html, /max-width:600px/, `${tag}: card de 600`);
        assert.ok(out.text.length > 80, `${tag}: texto plano vacío`);
        assert.match(out.subject, /\S/, `${tag}: sin asunto`);
    });
});

test('el HTML que viene de datos de usuario sale escapado', () => {
    for (const eventId of Object.keys(EVENTS)) {
        const base = fixtureFor(eventId);
        const evil = {};
        for (const [key, value] of Object.entries(base)) {
            evil[key] = typeof value === 'string' && !/(_url|_email|^email|_id|_date|_at|amount|currency)$/.test(key) ? `${value}${ATTACK}` : value;
        }
        for (const role of rolesFor(eventId, evil)) {
            const { html, subject } = renderEmail(eventId, evil, { role });
            const tag = `${eventId}/${role}`;
            assert.doesNotMatch(html, /<script/i, `${tag}: <script> sin escapar`);
            assert.doesNotMatch(html, /<img src=x/i, `${tag}: <img> sin escapar`);
            assert.doesNotMatch(html, /<a href="https:\/\/evil\.example"/, `${tag}: enlace inyectado`);
            assert.doesNotMatch(subject, /[\r\n]/, `${tag}: salto de línea en el asunto`);
        }
    }
    const out = renderEmail('chat_message_to_client', { ...fixtureFor('chat_message_to_client'), message_preview: ATTACK });
    assert.match(out.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('URLs no https del payload nunca llegan al CTA', () => {
    const out = renderEmail('instagram_verification_code', { ...fixtureFor('instagram_verification_code'), dm_url: 'javascript:alert(1)' });
    assert.equal(out.cta.url, 'https://ig.me/m/weotzi');
    assert.doesNotMatch(out.html, /javascript:/);
    // Un spec que devuelve una URL inválida sin respaldo se queda sin botón (nunca un href peligroso).
    assert.equal(renderEmail('profile_verified', { ...fixtureFor('profile_verified'), app_base_url: 'javascript:x' }).cta.url, 'https://beta.weotzi.com/artist/account#verificacion');
    const chat = renderEmail('chat_message_to_client', { ...fixtureFor('chat_message_to_client'), chat_url: 'data:text/html,hi' });
    assert.equal(chat.cta.url, 'https://beta.weotzi.com/client/chats?quote=WO-2026-0142');
});

test('datos de salud y fecha de nacimiento nunca salen hacia el proveedor', () => {
    const secret = { ...fixtureFor('client_quotation_submitted'), client_health_conditions: 'SECRETO-SALUD', client_allergies: 'SECRETO-ALERGIA', client_birth_date: '1990-01-01' };
    for (const role of ['client', 'artist']) {
        const out = renderEmail('client_quotation_submitted', secret, { role });
        assert.doesNotMatch(out.html + out.text, /SECRETO-|1990-01-01/);
    }
    const attribs = buildAttribs('client_quotation_submitted', secret);
    assert.equal(attribs.client_health_conditions, undefined);
    assert.equal(attribs.client_allergies, undefined);
    assert.equal(buildAttribs('chat_message_to_client', secret).client_health_conditions, undefined);
    assert.equal(buildAttribs('chat_message_to_client', secret).tattoo_description, undefined, 'chat: lista blanca');
});

test('sesiones: un correo por rol con links y textos de cada uno (EM-09)', () => {
    const payload = fixtureFor('session_scheduled');
    assert.deepEqual(resolveRecipientRoles('session_scheduled', payload).map(r => r.role), ['client', 'artist']);
    const client = renderEmail('session_scheduled', payload, { role: 'client' });
    const artist = renderEmail('session_scheduled', payload, { role: 'artist' });
    assert.match(client.cta.url, /\/client\/dashboard\?quote=WO-2026-0142$/);
    assert.match(artist.cta.url, /\/calendar$/);
    assert.match(client.html, /Hola, Lucía\./);
    assert.match(artist.html, /Hola, Mateo\./);
    assert.match(client.headers['List-Unsubscribe'], /\/client\/profile#notificaciones/);
    assert.match(artist.headers['List-Unsubscribe'], /\/artist\/account#notificaciones/);
});

test('formato en español: fechas en la zona del destinatario, montos, Sí/No y listas', () => {
    assert.equal(fmt.formatDateTime('2026-11-21T14:00:00Z', 'America/Argentina/Buenos_Aires'), 'sábado, 21 de noviembre de 2026, 11:00 h');
    assert.equal(fmt.formatDateTime('2026-11-21T14:00:00Z', 'Europe/Madrid'), 'sábado, 21 de noviembre de 2026, 15:00 h');
    assert.equal(fmt.formatDate('2026-11-20'), 'viernes, 20 de noviembre de 2026');
    assert.equal(fmt.formatDateTime('2026-11-21T14:00:00Z', 'Marte/Base'), 'sábado, 21 de noviembre de 2026, 11:00 h');
    assert.equal(fmt.formatMoney('120000', 'ars'), '120.000 ARS');
    assert.equal(fmt.formatMoney('1.500,50', 'EUR'), '1.500,5 EUR');
    assert.equal(fmt.formatMoney('', 'USD'), '');
    assert.equal(fmt.displayValue(true), 'Sí');
    assert.equal(fmt.displayValue('false'), 'No');
    assert.equal(fmt.displayValue(null), '');
    assert.equal(fmt.displayValue('undefined'), '');
    assert.equal(fmt.displayValue('["Realismo","Blackwork"]'), 'Realismo · Blackwork');
    assert.equal(fmt.displayValue('2026-11-21T14:00:00Z'), 'Sábado, 21 de noviembre de 2026, 11:00 h');
    assert.equal(fmt.safeUrl('javascript:alert(1)'), '');
    assert.equal(fmt.safeUrl('http://evil.example'), '');
    assert.equal(fmt.publicBaseUrl({}), 'https://beta.weotzi.com');
    assert.equal(fmt.publicBaseUrl({ PUBLIC_APP_URL: 'https://beta.weotzi.com/' }), 'https://beta.weotzi.com');
    assert.equal(fmt.truncate('a '.repeat(200), 20).length <= 20, true);
});

test('services/email-events: carga automática, validación y serverOnly', () => {
    assert.equal(EXTENSION_SOURCES.inbox_message_received, 'emails.js');
    assert.equal(EXTENSION_SOURCES.session_reminder_24h, 'emails.js');
    assert.ok(SERVER_ONLY_EVENTS.has('session_reminder_24h'), 'serverOnly se suma a SERVER_ONLY_EVENTS');
    assert.equal(SERVER_ONLY_EVENTS.has('inbox_message_received'), false);
    for (const id of ['studio_roster_invite', 'studio_spot_decision', 'profile_verified', 'profile_verification_denied', 'quotation_completed_summary', 'request_rating']) {
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} solo servidor`);
    }
    assert.match(validateEvent('Bad-Id', { recipient: () => '' }, 'x.js'), /id inválido/);
    assert.match(validateEvent('sin_destino', {}, 'x.js'), /recipient/);
    assert.equal(validateEvent('ok_evento', { recipient: () => '', render: {} }, 'x.js'), null);
    assert.ok(fs.existsSync(path.join(ROOT, 'services/email-events/README.md')));
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wo-email-events-'));
    try {
        fs.writeFileSync(path.join(dir, 'a.js'), "module.exports = { demo_evento: { name: 'Demo', recipient: p => p.email, render: { audience: 'client', category: 'transactional', subject: () => 'Demo' } } };");
        fs.writeFileSync(path.join(dir, 'b.js'), "module.exports = { demo_evento: { name: 'Repetido', recipient: p => p.email } };");
        const loaded = loadEmailEvents(dir);
        assert.equal(loaded.events.demo_evento.name, 'Demo');
        assert.ok(loaded.errors.some(e => /ya está definido/.test(e)));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('plantillas regeneradas: base común, sin placeholders rotos y Supabase en español', () => {
    const dir = path.join(ROOT, 'templates/email');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
    assert.ok(files.length >= 80);
    for (const file of files) {
        const html = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.match(html, /<!--\[if mso\]><table role="presentation" width="600"/, `${file}: ghost table`);
        assert.match(html, /name="color-scheme"/, `${file}: color-scheme`);
        assert.match(html, /background:#F2B519;border-radius:50%/, `${file}: marca`);
        assert.ok(Buffer.byteLength(html) < 90 * 1024, `${file}: tamaño`);
        assert.doesNotMatch(html, /\{\{\s*\}\}|undefined/, `${file}: placeholder vacío`);
    }
    const magic = fs.readFileSync(path.join(dir, 'supabase-magic-link.html'), 'utf8');
    assert.match(magic, /href="\{\{ \.ConfirmationURL \}\}"/);
    assert.match(magic, /\{\{ \.Token \}\}/);
    assert.match(magic, /Entra a We Ötzi/);
    const change = fs.readFileSync(path.join(dir, 'supabase-email-change.html'), 'utf8');
    for (const v of ['{{ .ConfirmationURL }}', '{{ .Email }}', '{{ .NewEmail }}']) assert.ok(change.includes(v), `email-change: ${v}`);
    assert.match(change, /Confirma tu nuevo email/);
    for (const name of ['supabase-confirm-signup', 'supabase-recovery', 'supabase-password-changed', 'supabase-magic-link', 'supabase-email-change']) {
        assert.match(fs.readFileSync(path.join(dir, `${name}.html`), 'utf8'), /\{\{ \.SiteURL \}\}\/legal\/privacy/, `${name}: privacidad`);
    }
});

test('scripts/email-preview.js escribe previews en output/email-previews', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/email-preview.js'), 'utf8');
    assert.match(src, /output', 'email-previews'/);
    assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /output\/email-previews\//);
});

// REQ-06 (P16): el cliente ve en el correo el mismo código de 6 caracteres que
// en "Solicitud enviada" y en su panel; el quote_id queda para los enlaces.
test('correos de cotización: muestran el código corto y arman los enlaces con el quote_id', () => {
    const { SPECS } = require('../lib/email-render/specs');
    const { buildQuotationEmailPayload } = require('../services/email-request-context');
    const QUOTE_ID = 'QN0123456789abcdef0123456789abcdef';
    const CODE = 'ABC234';
    // Lo que lee la persona: asunto, preheader y cuerpo sin las URL.
    const shown = (out) => `${out.subject}\n${out.preheader}\n${out.text.replace(/https?:\/\/\S+/g, '')}\n${out.html.replace(/https?:\/\/[^"'\s<]+/g, '')}`;
    const submitted = { ...fixtureFor('client_quotation_submitted'), quote_id: QUOTE_ID };

    const client = renderEmail('client_quotation_submitted', { ...submitted, quote_code: CODE }, { role: 'client' });
    assert.equal(client.subject, `Recibimos tu solicitud ${CODE}`);
    assert.match(client.text, new RegExp(`Cotización[\\s\\S]{0,12}${CODE}`));
    assert.ok(!shown(client).includes(QUOTE_ID), 'el quote_id interno no queda a la vista');
    assert.ok(client.cta.url.endsWith(`/client/dashboard?quote=${QUOTE_ID}`), client.cta.url);
    const admin = renderEmail('client_quotation_submitted', { ...submitted, quote_code: CODE }, { role: 'admin' });
    assert.equal(admin.subject, `Nueva cotización ${CODE}`);

    // Sin código (base sin la migración 20261116110000) queda el quote_id de siempre.
    const plain = renderEmail('client_quotation_submitted', submitted, { role: 'client' });
    assert.equal(plain.subject, `Recibimos tu solicitud ${QUOTE_ID}`);
    assert.match(plain.text, new RegExp(`Cotización[\\s\\S]{0,12}${QUOTE_ID}`));

    // El envío pedido desde el navegador arma el payload con la fila guardada.
    const row = { quote_id: QUOTE_ID, short_code: CODE, quote_status: 'pending', client_full_name: 'Lucía Fernández', client_email: 'lucia.cliente@example.com', artist_name: 'Mateo Rivas' };
    const built = buildQuotationEmailPayload(row, null, {}, 'https://beta.weotzi.com', 'client');
    assert.deepEqual([built.quote_id, built.quote_code], [QUOTE_ID, CODE]);
    assert.equal(buildQuotationEmailPayload({ ...row, short_code: null }, null, {}, 'https://beta.weotzi.com', 'client').quote_code, QUOTE_ID);
    assert.equal(renderEmail('client_quotation_submitted', built, { role: 'client' }).subject, `Recibimos tu solicitud ${CODE}`);

    // Ningún correo de cotización del render propio deja el quote_id a la vista
    // cuando el payload trae el código (quote_code o la fila con short_code).
    let checked = 0;
    for (const eventId of Object.keys(SPECS)) {
        const fixture = fixtureFor(eventId);
        if (!fixture || !fixture.quote_id) continue;
        for (const extra of [{ quote_code: CODE }, { short_code: CODE }]) {
            // chat_url del fixture nombra otra cotización: sin él, el enlace sale del quote_id.
            const payload = { ...fixture, quote_id: QUOTE_ID, chat_url: undefined, ...extra };
            for (const role of rolesFor(eventId, payload)) {
                const out = renderEmail(eventId, payload, { role });
                assert.ok(!shown(out).includes(QUOTE_ID), `${eventId}/${role}: muestra el quote_id interno`);
                if (/[?&]quote=/.test(out.cta.url)) assert.ok(out.cta.url.includes(`quote=${QUOTE_ID}`), `${eventId}/${role}: ${out.cta.url}`);
                checked += 1;
            }
        }
    }
    assert.ok(checked >= 30, `solo se revisaron ${checked} correos`);
});
