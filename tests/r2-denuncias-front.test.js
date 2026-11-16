'use strict';
// Ronda 2 · frente "denuncias" (P33): contratos del front y de los emails.
// wo-report.js (modal y botón [data-wo-report]), pestaña DENUNCIAS del panel
// de soporte, botón del perfil público del estudio, eventos de email y textos
// en español neutro (tuteo, sin voseo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const D = require('../lib/denuncias');
const WoReport = require('../public/shared/js/wo-report.js');
const Panel = require('../public/shared/js/support-dashboard-reports.js');
const R = WoReport._internal;
const P = Panel._internal;

const USER = '11111111-1111-4111-8111-111111111111';
const ATTACK = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'';

const NEW_FILES = [
    'lib/denuncias.js', 'lib/repos/denuncias.js', 'lib/routes/denuncias.js', 'services/email-events/denuncias.js',
    'public/shared/js/wo-report.js', 'public/shared/css/wo-report.css',
    'public/shared/js/support-dashboard-reports.js', 'public/shared/css/support-dashboard-reports.css',
    'public/shared/js/data/support-reports-repo.js'
];

// ---------------------------------------------------------------- wo-report.js

test('wo-report.js: mismo catálogo y mismos límites que el servidor', () => {
    assert.deepEqual(R.KINDS, D.KINDS);
    assert.deepEqual(R.REASONS, D.REASONS);
    assert.equal(R.DESCRIPTION_MIN, D.DESCRIPTION_MIN);
    assert.equal(R.DESCRIPTION_MAX, D.DESCRIPTION_MAX);
    assert.equal(R.MAX_LINKS, D.MAX_LINKS);
    assert.equal(R.MAX_IMAGES, D.MAX_IMAGES);
    assert.equal(R.MAX_IMAGE_BYTES, D.MAX_IMAGE_BYTES);
    assert.deepEqual(R.IMAGE_TYPES, D.IMAGE_TYPES);
    assert.equal(R.BUCKET, D.ATTACHMENTS_BUCKET);
    assert.equal(R.FOLDER, D.ATTACHMENTS_FOLDER);
    assert.deepEqual(Object.keys(R.TITLES).sort(), D.KINDS.slice().sort());
});

test('wo-report.js: en Node solo exporta helpers (sin tocar el DOM)', () => {
    assert.equal(typeof WoReport.open, 'function');
    assert.equal(typeof WoReport.refresh, 'function');
    assert.equal(typeof WoReport.boot, 'function');
    assert.doesNotThrow(() => WoReport.boot());
});

test('la ruta que arma el navegador para cada imagen es la que el servidor acepta', () => {
    for (const name of ['Foto ñandú (1).PNG', '../../etc/passwd', 'captura de pantalla.heic', '....', 'a'.repeat(200) + '.jpg', 'x.webp']) {
        const storagePath = R.storagePath(USER, name, 1700000000000, 'ab12cd');
        assert.ok(storagePath.startsWith(`${USER}/denuncias/1700000000000-ab12cd-`), storagePath);
        assert.doesNotMatch(storagePath, /\.\.|\/\/|[^A-Za-z0-9/_.-]/, storagePath);
        const parsed = D.parseAttachments([{ path: storagePath, name, size: 1000, type: 'image/png' }], USER);
        assert.equal(parsed.ok, true, `${name}: ${parsed.error}`);
    }
    assert.equal(R.safeName('..'), 'imagen');
    assert.equal(R.safeName(''), 'imagen');
});

test('imágenes: formatos del bucket, 10 MB y HEIC sin tipo declarado', () => {
    assert.equal(R.validateFile({ name: 'a.png', type: 'image/png', size: 10 }), null);
    assert.equal(R.validateFile({ name: 'a.HEIC', type: '', size: 10 }), null, 'HEIC por extensión');
    assert.equal(R.fileType({ name: 'a.HEIC', type: '' }), 'image/heic');
    assert.equal(R.validateFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }), R.MSG.fileType);
    assert.equal(R.validateFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 }), R.MSG.fileType);
    assert.equal(R.validateFile({ name: 'a.png', type: 'image/png', size: 0 }), R.MSG.fileEmpty);
    assert.equal(R.validateFile({ name: 'a.png', type: 'image/png', size: R.MAX_IMAGE_BYTES + 1 }), R.MSG.fileSize);
});

