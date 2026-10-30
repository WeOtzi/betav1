// Plataforma de Estudios · lado del artista (W-ARTIST,
// docs/plans/2026-10-30-estudios-plataforma.md "Frontend del artista"):
// estados del alta en dos sentidos, solicitar / retirar el alta, contratos por
// firmar (?contrato=), contrato vigente, materiales entregados, postulaciones
// con contrato pendiente, deep link del Inbox, registro y guardado del perfil.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const M = require(path.join(root, 'public', 'shared', 'js', 'invitations-model.js'));
const AppState = require(path.join(root, 'public', 'shared', 'js', 'applications-state.js'));
const DeepLink = require(path.join(root, 'public', 'shared', 'js', 'inbox-deeplink.js'));

// Extrae `function name(...) {...}` (o async) de un script clásico contando
// llaves; las funciones extraídas no tienen llaves desbalanceadas en strings.
function extractFunction(source, name) {
    const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = re.exec(source);
    assert.ok(match, `falta la función ${name}`);
    const open = source.indexOf('{', source.indexOf(')', match.index));
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(match.index, i + 1);
        }
    }
    throw new Error(`función ${name} sin cerrar`);
}

function between(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `falta ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `falta ${endMarker}`);
    return source.slice(start, end);
}

const NOW = new Date('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();

/* ------------------------------ estados (model) ------------------------------ */

test('estados del alta: requested / pending / active / rejected_by_studio / rejected_by_artist', () => {
    assert.deepEqual(M.ARTIST_STATES, ['requested', 'pending', 'active', 'rejected_by_studio', 'rejected_by_artist']);
    assert.equal(M.artistState({ status: 'requested', initiated_by: 'artist' }), 'requested');
    assert.equal(M.artistState({ status: 'pending_acceptance' }), 'pending');
    assert.equal(M.artistState({ status: 'pending_invite', initiated_by: 'studio' }), 'pending');
    assert.equal(M.artistState({ status: 'active' }), 'active');
    assert.equal(M.artistState({ status: 'paused' }), 'active');
    // El rechazo se lee según quién inició el alta; `initiated_by` ausente = 'studio'.
    assert.equal(M.artistState({ status: 'rejected', initiated_by: 'artist' }), 'rejected_by_studio');
    assert.equal(M.artistState({ status: 'rejected', initiated_by: 'studio' }), 'rejected_by_artist');
    assert.equal(M.artistState({ status: 'rejected' }), 'rejected_by_artist');
    assert.equal(M.initiatedBy({}), 'studio');
    // Los dos rechazos van a la pestaña "Rechazadas".
    assert.equal(M.stateGroup('rejected_by_studio'), 'rejected');
    assert.equal(M.stateGroup('rejected_by_artist'), 'rejected');
    assert.equal(M.stateGroup('requested'), 'requested');
    assert.equal(M.membershipState({ status: 'requested' }), 'requested');
});

test('copy: rechazo del estudio, stepper y espera según el estudio tenga dueño', () => {
    assert.equal(M.REJECTED_BY_STUDIO_COPY, 'El estudio no aprobó tu solicitud');
    assert.deepEqual(M.REQUEST_STEPS, ['Solicitud enviada', 'En revisión', 'Aprobada']);

    const open = M.requestSteps('requested');
    assert.deepEqual(open.map((step) => [step.label, step.done, step.current]),
        [['Solicitud enviada', true, false], ['En revisión', false, true], ['Aprobada', false, false]]);
    assert.ok(M.requestSteps('active').every((step) => step.done));
    assert.equal(M.requestSteps('rejected_by_studio')[2].label, 'No aprobada');

    assert.equal(M.requestWaitingLabel({ studio_has_owner: true }), 'Esperando al estudio');
    assert.equal(M.requestWaitingLabel({ studio_has_owner: false }), 'Esperando que el estudio se sume');
    assert.equal(M.requestWaitingLabel({ studios: { user_id: null } }), 'Esperando que el estudio se sume');
    assert.equal(M.requestWaitingLabel({ studios: { user_id: 'owner-1' } }), 'Esperando al estudio');

    const line = M.invitationLine({ status: 'requested', initiated_by: 'artist', invited_at: '2026-10-08', studio_has_owner: false });
    assert.equal(line, 'Pediste el alta el 08 OCT · esperando que el estudio se sume.');
    // Las invitaciones del estudio conservan el texto de siempre.
    assert.match(M.invitationLine({ status: 'pending_acceptance', invited_at: '2026-10-08' }), /^Te invitó el 08 OCT/);
});

test('detalles de la solicitud: portfolio solo http(s) y estilos', () => {
    const details = M.requestDetails({ studio_membership_request_details: [{ message: ' Hola ', portfolio_url: 'javascript:alert(1)', styles: ['Blackwork'] }] });
    assert.equal(details.message, 'Hola');
    assert.equal(details.portfolioUrl, null);
    assert.deepEqual(details.styles, ['Blackwork']);
    assert.equal(M.requestDetails({ studio_membership_request_details: { portfolio_url: 'https://ejemplo.com/obra' } }).portfolioUrl, 'https://ejemplo.com/obra');
    assert.equal(M.safeUrl('data:text/html,hola'), null);
    assert.equal(M.safeUrl('https://ok.example/x'), 'https://ok.example/x');
});

test('listado: las solicitudes enviadas van después de las invitaciones pendientes', () => {
    const dateOf = (item) => item.invited_at;
    const items = [
        { id: 'r', _state: 'requested', invited_at: '2026-10-29' },
        { id: 'p', _state: 'pending', invited_at: '2026-10-01' },
        { id: 'a', _state: 'active', invited_at: '2026-09-01' },
        { id: 'x', _state: 'rejected', invited_at: '2026-10-28' },
    ];
    const layout = M.listLayout(items, { dateOf, featured: null });
    assert.deepEqual(layout.items.map((item) => item.id), ['a', 'p', 'r', 'x']);
    // La invitación del mes nunca es una solicitud propia.
    assert.equal(M.featuredInvitation([items[0]], () => true, dateOf), null);
});

test('"Solicitar alta": rol, fecha desde hoy, mensaje ≤1000 y portfolio http(s)', () => {
    const ok = M.validateMembershipRequest({ role: 'guest', locationId: 'loc-1', message: ' Trabajo acá ', portfolioUrl: 'https://mi.portfolio', proposedStartDate: '2026-11-15' }, NOW);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.value, { role: 'guest', locationId: 'loc-1', message: 'Trabajo acá', portfolioUrl: 'https://mi.portfolio/', proposedStartDate: '2026-11-15' });

    const empty = M.validateMembershipRequest({}, NOW);
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.value, { role: 'resident', locationId: null, message: null, portfolioUrl: null, proposedStartDate: null });

    const bad = M.validateMembershipRequest({ role: 'manager', message: 'x'.repeat(1001), portfolioUrl: 'ftp://nope', proposedStartDate: '2026-10-01' }, NOW);
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['message', 'portfolioUrl', 'proposedStartDate', 'role']);
    assert.match(bad.errors.portfolioUrl, /http:\/\/ o https:\/\//);
});

test('friendlyError: migración pendiente vs mensaje de la RPC (incluido P0001)', () => {
    for (const code of ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01']) {
        assert.equal(M.friendlyError({ code, message: 'raw' }), 'Esta función todavía no está disponible (falta aplicar una migración).', code);
        assert.equal(M.isMissingSchema({ code }), true);
    }
    assert.equal(M.friendlyError({ code: 'P0001', message: 'Ya tenés una solicitud o vínculo abierto con este estudio' }),
        'Ya tenés una solicitud o vínculo abierto con este estudio');
    assert.equal(M.friendlyError({ code: '23514', message: 'Esperá unos días antes de volver a solicitar' }), 'Esperá unos días antes de volver a solicitar');
    assert.equal(M.friendlyError(null, 'Fallback'), 'Fallback');
});

/* ------------------------------ contratos (model) ------------------------------ */

const CONTRACTS = [
    { id: 'c-late', status: 'sent', membership_id: 'm-1', version: 1, contract_number: 'C-2026-0002', sent_at: iso(-2), expires_at: iso(10) },
    { id: 'c-soon', status: 'sent', membership_id: 'm-2', version: 1, contract_number: 'C-2026-0001', sent_at: iso(-1), expires_at: iso(2) },
    { id: 'c-gone', status: 'sent', membership_id: 'm-3', version: 1, contract_number: 'C-2026-0003', sent_at: iso(-20), expires_at: iso(-1) },
    { id: 'c-old', status: 'signed', membership_id: 'm-4', version: 1, contract_number: 'C-2026-0004' },
    { id: 'c-new', status: 'signed', membership_id: 'm-4', version: 2, contract_number: 'C-2026-0004' },
];

test('contratos por firmar: sent sin vencer, el que vence antes primero; vencido = expired', () => {
    assert.deepEqual(M.contractsToSign(CONTRACTS, NOW).map((c) => c.id), ['c-soon', 'c-late']);
    assert.equal(M.contractState(CONTRACTS[2], NOW), 'expired');
    assert.equal(M.contractState(CONTRACTS[0], NOW), 'sent');
    assert.equal(M.contractStatusLabel('sent'), 'Pendiente de firma');
    assert.equal(M.contractStatusLabel('terminated'), 'Rescindido');
    assert.equal(M.contractExpiryLabel(CONTRACTS[1], NOW), 'Vence en 2 días');
    assert.match(M.contractExpiryLabel(CONTRACTS[2], NOW), /^Venció el /);
    // Una invitación con contrato enviado se responde firmándolo.
    assert.equal(M.pendingContractFor(CONTRACTS, 'm-2', NOW).id, 'c-soon');
    assert.equal(M.pendingContractFor(CONTRACTS, 'm-3', NOW), null, 'el vencido no reemplaza "Aceptar"');
});

test('contrato vigente: el apuntado por current_contract_id o el signed de mayor versión', () => {
    assert.equal(M.currentContractFor(CONTRACTS, { id: 'm-4' }).id, 'c-new');
    assert.equal(M.currentContractFor(CONTRACTS, { id: 'm-4', current_contract_id: 'c-old' }).id, 'c-old');
    assert.equal(M.currentContractFor(CONTRACTS, { id: 'm-9' }), null);
    assert.equal(M.contractLabel(CONTRACTS[4]), 'C-2026-0004 v2');
});

test('modalidad en palabras del artista y dinero por moneda (sin sumar monedas)', () => {
    const pct = M.compensationSummary({ compensation_model: 'percentage', artist_percentage: 60 });
    assert.equal(pct, 'Porcentaje · 60% para vos · 40% para el estudio');
    const fixed = M.compensationLines({ compensation_model: 'fixed', fixed_amount: 120000, fixed_currency: 'ARS', fixed_period: 'monthly', fixed_payer: 'artist_to_studio' });
    assert.equal(fixed.length, 1);
    assert.match(fixed[0], /120\.000/);
    assert.match(fixed[0], /por mes · Alquiler de puesto: vos le pagás al estudio$/);
    const usd = M.formatMoney(450, 'USD');
    const ars = M.formatMoney(450, 'ARS');
    assert.notEqual(usd, ars, 'cada moneda se formatea con su código');
    assert.equal(M.compensationSummary({}), 'A definir con el estudio');
    const mixed = M.compensationLines({ compensation_model: 'mixed', artist_percentage: 50, fixed_amount: 100, fixed_currency: 'EUR', fixed_period: 'weekly', fixed_payer: 'studio_to_artist' });
    assert.equal(mixed.length, 2);
    assert.match(mixed[1], /Pago al artista: el estudio te paga/);
});

test('firma: nombre completo (≥3) y aceptación explícita de los términos', () => {
    assert.equal(M.SIGNER_NAME_MIN, 3);
    const ok = M.validateSignature({ name: '  Ana   Pérez ', accept: true });
    assert.deepEqual(ok, { ok: true, errors: {}, name: 'Ana Pérez' });
    const bad = M.validateSignature({ name: 'Al', accept: false });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.name && bad.errors.accept);
    assert.equal(M.validateSignature({ name: 'Ana Pérez', accept: 'true' }).ok, false, 'solo true acepta');
});

test('materiales entregados: filtra por estudio, ordena y calcula el neto por ítem', () => {
    const rows = [
        { studio_id: 's-1', item_name: 'Agujas 3RL', unit: 'caja', kind: 'assignment', quantity: 5, performed_at: '2026-10-01T10:00:00Z' },
        { studio_id: 's-1', item_name: 'Agujas 3RL', unit: 'caja', kind: 'return', quantity: 1.5, performed_at: '2026-10-10T10:00:00Z' },
        { studio_id: 's-2', item_name: 'Tinta negra', unit: 'frasco', kind: 'assignment', quantity: 2, performed_at: '2026-10-05T10:00:00Z' },
        { studio_id: 's-1', item_name: 'Guantes', unit: 'par', kind: 'consumption', quantity: 9, performed_at: '2026-10-11T10:00:00Z' },
    ];
    const summary = M.materialsForStudio(rows, 's-1');
    assert.deepEqual(summary.movements.map((m) => m.kindLabel), ['Devolución', 'Entrega']);
    assert.equal(summary.items.length, 1);
    assert.deepEqual([summary.items[0].delivered, summary.items[0].returned, summary.items[0].net], [5, 1.5, 3.5]);
    assert.equal(summary.items[0].netLabel, '3,5 caja');
    assert.equal(M.materialsForStudio([], 's-1').movements.length, 0);
});

/* --------------------------- postulaciones (applications) --------------------------- */

test('postulaciones: contrato_pendiente con un sent vigente, confirmada solo con signed o accepted', () => {
    const contracts = [
        { id: 'k-1', application_id: 'app-1', status: 'sent', version: 1, expires_at: iso(5) },
        { id: 'k-2', application_id: 'app-2', status: 'sent', version: 1, expires_at: iso(-1) },
        { id: 'k-3', application_id: 'app-3', status: 'signed', version: 1 },
        { id: 'k-4', application_id: 'app-3', status: 'sent', version: 2, expires_at: iso(5) },
    ];
    const pending = AppState.contractForApplication(contracts, 'app-1', NOW);
    assert.equal(pending.id, 'k-1');
    assert.equal(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, false, pending, NOW), 'contrato_pendiente');
    assert.equal(AppState.label('contrato_pendiente'), 'Contrato pendiente de firma');
    assert.equal(AppState.contractHref(pending), '/artist/invitations?contrato=k-1');
    assert.equal(AppState.contractHref(null), '/artist/invitations');

    // Un sent vencido no cuenta: vuelve a "En revisión".
    assert.equal(AppState.contractForApplication(contracts, 'app-2', NOW), null);
    assert.equal(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, false, null, NOW), 'en_revision');

    // El firmado manda sobre un enviado posterior.
    const signed = AppState.contractForApplication(contracts, 'app-3', NOW);
    assert.equal(signed.id, 'k-3');
    assert.equal(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, false, signed, NOW), 'confirmada');
    assert.equal(AppState.deriveSpot({ status: 'accepted' }, { status: 'open' }, false, null, NOW), 'confirmada');
    // Sin contrato y sin accepted, una postulación avanzada no se muestra confirmada.
    assert.notEqual(AppState.deriveSpot({ status: 'shortlisted' }, { status: 'open' }, false), 'confirmada');
    // Retirada y rechazada ganan siempre.
    assert.equal(AppState.deriveSpot({ status: 'withdrawn' }, null, false, pending, NOW), 'retirada');
});

test('artist-applications.js usa StudioContracts.listForArtist y enlaza a ?contrato=', () => {
    const js = read('public/shared/js/artist-applications.js');
    assert.match(js, /repo\.listForArtist\(uid, \{ status: \['sent', 'signed'\] \}\)/);
    assert.match(js, /contrato_pendiente: \{ label: 'Contrato pendiente de firma'/);
    assert.match(js, /'Contrato pendiente de firma' \+ ARROW_ICON/);
    assert.match(js, /contractForApplication\(contracts, app\.id\)/);
});

/* ------------------------------ Inbox deep link ------------------------------ */

test('Inbox: context_type studio_contract lleva a /artist/invitations?contrato=<id>', () => {
    const row = { key: 'unified:t-c', id: 't-c', source: 'unified', category: 'invitations', contextType: 'studio_contract', contextId: 'ct-1', context: { contract_id: 'ct-1' }, archived: false };
    assert.equal(DeepLink.STUDIO_CONTRACT_CONTEXT, 'studio_contract');
    assert.equal(DeepLink.contextHref(row), '/artist/invitations?contrato=ct-1');
    assert.equal(DeepLink.contractIdOf({ context_type: 'studio_contract', context_id: 'ct-2' }), 'ct-2');
    assert.equal(DeepLink.contextHref({ contextType: 'quotation', contextId: 'Q-1' }), null);

    const rows = [row, { key: 'unified:t-q', contextType: 'quotation', contextId: 'Q-1', context: {}, archived: false }];
    assert.deepEqual(DeepLink.resolveDeepLink(rows, new URLSearchParams('contrato=ct-1')), { key: 'unified:t-c', filter: null });
    assert.deepEqual(DeepLink.resolveDeepLink(rows, new URLSearchParams('contract=ct-1')), { key: 'unified:t-c', filter: null });
    // Sin hilo todavía: el Inbox queda en Invitaciones.
    assert.deepEqual(DeepLink.resolveDeepLink(rows, new URLSearchParams('contrato=ct-9')), { key: null, filter: 'invitations' });
});

test('Inbox: el enlace de contexto de un hilo studio_contract abre el contrato', () => {
    const js = read('public/shared/js/artist-inbox.js');
    const start = js.indexOf('function contextLink(row)');
    assert.ok(start > 0, 'contextLink existe');
    const body = js.slice(start, js.indexOf('\n    }\n', start));
    const deepLinkAt = body.indexOf('deepLink.contextHref(row)');
    assert.ok(deepLinkAt > 0, 'usa ArtistInboxDeepLink.contextHref');
    assert.ok(deepLinkAt < body.indexOf("invitations: { href: '/artist/invitations'"), 'antes del enlace genérico de Invitaciones');
    assert.match(body, /if \(contractHref\) return \{ href: appHref\(contractHref\), label: 'Ver contrato' \};/);
});

/* ------------------------------ /artist/invitations ------------------------------ */

test('las páginas cargan studio-contracts-repo.js justo después de studios-repo.js', () => {
    for (const page of ['public/artist/invitations/index.html', 'public/artist/applications/index.html']) {
        const html = read(page);
        assert.match(html, /<script src="\/shared\/js\/data\/studios-repo\.js"><\/script>\s*<script src="\/shared\/js\/data\/studio-contracts-repo\.js"><\/script>/, page);
    }
});

test('artist-invitations.js: ruta ?contrato=, solicitudes, contratos y materiales vía repos', () => {
    const js = read('public/shared/js/artist-invitations.js');
    assert.match(js, /const ROUTE_KEYS = \[[^\]]*'contrato'[^\]]*\]/);
    assert.match(js, /query\.get\('contrato'\)/);
    // Datos: solo window.WeotziData.
    assert.match(js, /repo\.listForArtistV2\(state\.userId/);
    assert.match(js, /repo\.listRequestsForArtist\(state\.userId\)/);
    assert.match(js, /C\.listForArtist\(state\.userId, \{ status: CONTRACT_STATUSES \}\)/);
    assert.match(js, /C\.expireOverdue\(null\)/);
    assert.match(js, /D\.StudioContracts\.get\(contractId\)/);
    assert.match(js, /ops\.listMyMaterialAssignments\(\)/);
    assert.doesNotMatch(js, /fetch\(['"`][^'"`]*\/rest\/v1/, 'sin CRUD ad-hoc');
    assert.doesNotMatch(js, /_supabase\.from\(/);
    // Firma / rechazo / rescisión y avisos al estudio.
    assert.match(js, /D\.StudioContracts\.sign\(contract\.id, check\.name, true\)/);
    assert.match(js, /notifyStudio\('contract_signed', \{ contract_id: contract\.id \}\)/);
    assert.match(js, /D\.StudioContracts\.decline\(contract\.id/);
    assert.match(js, /notifyStudio\('contract_declined', \{ contract_id: contract\.id \}\)/);
    assert.match(js, /D\.StudioContracts\.terminate\(contract\.id, reason, true\)/);
    assert.match(js, /notifyStudio\('contract_terminated', \{ contract_id: contract\.id \}\)/);
    assert.match(js, /const NOTIFY_PATH = '\/api\/artist\/studio-notify';/);
    // Copy de la firma.
    assert.match(js, /Leí y acepto los términos/);
    assert.match(js, /Firmar y aceptar/);
    assert.match(js, /Revisar y firmar contrato/);
    assert.match(js, /Contratos por firmar/);
    // Retirar solicitud.
    assert.match(js, /D\.StudioMemberships\.withdrawRequest\(membershipId\)/);
    assert.match(js, /Retirar solicitud/);
    // Contrato vigente y materiales.
    assert.match(js, /Contrato vigente/);
    assert.match(js, /Rescindir contrato/);
    assert.match(js, /Materiales entregados/);
    // El contrato se ve con la grilla de condiciones (inv-offer-grid) y se imprime.
    const main = extractFunction(js, 'contractMain');
    assert.match(main, /inv-offer-grid/);
    assert.match(main, /terms_hash/);
});

test('una invitación con contrato enviado reemplaza "Aceptar" por "Revisar y firmar contrato"', () => {
    const js = read('public/shared/js/artist-invitations.js');
    for (const name of ['renderFeature', 'renderRow', 'detailAside']) {
        const body = extractFunction(js, name);
        assert.match(body, /contract\s*\?\s*contractLink\(|signButton \|\|/, `${name} no cambia "Aceptar" por el contrato`);
    }
    const aside = extractFunction(js, 'detailAside');
    assert.match(aside, /const signButton = contract \? contractLink\(contract, 'inv-aside-btn inv-aside-btn--primary'\) : '';/);
});

test('href con datos pasan por safeUrl y las interpolaciones se escapan', () => {
    const js = read('public/shared/js/artist-invitations.js');
    assert.match(extractFunction(js, 'requestPanel'), /safeUrl\(request\.portfolioUrl\)/);
    assert.match(extractFunction(js, 'detailMain'), /websiteUrl = website \? safeUrl\(/);
    const studio = read('public/shared/js/invitations-studio.js');
    assert.match(studio, /const websiteUrl = website \? safeUrl\(/);
    assert.doesNotMatch(studio, /href="\$\{esc\(\/\^https\?/, 'el link del sitio ya no se arma sin safeUrl');
});

test('"Trabajo acá / Solicitar alta": drawer con rol, sede, fecha, mensaje y portfolio', () => {
    const js = read('public/shared/js/invitations-studio.js');
    assert.match(js, /Trabajo acá \/ Solicitar alta/);
    const drawer = extractFunction(js, 'openRequest');
    for (const field of ['name="role"', 'name="locationId"', 'name="proposedStartDate"', 'name="message"', 'name="portfolioUrl"']) {
        assert.ok(drawer.includes(field), `falta ${field}`);
    }
    const submit = extractFunction(js, 'submitRequest');
    assert.match(submit, /M\.validateMembershipRequest\(values\)/);
    assert.match(submit, /D\.StudioMemberships\.requestMembership\(\{ studioId: studio\.id, \.\.\.check\.value \}\)/);
    // Aviso al dueño solo si el estudio tiene dueño.
    assert.match(submit, /if \(hasOwner && membershipId && app\(\)\.notifyStudio\) \{\s*app\(\)\.notifyStudio\('membership_request_created', \{ membership_id: membershipId \}\);/);
    assert.match(submit, /Este estudio todavía no está en We Ötzi\. Guardamos tu solicitud y la va a ver cuando active su cuenta/);
    assert.match(submit, /M\.friendlyError\(result && result\.error/);
    // No se ofrece con un vínculo abierto de cualquier rol.
    assert.match(extractFunction(js, 'openMembership'), /app\(\)\.openMembershipForStudio\(studioId\)/);
    const app = read('public/shared/js/artist-invitations.js');
    const open = extractFunction(app, 'openMembershipForStudio');
    assert.match(open, /\['requested', 'pending', 'active'\]\.includes\(item\._state\)/);
    assert.match(app, /request: query\.get\('solicitar'\) === '1'/);
});

test('invitations-studio: el botón de solicitar solo aparece sin vínculo abierto', () => {
    // Harness VM: openMembership + canRequest con un WoInvitationsApp falso.
    const js = read('public/shared/js/invitations-studio.js');
    const context = {
        window: {},
        D: { StudioMemberships: { requestMembership() {} } },
        M,
    };
    context.app = () => context.window.WoInvitationsApp;
    vm.createContext(context);
    vm.runInContext(`${extractFunction(js, 'openMembership')}\n${extractFunction(js, 'canRequest')}\nthis.canRequest = canRequest;`, context);
    const items = [{ id: 'm-1', studio_id: 's-1', _state: 'rejected' }, { id: 'm-2', studio_id: 's-2', _state: 'requested' }];
    context.window.WoInvitationsApp = {
        openMembershipForStudio: (studioId) => items.find((item) => item.studio_id === studioId && ['requested', 'pending', 'active'].includes(item._state)) || null,
    };
    assert.equal(context.canRequest({ id: 's-1' }), true, 'un rechazo previo deja volver a pedir');
    assert.equal(context.canRequest({ id: 's-2' }), false, 'ya hay una solicitud abierta');
    context.D = {};
    assert.equal(context.canRequest({ id: 's-1' }), false, 'sin el repo no se ofrece');
});

test('CSS de invitaciones: estilos de solicitudes, contratos, materiales y drawers (solo agregados)', () => {
    const css = read('public/shared/css/artist-invitations-figma.css');
    const additions = css.slice(css.indexOf('Plataforma de Estudios'));
    for (const selector of ['.inv-dot--requested', '.inv-badge--request', '.inv-detail-status--requested', '.inv-row--request',
        '.inv-row-wait', '.inv-contracts', '.inv-contract ', '.inv-contract-actions', '.inv-contract-section', '.inv-contract-hash',
        '.inv-contract-current', '.inv-materials', '.inv-materials-table', '.inv-input', '.inv-check', '@media print']) {
        assert.ok(additions.includes(selector), `falta ${selector}`);
    }
    // Enlaces con forma de botón sobre fondo oscuro/azul conservan el contraste.
    assert.match(additions, /\.inv-btn--ink \{ --text-link: var\(--neutral-100\)/);
    assert.match(additions, /\.inv-aside-btn--primary \{ --text-link: var\(--figma-white\)/);
    assert.doesNotMatch(css, /border-radius:\s*(?!0|var\(--radius-pill\))[1-9]/);
    assert.match(read('public/shared/css/invitations-studios.css'), /\.isd-btn--on-dark \{/);
});

/* ------------------------------ registro del artista ------------------------------ */

test('registro 05: la búsqueda pide user_id y el hint cambia según el estudio tenga dueño', () => {
    const js = read('public/shared/js/register.js');
    const search = extractFunction(js, 'searchStudios');
    assert.match(search, /columns: 'id, name, normalized_name, user_id,/);

    const context = {};
    vm.createContext(context);
    const hints = between(js, 'const STUDIO_MEMBERSHIP_HINTS = {', '};') + '};';
    vm.runInContext(`${hints}\n${extractFunction(js, 'studioMembershipHintText')}\nthis.hint = studioMembershipHintText; this.HINTS = STUDIO_MEMBERSHIP_HINTS;`, context);
    assert.equal(context.HINTS.owned, 'Tu alta queda pendiente hasta que el estudio la apruebe');
    assert.equal(context.HINTS.unowned, 'Guardamos tu solicitud; el estudio la verá cuando active su cuenta');
    assert.equal(context.hint('studio', true, true), context.HINTS.owned);
    assert.equal(context.hint('both', true, false), context.HINTS.unowned);
    assert.equal(context.hint('studio', true, null), '', 'sin saber si tiene dueño no se promete nada');
    assert.equal(context.hint('studio', false, true), '', 'sin estudio elegido no hay hint');
    assert.equal(context.hint('independent', true, true), '');

    // Elegir de la lista lee user_id; "Crear «x»" es un estudio sin dueño.
    const select = extractFunction(js, 'selectStudioSuggestion');
    assert.match(select, /selectedStudioHasOwner = false;/);
    assert.match(select, /Boolean\(cached\.user_id\)/);
    assert.match(extractFunction(js, 'syncTrabajoGateHint'), /syncStudioMembershipHint\(\);/);
});

test('registro 05: un solo ra-hint nuevo en el paso 05', () => {
    const html = read('public/register-artist/index.html');
    const step = between(html, '<!-- ===== 05 · CÓMO TRABAJÁS ===== -->', '<!-- ===== 06 · NOVEDADES ===== -->');
    assert.match(step, /<p class="ra-hint studio-membership-hint" id="studio-membership-hint" role="status" aria-live="polite" hidden><\/p>/);
    assert.equal((html.match(/id="studio-membership-hint"/g) || []).length, 1);
});

test('registro: no escribe artist_tattoo_locations.studio_id ni artists_db.studio_id', () => {
    const js = read('public/shared/js/register.js');
    const persist = extractFunction(js, 'persistSelectedStudioLocation');
    assert.match(persist, /studio_id: null,/);
    // studio_name es NOT NULL en la tabla viva: queda como texto.
    assert.match(persist, /studio_name: studioName\.toUpperCase\(\),/);
    const submit = extractFunction(js, 'submitForm');
    assert.doesNotMatch(submit, /studio_id: resolvedStudioId/);
    assert.match(submit, /estudios: resolvedStudioId \? null : estudiosValue,/);
    assert.match(submit, /if \(resolvedStudioId\) await requestRegistrationStudioMembership\(resolvedStudioId, estudiosValue\);/);
    // Las sedes y la dirección de un estudio con dueño no se tocan.
    assert.match(submit, /resolvedStudioId && studioHasOwner !== true && pickedAddress/);
});

function registrationHarness({ rpcResult, studioLocationId = null }) {
    const js = read('public/shared/js/register.js');
    const calls = { request: [], legacy: [], fetch: [] };
    const context = {
        console: { warn() {} },
        currentUser: { id: 'artist-1' },
        formState: { data: { studio_location_id: studioLocationId } },
        _supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } },
        appUrl: (p) => p,
        fetch: (url, init) => { calls.fetch.push({ url, init }); return Promise.resolve({ ok: true }); },
        WeotziData: {
            Artists: { updateByUserId: async (id, patch) => { calls.legacy.push({ id, patch }); return { error: null }; } },
            StudioMemberships: { requestMembership: async (args) => { calls.request.push(args); return rpcResult; } },
        },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(`${extractFunction(js, 'requestRegistrationStudioMembership')}\nthis.run = requestRegistrationStudioMembership;`, context);
    return { context, calls };
}

test('registro con sesión: pide el alta, avisa al dueño y sin la RPC vuelve al vínculo legacy', async () => {
    const owned = registrationHarness({ rpcResult: { data: { membership_id: 'mem-1', studio_has_owner: true }, error: null }, studioLocationId: 'loc-1' });
    assert.equal(JSON.stringify(await owned.context.run('studio-1', 'CLAROSCURO')), JSON.stringify({ pending: true, legacy: false }));
    assert.equal(JSON.stringify(owned.calls.request[0]), JSON.stringify({ studioId: 'studio-1', role: 'resident', locationId: 'loc-1' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(owned.calls.fetch.length, 1);
    assert.equal(owned.calls.fetch[0].url, '/api/artist/studio-notify');
    assert.deepEqual(JSON.parse(owned.calls.fetch[0].init.body), { kind: 'membership_request_created', membership_id: 'mem-1' });
    assert.equal(owned.calls.fetch[0].init.headers.Authorization, 'Bearer tok-1');
    assert.equal(owned.calls.legacy.length, 0);

    const unowned = registrationHarness({ rpcResult: { data: { membership_id: 'mem-2', studio_has_owner: false }, error: null } });
    assert.equal(JSON.stringify(await unowned.context.run('studio-2', 'NUEVO')), JSON.stringify({ pending: true, legacy: false }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unowned.calls.fetch.length, 0, 'sin dueño no se avisa a nadie');

    const missing = registrationHarness({ rpcResult: { data: null, error: { code: '42883', message: 'function does not exist' } } });
    assert.equal(JSON.stringify(await missing.context.run('studio-3', 'LEGACY')), JSON.stringify({ pending: false, legacy: true }));
    assert.equal(JSON.stringify(missing.calls.legacy[0]), JSON.stringify({ id: 'artist-1', patch: { studio_id: 'studio-3', estudios: 'LEGACY' } }));

    const open = registrationHarness({ rpcResult: { data: null, error: { code: '23514', message: 'Ya tenés una solicitud o vínculo abierto con este estudio' } } });
    assert.equal(JSON.stringify(await open.context.run('studio-4', 'X')), JSON.stringify({ pending: false, legacy: false }));
    assert.equal(open.calls.legacy.length, 0);
});

/* ------------------------------ dashboard del artista ------------------------------ */

test('dashboard: handleProfileSave solo envía studio_id para estudios sin dueño y pide el alta en uno con dueño', () => {
    const js = read('public/shared/js/dashboard.js');
    const save = extractFunction(js, 'handleProfileSave');
    // Sin comentarios: solo cuentan las claves del payload.
    const updateData = between(save, 'const updateData = {', '};').replace(/\/\/[^\r\n]*/g, '');
    assert.match(updateData, /\.\.\.\(studioOwnership\.hasOwner === true \? \{\} : \{ studio_id: resolvedStudioId \|\| null \}\)/);
    assert.match(save, /membershipOutcome === 'unavailable'[\s\S]*updateByUserId\(currentUser\.id, \{ studio_id: resolvedStudioId \}\)/);
    assert.match(save, /String\(resolvedStudioId\) !== String\(previousStudioId \|\| ''\)/);
    assert.match(save, /studioOwnership\.hasOwner === true;/);
    assert.match(save, /await dashboardRequestStudioMembership\(resolvedStudioId\)/);
    assert.match(save, /resolvedStudioId\s*&& studioOwnership\.hasOwner !== true\s*&& pickedAddress/);
    assert.match(save, /tu alta queda pendiente hasta que el estudio la apruebe/);
});

function dashboardHarness(rpcResult, studioRow) {
    const js = read('public/shared/js/dashboard.js');
    const calls = { request: [], fetch: [] };
    const context = {
        console: { warn() {} },
        _supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-2' } } }) } },
        fetch: async (url, init) => { calls.fetch.push({ url, init }); return { ok: true }; },
        WeotziData: {
            Studios: { getById: async () => ({ data: studioRow, error: null }) },
            StudioMemberships: { requestMembership: async (args) => { calls.request.push(args); return rpcResult; } },
        },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext([
        extractFunction(js, 'dashboardStudioOwnership'),
        extractFunction(js, 'dashboardRequestStudioMembership'),
        extractFunction(js, 'dashboardNotifyStudioRequest'),
        'this.ownership = dashboardStudioOwnership; this.request = dashboardRequestStudioMembership;',
    ].join('\n'), context);
    return { context, calls };
}

test('dashboard: request_studio_membership con aviso al dueño; 23514 y migración pendiente no rompen', async () => {
    const ok = dashboardHarness({ data: { membership_id: 'mem-9', studio_has_owner: true }, error: null }, { id: 's-9', name: 'Casa Aguja', user_id: 'owner-9' });
    assert.equal(JSON.stringify(await ok.context.ownership('s-9')), JSON.stringify({ hasOwner: true, name: 'Casa Aguja' }));
    assert.equal(await ok.context.request('s-9'), 'requested');
    assert.equal(JSON.stringify(ok.calls.request[0]), JSON.stringify({ studioId: 's-9', role: 'resident' }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ok.calls.fetch.length, 1);
    assert.equal(ok.calls.fetch[0].url, '/api/artist/studio-notify');
    assert.deepEqual(JSON.parse(ok.calls.fetch[0].init.body), { kind: 'membership_request_created', membership_id: 'mem-9' });

    const unowned = dashboardHarness(null, { id: 's-1', name: 'Catálogo', user_id: null });
    assert.equal((await unowned.context.ownership('s-1')).hasOwner, false);

    const open = dashboardHarness({ data: null, error: { code: '23514', message: 'Ya tenés una solicitud o vínculo abierto con este estudio' } }, null);
    assert.equal(await open.context.request('s-2'), 'open');
    const missing = dashboardHarness({ data: null, error: { code: 'PGRST202', message: 'not found' } }, null);
    assert.equal(await missing.context.request('s-3'), 'unavailable');
    assert.equal(missing.calls.fetch.length, 0);
    assert.equal(JSON.stringify(await missing.context.ownership(null)), JSON.stringify({ hasOwner: null, name: '' }));
});