test('enlaces: mismo criterio en el navegador y en el servidor', () => {
    const cases = [
        ['https://instagram.com/p/abc\nhttps://example.com/x', true],
        ['https://a.com/1, https://a.com/1', true],
        ['', true],
        ['javascript:alert(1)', false],
        ['ftp://example.com/x', false],
        ['https://user:pass@evil.example/x', false],
        ['solo texto', false],
        ['https://a.com/1 https://a.com/2 https://a.com/3 https://a.com/4 https://a.com/5 https://a.com/6', false]
    ];
    for (const [text, ok] of cases) {
        const client = R.parseLinksText(text);
        const server = D.parseLinks(text);
        assert.equal(!client.error, ok, `navegador: ${text}`);
        assert.equal(server.ok, ok, `servidor: ${text}`);
        if (ok) assert.deepEqual(client.links, server.links);
    }
});

test('pasos del modal: motivo y descripción obligatorios, evidencia opcional, confirmación', () => {
    const reasons = R.reasonsFor('quotation');
    const draft = R.newDraft();
    assert.deepEqual(R.STEPS, ['reason', 'evidence', 'confirm']);
    assert.equal(R.validateStep(draft, 'reason', reasons).field, 'reason');
    draft.reason = 'difamacion';
    assert.equal(R.validateStep(draft, 'reason', reasons).field, 'reason', 'motivo de otro tipo');
    draft.reason = 'spam';
    draft.description = 'corta';
    assert.equal(R.validateStep(draft, 'reason', reasons).field, 'description');
    draft.description = 'x'.repeat(R.DESCRIPTION_MAX + 1);
    assert.equal(R.validateStep(draft, 'reason', reasons).field, 'description');
    draft.description = 'Me escribe el mismo mensaje publicitario todos los días.';
    assert.equal(R.validateStep(draft, 'reason', reasons), null);
    assert.equal(R.validateStep(draft, 'evidence', reasons), null, 'sin evidencia se puede seguir');
    draft.linksText = 'no es un enlace';
    assert.equal(R.validateStep(draft, 'evidence', reasons).field, 'links');
    draft.linksText = 'https://example.com/a';
    draft.files = [{}, {}, {}, {}];
    assert.equal(R.validateStep(draft, 'evidence', reasons).field, 'attachments');
    draft.files = [];
    assert.equal(R.validateStep(draft, 'confirm', reasons).field, 'confirm');
    draft.confirmed = true;
    assert.equal(R.validateStep(draft, 'confirm', reasons), null);
    assert.equal(R.stepForField('description'), 'reason');
    assert.equal(R.stepForField('attachments'), 'evidence');
    assert.equal(R.stepForField(undefined), 'confirm');
    assert.equal(R.evidenceSummary(0, 0), 'Sin evidencia adjunta');
    assert.equal(R.evidenceSummary(1, 2), '1 enlace · 2 imágenes');
});

test('HTML del modal: motivos por tipo, campos con label y todo dato escapado', () => {
    const draft = { reason: 'violencia', description: ATTACK, linksText: ATTACK, files: [{ file: { name: ATTACK, type: 'image/png' }, preview: 'blob:x"onload="alert(1)' }], confirmed: false };
    const reasons = [{ code: 'violencia', label: 'Violencia' }, { code: 'x"><script>', label: ATTACK }];
    const views = [
        R.bodyHtml({ step: 'reason', draft, reasons }),
        R.bodyHtml({ step: 'evidence', draft }),
        R.bodyHtml({ step: 'confirm', kind: 'artist', label: ATTACK, draft, reasons }),
        R.bodyHtml({ step: 'blocked', message: ATTACK }),
        R.bodyHtml({ step: 'done', result: { ticket: { code: ATTACK } } }),
        R.footHtml({ step: 'confirm', status: ATTACK, busy: true })
    ];
    for (const html of views) {
        assert.doesNotMatch(html, /<script>alert|<img src=x|"onload="/, html.slice(0, 120));
        assert.match(html, /&lt;script&gt;|&quot;/);
    }
    const quotation = R.bodyHtml({ step: 'reason', draft: R.newDraft(), reasons: R.reasonsFor('quotation') });
    for (const label of ['Comentarios abusivos', 'Fotos inapropiadas', 'Violencia', 'Spam']) assert.ok(quotation.includes(`<span>${label}</span>`), label);
    assert.equal((quotation.match(/type="radio" name="wor-reason"/g) || []).length, 4);
    assert.match(quotation, /<legend class="wor-legend">Motivo/);
    assert.match(quotation, /<label class="wor-label" for="wor-description">Cuéntanos qué pasó/);
    assert.match(quotation, /<textarea id="wor-description"[^>]*required/);
    const profile = R.bodyHtml({ step: 'reason', draft: R.newDraft(), reasons: R.reasonsFor('studio') });
    for (const label of ['Suplantación de identidad', 'Robo de propiedad intelectual', 'Difamación']) assert.ok(profile.includes(`<span>${label}</span>`), label);
    const evidence = R.bodyHtml({ step: 'evidence', draft: R.newDraft() });
    assert.match(evidence, /<label class="wor-label" for="wor-links">Enlaces/);
    assert.match(evidence, /type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp,image\/heic,\.heic"[^>]*multiple/);
    assert.match(evidence, /Hasta 3 imágenes/);
    const full = R.bodyHtml({ step: 'evidence', draft: { ...R.newDraft(), files: [1, 2, 3].map((i) => ({ file: { name: `${i}.png`, type: 'image/png' }, preview: '' })) } });
    assert.match(full, /data-wor-add-files[^>]*disabled/, 'con 3 imágenes no se agregan más');
    assert.equal((full.match(/data-wor-remove=/g) || []).length, 3);
    const confirm = R.bodyHtml({ step: 'confirm', kind: 'studio', label: 'Tinta Sur', draft: { ...R.newDraft(), reason: 'difamacion', description: 'x'.repeat(400) }, reasons: R.reasonsFor('studio') });
    assert.match(confirm, /<dd>Tinta Sur<\/dd>/);
    assert.match(confirm, /<dd>Difamación<\/dd>/);
    assert.match(confirm, /type="checkbox" id="wor-confirm"/);
    assert.match(confirm, /no ve tu denuncia ni tus datos/);
    const done = R.bodyHtml({ step: 'done', result: { ticket: { code: 'WO-00042' } } });
    assert.match(done, /<p class="wor-ticket"[^>]*>WO-00042<\/p>/);
    assert.equal(R.titleFor({ step: 'done', result: {} }), 'Recibimos tu denuncia');
    assert.equal(R.titleFor({ step: 'done', result: { duplicate: true } }), 'Ya tienes esta denuncia abierta');
    assert.equal(R.titleFor({ step: 'reason', kind: 'quotation' }), 'Denunciar cotización');
    assert.match(R.footHtml({ step: 'confirm' }), /type="submit" class="wor-btn wor-btn--danger">Enviar denuncia/);
    assert.match(R.footHtml({ step: 'confirm', busy: true }), /data-wor-back disabled/);
    assert.match(R.triggerHtml(), /<svg[^>]*aria-hidden="true"[^>]*>.*<span>Denunciar<\/span>/);
});

test('wo-report.js: contrato del botón, endpoints, Storage privado y accesibilidad', () => {
    const src = read('public/shared/js/wo-report.js');
    assert.match(src, /querySelectorAll\('\[data-wo-report\]'\)/);
    assert.match(src, /getAttribute\('data-kind'\)/);
    assert.match(src, /getAttribute\('data-id'\)/);
    assert.match(src, /getAttribute\('data-label'\)/);
    assert.match(src, /MutationObserver/, 'activa botones agregados después');
    assert.match(src, /attributeFilter: \['data-wo-report', 'data-kind', 'data-id'\]/);
    assert.match(src, /'\/api\/reports\/eligibility\?kind=' \+ encodeURIComponent\(kind\) \+ '&id=' \+ encodeURIComponent\(id\)/);
    assert.match(src, /request\('POST', '\/api\/reports'/);
    assert.match(src, /Authorization: 'Bearer ' \+ s\.access_token/);
    assert.match(src, /client\.storage\.from\(BUCKET\)\.upload\(path, file, \{ cacheControl: '3600', upsert: false, contentType: type \}\)/);
    assert.doesNotMatch(src, /rest\/v1\/|\.from\('(?!support-attachments)[a-z_]+'\)/, 'sin CRUD ad-hoc');
    assert.doesNotMatch(src, /localStorage|sessionStorage/);
    assert.match(src, /createElement\('dialog'\)/);
    assert.match(src, /showModal\(\)/);
    assert.match(src, /setAttribute\('aria-labelledby', 'wor-title'\)/);
    assert.match(src, /aria-label="Cerrar"/);
    assert.match(src, /back\.focus\(/, 'devuelve el foco al botón que abrió el modal');
    assert.match(src, /wo:report-submitted/);
    assert.match(src, /root\.__woReportBooted/, 'cargar el script dos veces no duplica nada');
    assert.match(src, /wo-report\.css/);
    // El botón solo se muestra cuando el servidor confirma que la persona puede denunciar.
    assert.match(src, /setVisible\(btn, !!\(info && info\.eligible\)\)/);
    assert.match(src, /if \(!session\) return \{ eligible: false, code: 'AUTH_REQUIRED'/);
});

test('wo-report.css: foco visible, teléfono a pantalla completa y sin movimiento si se pide', () => {
    const css = read('public/shared/css/wo-report.css');
    assert.match(css, /\[data-wo-report\]\[hidden\]\{display:none !important\}/);
    assert.match(css, /\.wor-trigger:focus-visible\{outline:2px solid/);
    assert.match(css, /\.wor-btn:focus-visible/);
    assert.match(css, /\.wor-reason input:focus-visible/);
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media \(max-width:600px\)\{\s*\.wor-dialog\{width:100vw;max-width:100vw;height:100dvh/);
    assert.match(css, /max-height:min\(680px,calc\(100dvh - 32px\)\)/, 'entra en 720 px de alto');
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
    assert.match(css, /\.wor-dialog \[hidden\]\{display:none !important\}/);
    assert.doesNotMatch(css, /border-radius:(?!0|50%)[^;}]*[1-9]/, 'esquinas rectas del DS');
});

// ---------------------------------------------------------------- páginas

test('perfil público del estudio: botón vacío del contrato y script del módulo', () => {
    const html = read('public/studio/profile/index.html');
    assert.match(html, /<button type="button" id="sp-report" data-wo-report data-kind="studio" data-id="" data-label="" hidden><\/button>/);
    assert.match(html, /<script src="\/shared\/js\/wo-report\.js\?v=[\w-]+" defer><\/script>/);
    const js = read('public/shared/js/studio-profile.js');
    assert.match(js, /const report = \$\('sp-report'\);/);
    assert.match(js, /report\.setAttribute\('data-label', name\);\s+report\.setAttribute\('data-id', studio\.id\);/);
    // El perfil no decide quién lo ve: eso lo hace el módulo con el servidor.
    assert.doesNotMatch(js, /sp-report'\)\.hidden = false|report\.hidden = false/);
});

test('detalle de cotización y perfil del artista cargan el módulo (el botón lo dejan sus frentes)', () => {
    for (const file of ['public/my-quotations/detail/index.html', 'public/artist/profile/index.html']) {
        const html = read(file);
        assert.equal((html.match(/\/shared\/js\/wo-report\.js/g) || []).length, 1, file);
        assert.match(html, /<script src="\/shared\/js\/wo-report\.js\?v=[\w-]+" defer><\/script>/, file);
    }
});

// ---------------------------------------------------------------- panel de soporte

test('panel de soporte: pestaña DENUNCIAS con su repo, su módulo y su CSS', () => {
    const html = read('public/support/dashboard/index.html');
    assert.equal((html.match(/data-tab="denuncias"/g) || []).length, 2, 'menú lateral y pestaña');
    assert.match(html, /<button class="tab-btn" data-tab="denuncias" type="button">/);
    assert.equal((html.match(/class="rpq-count" hidden/g) || []).length, 2);
    assert.match(html, /support-dashboard-reports\.css/);
    const repoAt = html.indexOf('/shared/js/data/support-reports-repo.js');
    const moduleAt = html.indexOf('/shared/js/support-dashboard-reports.js');
    assert.ok(repoAt > html.indexOf('/shared/js/data/postgrest-client.js') && moduleAt > repoAt, 'orden de carga');
    assert.ok(moduleAt > html.indexOf('/shared/js/support-dashboard.js'), 'después del panel base');

    const repo = read('public/shared/js/data/support-reports-repo.js');
    assert.match(repo, /D\.SupportReports = \{/);
    for (const endpoint of ["'/api/support/reports' + query", "'/api/support/reports/' + encodeURIComponent(ticketId)", "'/status'", "'/notes'"]) {
        assert.ok(repo.includes(endpoint), endpoint);
    }
    assert.match(repo, /Authorization: 'Bearer ' \+ s\.access_token/);

    const src = read('public/shared/js/support-dashboard-reports.js');
    assert.match(src, /const TAB = 'denuncias';/);
    assert.match(src, /root\.WeotziData\.SupportReports/);
    assert.match(src, /root\.switchTab = switchTab;/);
    assert.match(src, /'#' \+ TAB/, 'abre con /support/dashboard#denuncias');
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//, 'sin CRUD ad-hoc');
    assert.deepEqual(P.STATUSES, D.TICKET_STATUSES);
    assert.deepEqual(P.STATUS_LABELS, D.STATUS_LABELS);
    assert.deepEqual(P.OUTCOME_LABELS, D.OUTCOME_LABELS);
    assert.deepEqual(P.KIND_LABELS, D.KIND_LABELS);
    const css = read('public/shared/css/support-dashboard-reports.css');
    assert.match(css, /\.rpq-row:focus-visible/);
    assert.match(css, /@media \(max-width:900px\)/);
    assert.match(css, /min-height:44px/);
});

test('panel de soporte: el expediente completo se pinta escapado y con enlaces seguros', () => {
    const report = {
        ticket_id: '99999999-9999-4999-8999-999999999999', code: 'WO-00042', status: 'open', priority: 'urgent',
        target_kind: 'quotation', reason_label: 'Violencia', subject: ATTACK, description: `Línea 1\n${ATTACK}`,
        quote_id: 'WO-2026-0142', page_context: '/my-quotations/detail?quote=WO-2026-0142', created_at: '2026-11-16T14:00:00Z',
        dossier: {
            evidence: {
                links: ['https://instagram.com/p/abc', 'javascript:alert(1)'],
                attachments: [{ name: ATTACK, url: 'https://signed.example.com/a.png?token=1' }, { name: 'rota.png', url: null }]
            },
            reporter: {
                name: 'Mateo Rivas', role_label: 'Artista', email: 'mateo@auth.example', email_confirmed: true, user_id: 'u1',
                profile_path: '/artist/profile?artist=mateo.ink', artist: { username: 'mateo.ink', city: 'Bogotá', country: 'Colombia', instagram: ATTACK }
            },
            reported: {
                name: ATTACK, role_label: 'Cliente', email: 'x"onmouseover="alert(1)@evil.example', has_account: false,
                profile_path: '//evil.example/phish', client: { username: 'lucia', whatsapp: '+51 999' }
            },
            quotation: {
                quote_id: 'WO-2026-0142', status: 'pending', client: { name: 'Lucía', email: 'lucia@example.com' },
                tattoo: { idea: ATTACK, body_part: 'Antebrazo' },
                reference_images: ['https://cdn.example.com/ref.jpg', 'data:text/html,<script>alert(1)</script>'],
                attachments: [{ name: 'ref.png', url: 'https://drive.example.com/f1' }, { name: 'sin-url.png', url: '' }],
                drive_folder_url: 'javascript:alert(1)',
                messages_total: 120,
                messages: [
                    { sender_type: 'client', message: ATTACK, created_at: '2026-11-16T10:00:00Z', attachment_url: 'https://signed.example.com/chat.jpg', attachment_name: 'foto.jpg' },
                    { sender_type: 'artist', message: 'Respeto, por favor.', created_at: '2026-11-16T10:05:00Z', has_attachment: true, attachment_name: 'ajena.jpg', attachment_url: null }
                ]
            }
        },
        messages: [{ author_role: 'support', author_name: 'Ana', mine: true, is_internal: true, body: ATTACK, created_at: '2026-11-16T15:00:00Z' }]
    };
    const html = P.detailHtml(report, { base: '' });
    assert.doesNotMatch(html, /<script>alert|<img src=x|onmouseover="alert/, 'XSS');
    assert.doesNotMatch(html, /href="(javascript|data):/i, 'solo enlaces http(s)');
    assert.doesNotMatch(html, /evil\.example\/phish/, 'una ruta de perfil con // no se enlaza');
    for (const section of ['Denuncia', 'Denunciante', 'Denunciado', 'Cotización denunciada', 'Gestión', 'Notas internas y actividad']) {
        assert.ok(html.includes(`<p class="rpq-section-title">${section}</p>`), section);
    }
    assert.match(html, /href="\/artist\/profile\?artist=mateo\.ink" target="_blank" rel="noopener noreferrer">Ver perfil público/);
    assert.match(html, /href="https:\/\/instagram\.com\/p\/abc" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /<img src="https:\/\/signed\.example\.com\/a\.png\?token=1" alt=""/);
    assert.match(html, /rota\.png · no disponible/);
    assert.match(html, /href="mailto:mateo@auth\.example"/);
    assert.doesNotMatch(html, /href="mailto:x/, 'un email con comillas no se enlaza');
    assert.match(html, /Mensajes · últimos 2 de 120/);
    assert.match(html, /ajena\.jpg · no disponible/);
    assert.match(html, /rpq-badge--urgent/);
    assert.match(html, /<select id="rpq-new-status"/);
    assert.match(html, /<label for="rpq-note">Nueva nota interna<\/label>/);
    assert.match(html, /Soporte · Ana \(tú\) · nota interna/);
    assert.doesNotMatch(html, /undefined|\[object Object\]/);

    const row = P.rowHtml({ ticket_id: 't1', code: ATTACK, reason_label: ATTACK, reporter: { name: ATTACK }, reported: { name: ATTACK }, status: 'x"><script>' });
    assert.doesNotMatch(row, /<script>|<img src=x/);
    assert.match(row, /role="row" tabindex="0"/);
    assert.doesNotThrow(() => P.detailHtml({}, {}));
    assert.doesNotThrow(() => P.detailHtml(null));
});

test('panel de soporte: helpers de búsqueda, estado y notas', () => {
    assert.equal(P.profileHref('/studio/profile?studio=tinta-sur', '/beta'), '/beta/studio/profile?studio=tinta-sur');
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', '', null]) assert.equal(P.profileHref(bad, ''), '', String(bad));
    assert.equal(P.safeUrl('javascript:alert(1)'), '');
    assert.equal(P.safeUrl('https://ok.example/a'), 'https://ok.example/a');
    const item = { code: 'WO-00042', reason_label: 'Spam', quote_id: 'WO-2026-0142', reporter: { name: 'Mateo', email: 'mateo@auth.example' }, reported: { name: 'Lucía' } };
    for (const term of ['wo-00042', 'spam', '0142', 'MATEO', 'lucía', '']) assert.equal(P.matchesSearch(item, term), true, term);
    assert.equal(P.matchesSearch(item, 'nadie'), false);
    assert.deepEqual(P.buildStatusPayload('in_progress', 'resuelto', 'texto'), { payload: { status: 'in_progress' } });
    assert.equal(P.buildStatusPayload('resolved', '', 'Se suspendió la cuenta.').field, 'outcome');
    assert.equal(P.buildStatusPayload('resolved', 'resuelto', 'ok').field, 'resolution');
    assert.deepEqual(P.buildStatusPayload('resolved', 'sin_accion', ' Sin evidencia suficiente. ').payload, { status: 'resolved', outcome: 'sin_accion', resolution: 'Sin evidencia suficiente.' });
    assert.deepEqual(P.buildStatusPayload('closed', '', '').payload, { status: 'closed' });
    assert.ok(P.buildStatusPayload('borrado').error);
    // Lo que arma el panel lo acepta el servidor tal cual.
    for (const args of [['in_progress'], ['resolved', 'resuelto', 'Se suspendió la cuenta.'], ['closed', 'sin_accion', ''], ['waiting_user']]) {
        const built = P.buildStatusPayload(...args);
        assert.equal(D.parseStatusInput(built.payload).ok, true, args.join(','));
    }
    assert.ok(P.buildNote('  ').error);
    assert.deepEqual(P.buildNote(' Llamé al estudio. '), { note: 'Llamé al estudio.' });
    assert.equal(D.parseNoteInput({ note: P.buildNote('Nota').note }).ok, true);
});

// ---------------------------------------------------------------- emails

test('emails de denuncias: cargados solos, server-only, sin datos de contacto y con CTA absoluto', () => {
    const mapping = require('../services/email-event-mapping');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    const { renderEmail } = require('../lib/email-render');
    for (const id of ['report_ticket_created_support', 'report_ticket_received']) {
        assert.equal(mapping.EXTENSION_SOURCES[id], 'denuncias.js', id);
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} solo servidor`);
    }
    assert.doesNotMatch(read('services/email-event-mapping.js'), /report_ticket_/, 'el mapeo central no se toca');
    const payload = {
        app_base_url: 'https://beta.weotzi.com', ticket_code: 'WO-00042', report_kind_label: 'Cotización', reason_label: 'Violencia',
        reporter_name: `Mateo${ATTACK}`, reporter_role_label: 'Artista', reported_name: 'Lucía Fernández', reported_role_label: 'Cliente',
        report_quote_id: 'WO-2026-0142', priority_label: 'Urgente', reported_at: '2026-11-16T14:00:00Z',
        support_email: 'soporte@weotzi.com', support_emails: ['agente@weotzi.com'],
        recipient_email: 'mateo@auth.example', recipient_name: 'Mateo Rivas', recipient_role: 'studio',
        queue_url: 'javascript:alert(1)', reported_email: 'lucia@auth.example', description: 'DESCRIPCION-PRIVADA'
    };
    assert.deepEqual(mapping.resolveRecipients('report_ticket_created_support', payload), ['soporte@weotzi.com', 'agente@weotzi.com']);
    assert.deepEqual(mapping.resolveRecipients('report_ticket_received', payload), ['mateo@auth.example']);
    assert.deepEqual(mapping.resolveRecipients('report_ticket_created_support', {}), []);

    const support = renderEmail('report_ticket_created_support', payload);
    assert.equal(support.subject, 'Nueva denuncia WO-00042: Violencia');
    assert.equal(support.cta.url, 'https://beta.weotzi.com/support/dashboard#denuncias', 'la URL nunca sale del payload');
    assert.doesNotMatch(support.html, /<script>alert|javascript:/);
    assert.match(support.text, /Denunciado: Lucía Fernández \(Cliente\)/);
    assert.match(support.text, /Cotización: WO-2026-0142/);
    const receipt = renderEmail('report_ticket_received', payload);
    assert.equal(receipt.subject, 'Recibimos tu denuncia WO-00042');
    assert.equal(receipt.cta.url, 'https://beta.weotzi.com/studio/dashboard');
    assert.equal(renderEmail('report_ticket_received', { ...payload, recipient_role: 'x' }).cta.url, 'https://beta.weotzi.com/artist/dashboard');
    assert.match(receipt.text, /Número de ticket: WO-00042/);
    assert.match(receipt.text, /no ve tu denuncia ni tus datos/);
    for (const out of [support, receipt]) {
        assert.ok(out.preheader.length >= 40 && out.preheader.length <= 110, `preheader de ${out.preheader.length}`);
        assert.doesNotMatch(out.html + out.text, /lucia@auth\.example|DESCRIPCION-PRIVADA/, 'sin contacto del denunciado ni la descripción');
        assert.doesNotMatch(out.text, /\b(undefined|null)\b/);
    }
    const attribs = mapping.buildAttribs('report_ticket_created_support', payload);
    assert.equal(attribs.reported_email, undefined, 'lista blanca de atributos');
    assert.equal(attribs.description, undefined);
});

// ---------------------------------------------------------------- idioma y assets

test('textos nuevos en español neutro con tuteo (sin voseo)', () => {
    const VOSEO = /\b(vos|querés|tenés|podés|sabés|necesitás|contanos|escribinos|elegí|subí|revisá|escribí|iniciá|probá|esperá|volvé|guardá|marcá|indicá|agregá|completá|ingresá|hacé|mirá|andá|fijate|adjuntá|quitala|denunciá|contá|enviá|abrí)\b/i;
    for (const file of NEW_FILES) {
        assert.ok(exists(file), file);
        const lines = read(file).split(/\r?\n/);
        lines.forEach((line, i) => assert.doesNotMatch(line, VOSEO, `${file}:${i + 1}`));
    }
    const migration = read('supabase/migrations/20261116210000_support_ticket_reports.sql');
    assert.doesNotMatch(migration, VOSEO);
    assert.match(R.MSG.descriptionShort, /^Cuéntanos/);
    assert.match(R.MSG.reason, /^Elige/);
    assert.match(R.MSG.login, /^Inicia sesión/);
});

test('sin imágenes por generar: el manifiesto de assets del frente queda vacío', () => {
    const manifest = JSON.parse(read('docs/plans/ronda2-assets/denuncias.json'));
    assert.deepEqual(manifest, []);
});
