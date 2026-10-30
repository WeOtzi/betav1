'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const onboarding = require('../services/artist-onboarding');

const {
    computeSteps, mergeOnboardingPatch, isNewAccount, buildProfileUrl, DEFAULT_ONBOARDING,
    STEP_IDS, ACK_IDS, NEW_WINDOW_DAYS, createHandlers, loaders
} = onboarding._internal;

const NOW = new Date('2026-10-30T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const DAY = 24 * 60 * 60 * 1000;

// Artista con todos los pasos obligatorios completos.
function complete() {
    return {
        artist: {
            user_id: 'user-1', username: 'laura.wo', name: 'Laura', email: 'laura@example.test',
            instagram: '@laura.tattoo', profile_picture: 'https://cdn.example.test/p.jpg',
            whatsapp_number: '+54 9 11 1234 5678', bio_description: '<p>Tatuadora</p>', country: 'Argentina',
            work_type: 'independent', estudios: 'Sin estudio/Independiente', studio_id: null,
            verification_state: 'Requested', ms_profile_shared: true, preferred_display_currency: 'ARS',
            gallery_feed_items: [{ url: 'https://cdn.example.test/1.jpg', category: 'realizados', kind: 'image', created_at: '2026-10-01T00:00:00Z' }]
        },
        prefs: {
            notification_prefs: { mensajes: { email: true, push: true, sms: false } },
            app_settings: {
                timezone: 'America/Argentina/Buenos_Aires',
                profile: { banner_url: 'https://cdn.example.test/b.jpg', full_name: 'Laura Pérez' },
                availability: { weekly: [{ day: 'lunes', enabled: true, start: '10:00', end: '19:00' }] }
            }
        },
        payouts: { available: true, count: 1 },
        documents: [{ doc_type: 'identidad', status: 'pendiente' }, { doc_type: 'domicilio', status: 'pendiente' }],
        instagram: { available: true, status: 'verified', handle: 'laura.tattoo', pending_items: 0 }
    };
}
function stepOf(result, id) { return result.steps.find((s) => s.id === id); }
function checkOf(step, id) { return step.checks.find((c) => c.id === id); }
function statusOf(input, id) { return stepOf(computeSteps(input), id).status; }

function withEnv(vars, fn) {
    const previous = {};
    for (const key of Object.keys(vars)) {
        previous[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key]; else process.env[key] = vars[key];
    }
    const restore = () => {
        for (const key of Object.keys(vars)) {
            if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
        }
    };
    try {
        const out = fn();
        if (out && typeof out.then === 'function') return out.finally(restore);
        restore();
        return out;
    } catch (err) { restore(); throw err; }
}
const NO_APP_URL = { PUBLIC_APP_URL: undefined, APP_URL: undefined };

// ---------------------------------------------------------------------------
// Contrato §1
// ---------------------------------------------------------------------------

test('los pasos siguen el orden, los ids y los títulos del contrato', () => {
    assert.deepEqual([...STEP_IDS], ['perfil', 'portafolio', 'compartir', 'retiro', 'disponibilidad', 'notificaciones', 'verificacion', 'configuracion']);
    assert.deepEqual([...ACK_IDS], ['compartir.enlace', 'compartir.bio', 'compartir', 'notificaciones', 'configuracion']);
    assert.equal(NEW_WINDOW_DAYS, 14);
    const result = computeSteps({});
    assert.deepEqual(result.steps.map((s) => [s.id, s.title]), [
        ['perfil', 'Completá tu perfil'],
        ['portafolio', 'Validá tu Instagram y tu portafolio'],
        ['compartir', 'Compartí tu perfil en Instagram'],
        ['retiro', 'Configurá un medio de retiro'],
        ['disponibilidad', 'Configurá tu disponibilidad'],
        ['notificaciones', 'Configurá tus notificaciones'],
        ['verificacion', 'Completá la verificación'],
        ['configuracion', 'Completá la configuración']
    ]);
    const withInstagram = computeSteps({ instagram: { available: true, status: 'none' } });
    assert.deepEqual(withInstagram.steps.map((s) => s.checks.map((c) => c.id + (c.optional ? '?' : ''))), [
        ['banner', 'foto', 'redes', 'whatsapp', 'email', 'bio?'],
        ['trabajos', 'instagram_validado', 'portafolio_validado'],
        ['enlace_copiado?', 'bio_copiada?', 'pegado'],
        ['destino'],
        ['modalidad', 'estudio', 'horarios'],
        ['preferencias'],
        ['identidad', 'domicilio', 'bioseguridad?', 'solicitud'],
        ['region', 'moneda', 'revisada?']
    ]);
    // Sin la validación de Instagram disponible sus dos checks pasan a opcionales.
    assert.deepEqual(stepOf(result, 'portafolio').checks.map((c) => c.id + (c.optional ? '?' : '')),
        ['trabajos', 'instagram_validado?', 'portafolio_validado?']);
    assert.equal(checkOf(result.steps[0], 'banner').label, 'Banner de perfil');
    for (const step of result.steps) {
        for (const c of step.checks) {
            assert.equal(typeof c.label, 'string');
            assert.doesNotMatch(c.label + step.title, /[!¡]/);
        }
    }
});

test('sin datos todo queda pending y el paso actual es perfil', () => {
    const result = computeSteps({});
    assert.ok(result.steps.every((s) => s.status === 'pending'));
    assert.equal(result.current_step, 'perfil');
    assert.equal(result.completed, false);
    assert.deepEqual(result.progress, { done: 0, total: 8 });
});

test('un artista completo termina todos los pasos', () => {
    const result = computeSteps(complete());
    assert.deepEqual(result.steps.map((s) => s.status), Array(8).fill('done'));
    assert.equal(result.current_step, null);
    assert.equal(result.completed, true);
    assert.deepEqual(result.progress, { done: 8, total: 8 });
});

test('perfil: los obligatorios completan el paso y la bio es opcional', () => {
    const input = complete();
    input.artist.bio_description = '<p> </p>';
    const perfil = stepOf(computeSteps(input), 'perfil');
    assert.equal(perfil.status, 'done');
    assert.equal(checkOf(perfil, 'bio').done, false);

    const noBanner = complete();
    delete noBanner.prefs.app_settings.profile.banner_url;
    assert.equal(statusOf(noBanner, 'perfil'), 'pending');

    const shortPhone = complete();
    shortPhone.artist.whatsapp_number = '123';
    assert.equal(checkOf(stepOf(computeSteps(shortPhone), 'perfil'), 'whatsapp').done, false);

    const badEmail = complete();
    badEmail.artist.email = 'laura';
    assert.equal(statusOf(badEmail, 'perfil'), 'pending');
});

test('perfil: redes acepta Instagram, TikTok o sitio web', () => {
    const none = complete();
    none.artist.instagram = '@';
    none.artist.portafolio = '';
    assert.equal(checkOf(stepOf(computeSteps(none), 'perfil'), 'redes').done, false);

    const tiktok = complete();
    tiktok.artist.instagram = null;
    tiktok.prefs.app_settings.profile.tiktok = '@laura.tt';
    assert.equal(checkOf(stepOf(computeSteps(tiktok), 'perfil'), 'redes').done, true);

    const web = complete();
    web.artist.instagram = null;
    web.artist.portafolio = 'https://laura.example.test';
    assert.equal(checkOf(stepOf(computeSteps(web), 'perfil'), 'redes').done, true);

    const links = complete();
    links.artist.instagram = null;
    links.artist.profile_links = { website: 'https://laura.example.test' };
    assert.equal(checkOf(stepOf(computeSteps(links), 'perfil'), 'redes').done, true);
});

test('portafolio: trabajos, Instagram validado y sin fotos pendientes', () => {
    assert.equal(statusOf(complete(), 'portafolio'), 'done');

    const legacy = complete();
    legacy.artist.gallery_feed_items = [];
    legacy.artist.gallery_images = ['https://cdn.example.test/old.jpg'];
    assert.equal(statusOf(legacy, 'portafolio'), 'done');

    const noWorks = complete();
    noWorks.artist.gallery_feed_items = [];
    assert.equal(checkOf(stepOf(computeSteps(noWorks), 'portafolio'), 'trabajos').done, false);

    const pendingPhotos = complete();
    pendingPhotos.instagram.pending_items = 3;
    const step = stepOf(computeSteps(pendingPhotos), 'portafolio');
    assert.equal(step.status, 'pending');
    assert.equal(checkOf(step, 'instagram_validado').done, true);
    assert.equal(checkOf(step, 'portafolio_validado').done, false);

    const notVerified = complete();
    notVerified.instagram.status = 'pending';
    assert.equal(checkOf(stepOf(computeSteps(notVerified), 'portafolio'), 'instagram_validado').done, false);
});

test('portafolio: sin la validación de Instagram se completa con un trabajo y nunca queda unavailable', () => {
    for (const instagram of [undefined, null, { available: false, status: 'none' }]) {
        const input = complete();
        input.instagram = instagram;
        const step = stepOf(computeSteps(input), 'portafolio');
        assert.equal(step.status, 'done', 'el paso no pide algo imposible');
        assert.equal(checkOf(step, 'trabajos').optional, false);
        for (const id of ['instagram_validado', 'portafolio_validado']) {
            assert.equal(checkOf(step, id).done, false, id);
            assert.equal(checkOf(step, id).optional, true, id);
        }
        assert.equal(checkOf(step, 'instagram_validado').label, 'Instagram validado (se habilita pronto)');
        assert.equal(checkOf(step, 'portafolio_validado').label, 'Fotos de Instagram validadas (se habilita pronto)');

        // El trabajo sigue haciendo falta: sin trabajos el paso queda pending (no unavailable).
        input.artist.gallery_feed_items = [];
        assert.equal(statusOf(input, 'portafolio'), 'pending');
    }

    // Con la validación disponible los checks vuelven a ser obligatorios y sin la nota.
    const ready = stepOf(computeSteps(complete()), 'portafolio');
    assert.equal(checkOf(ready, 'instagram_validado').label, 'Instagram validado');
    assert.equal(checkOf(ready, 'instagram_validado').optional, false);
    assert.equal(checkOf(ready, 'portafolio_validado').label, 'Fotos de Instagram validadas');
    assert.equal(checkOf(ready, 'portafolio_validado').optional, false);
});

test('compartir: ack o ms_profile_shared; los checks opcionales no bloquean', () => {
    assert.equal(statusOf(complete(), 'compartir'), 'done');

    const fresh = complete();
    fresh.artist.ms_profile_shared = false;
    assert.equal(statusOf(fresh, 'compartir'), 'pending');

    fresh.onboarding = { assisted: { acknowledged: { 'compartir.enlace': NOW_ISO, 'compartir.bio': NOW_ISO } } };
    let step = stepOf(computeSteps(fresh), 'compartir');
    assert.equal(step.status, 'pending');
    assert.equal(checkOf(step, 'enlace_copiado').done, true);
    assert.equal(checkOf(step, 'bio_copiada').done, true);

    fresh.onboarding = { assisted: { acknowledged: { compartir: NOW_ISO } } };
    step = stepOf(computeSteps(fresh), 'compartir');
    assert.equal(step.status, 'done');
    assert.equal(checkOf(step, 'enlace_copiado').done, false);
});

test('retiro: unavailable sin tabla, pending sin destinos, done con uno, skipped', () => {
    const input = complete();
    input.payouts = { available: false, count: 0 };
    let result = computeSteps(input);
    assert.equal(stepOf(result, 'retiro').status, 'unavailable');
    assert.equal(result.completed, true, 'unavailable no bloquea el final');

    input.payouts = { available: true, count: 0 };
    result = computeSteps(input);
    assert.equal(stepOf(result, 'retiro').status, 'pending');
    assert.equal(result.current_step, 'retiro');

    input.prefs.app_settings.onboarding = { assisted: { skipped: { retiro: NOW_ISO } } };
    result = computeSteps(input);
    assert.equal(stepOf(result, 'retiro').status, 'skipped');
    assert.equal(result.current_step, null);
    assert.equal(result.completed, true);

    input.payouts = { available: true, count: 2 };
    assert.equal(statusOf(input, 'retiro'), 'done', 'done gana sobre skipped');
});

test('disponibilidad: independiente satisface estudio automáticamente', () => {
    const input = complete();
    input.artist.estudios = null;
    const step = stepOf(computeSteps(input), 'disponibilidad');
    assert.equal(step.status, 'done');
    assert.equal(checkOf(step, 'estudio').done, true);

    const unknown = complete();
    unknown.artist.work_type = null;
    const pending = stepOf(computeSteps(unknown), 'disponibilidad');
    assert.equal(pending.status, 'pending');
    assert.equal(checkOf(pending, 'modalidad').done, false);
    assert.equal(checkOf(pending, 'estudio').done, false);
});

test('disponibilidad: estudio o ambos exigen un estudio; horarios por ubicación', () => {
    const studio = complete();
    studio.artist.work_type = 'studio';
    assert.equal(checkOf(stepOf(computeSteps(studio), 'disponibilidad'), 'estudio').done, false, 'Sin estudio/Independiente no cuenta');

    studio.artist.estudios = 'TINTA NEGRA';
    assert.equal(statusOf(studio, 'disponibilidad'), 'done');

    const both = complete();
    both.artist.work_type = 'Both';
    both.artist.estudios = '';
    both.artist.studio_id = '6c0d6d2e-2f3a-4bb0-8f0b-6f8e7c2a1d10';
    assert.equal(statusOf(both, 'disponibilidad'), 'done');

    const hours = complete();
    hours.prefs.app_settings.availability = { weekly: [{ day: 'lunes', enabled: false }] };
    assert.equal(checkOf(stepOf(computeSteps(hours), 'disponibilidad'), 'horarios').done, false);

    hours.prefs.app_settings.availability.locations = { 'loc-1': { weekly: { martes: { enabled: true, start: '10:00', end: '18:00' } } } };
    assert.equal(checkOf(stepOf(computeSteps(hours), 'disponibilidad'), 'horarios').done, true);
});

test('notificaciones: preferencias guardadas o ack', () => {
    const input = complete();
    input.prefs.notification_prefs = {};
    assert.equal(statusOf(input, 'notificaciones'), 'pending');
    input.onboarding = { assisted: { acknowledged: { notificaciones: NOW_ISO } } };
    assert.equal(statusOf(input, 'notificaciones'), 'done');
    assert.equal(statusOf(complete(), 'notificaciones'), 'done');
});

test('verificación: un documento rechazado no cuenta y bioseguridad es opcional', () => {
    const input = complete();
    let step = stepOf(computeSteps(input), 'verificacion');
    assert.equal(step.status, 'done');
    assert.equal(checkOf(step, 'bioseguridad').done, false);

    input.documents = [{ doc_type: 'identidad', status: 'rechazado' }, { doc_type: 'domicilio', status: 'verificado' }];
    step = stepOf(computeSteps(input), 'verificacion');
    assert.equal(step.status, 'pending');
    assert.equal(checkOf(step, 'identidad').done, false);
    assert.equal(checkOf(step, 'domicilio').done, true);

    input.documents.push({ doc_type: 'bioseguridad', status: 'pendiente' });
    assert.equal(checkOf(stepOf(computeSteps(input), 'verificacion'), 'bioseguridad').done, true);

    const noRequest = complete();
    noRequest.artist.verification_state = 'No';
    assert.equal(checkOf(stepOf(computeSteps(noRequest), 'verificacion'), 'solicitud').done, false);
    noRequest.artist.verification_state = 'Denied';
    assert.equal(statusOf(noRequest, 'verificacion'), 'pending');
});

test('verificación: identidad verificada vale como solicitud; tabla ausente queda unavailable', () => {
    const verifiedDoc = complete();
    verifiedDoc.artist.verification_state = 'No';
    verifiedDoc.documents = [{ doc_type: 'identidad', status: 'verificado' }, { doc_type: 'domicilio', status: 'pendiente' }];
    assert.equal(statusOf(verifiedDoc, 'verificacion'), 'done');

    for (const state of ['Requested', 'In Progress', 'In Analysis']) {
        const input = complete();
        input.artist.verification_state = state;
        assert.equal(statusOf(input, 'verificacion'), 'done', state);
    }

    const accountVerified = complete();
    accountVerified.artist.verification_state = 'Yes';
    accountVerified.documents = [];
    assert.equal(statusOf(accountVerified, 'verificacion'), 'done');

    const noTable = complete();
    noTable.documents = null;
    assert.equal(statusOf(noTable, 'verificacion'), 'unavailable');
});

test('configuración: región y moneda, o el atajo del ack', () => {
    assert.equal(statusOf(complete(), 'configuracion'), 'done', 'país de artists_db + timezone de app_settings');

    const appCountry = complete();
    appCountry.artist.country = null;
    appCountry.prefs.app_settings.country = 'Argentina';
    assert.equal(statusOf(appCountry, 'configuracion'), 'done');

    const noTimezone = complete();
    delete noTimezone.prefs.app_settings.timezone;
    assert.equal(checkOf(stepOf(computeSteps(noTimezone), 'configuracion'), 'region').done, false);
    assert.equal(statusOf(noTimezone, 'configuracion'), 'pending');

    const noCurrency = complete();
    noCurrency.artist.preferred_display_currency = undefined;
    assert.equal(statusOf(noCurrency, 'configuracion'), 'pending');

    noCurrency.onboarding = { assisted: { acknowledged: { configuracion: NOW_ISO } } };
    const step = stepOf(computeSteps(noCurrency), 'configuracion');
    assert.equal(step.status, 'done');
    assert.equal(checkOf(step, 'moneda').done, false);
    assert.equal(checkOf(step, 'revisada').done, true);
});

test('estado: current_step saltea skipped y unavailable; progress cuenta solo los done', () => {
    const input = complete();
    input.artist.profile_picture = null;
    input.payouts = { available: false, count: 0 };
    input.artist.preferred_display_currency = null;
    input.onboarding = { assisted: { skipped: { perfil: NOW_ISO, configuracion: NOW_ISO, inventado: NOW_ISO } } };
    const result = computeSteps(input);
    assert.equal(stepOf(result, 'perfil').status, 'skipped');
    assert.equal(stepOf(result, 'retiro').status, 'unavailable');
    assert.equal(stepOf(result, 'configuracion').status, 'skipped');
    assert.equal(result.current_step, null);
    assert.equal(result.completed, true);
    assert.deepEqual(result.progress, { done: 5, total: 8 });

    delete input.onboarding.assisted.skipped.perfil;
    const pending = computeSteps(input);
    assert.equal(pending.current_step, 'perfil');
    assert.equal(pending.completed, false);
});

// ---------------------------------------------------------------------------
// Contrato §2 · mergeOnboardingPatch
// ---------------------------------------------------------------------------

test('DEFAULT_ONBOARDING tiene la forma del contrato y no se puede mutar', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_ONBOARDING)), {
        demo_suggestions: true, demo_auto_started_at: null,
        assisted: { active: false, started_at: null, completed_at: null, welcome_seen_at: null, acknowledged: {}, skipped: {} }
    });
    assert.ok(Object.isFrozen(DEFAULT_ONBOARDING));
    assert.ok(Object.isFrozen(DEFAULT_ONBOARDING.assisted.skipped));
});

test('merge: solo acepta las claves del contrato', () => {
    const result = mergeOnboardingPatch({}, {
        hack: true, completed: true, demo_auto_started_at: '2020-01-01T00:00:00Z',
        assisted: { completed_at: '2020-01-01T00:00:00Z', started_at: '2020-01-01T00:00:00Z', acknowledged: { compartir: 'x' }, foo: 1 }
    }, NOW_ISO);
    assert.equal(result.ok, true);
    assert.deepEqual(result.onboarding, JSON.parse(JSON.stringify(DEFAULT_ONBOARDING)));
    assert.equal('hack' in result.app_settings, false);
    assert.equal('hack' in result.app_settings.onboarding, false);
    assert.equal('foo' in result.app_settings.onboarding.assisted, false);
    assert.equal(result.effects.profileShared, false);
});

test('merge: valida tipos y ids', () => {
    const bad = [
        'texto', [1],
        { demo_suggestions: 'no' }, { demo_auto_started: 1 },
        { assisted: true }, { assisted: { active: 'yes' } }, { assisted: { acknowledge: 'retiro' } },
        { assisted: { acknowledge: 'compartir.otro' } }, { assisted: { skip: 'pagos' } },
        { assisted: { unskip: 'x' } }, { assisted: { welcome_seen: 'si' } }
    ];
    for (const body of bad) {
        const result = mergeOnboardingPatch({}, body, NOW_ISO);
        assert.equal(result.ok, false, JSON.stringify(body));
        assert.equal(typeof result.error, 'string');
        assert.doesNotMatch(result.error, /[!¡]/);
    }
    assert.equal(mergeOnboardingPatch({}, undefined, NOW_ISO).ok, true);
    assert.equal(mergeOnboardingPatch({}, { assisted: { skip: null } }, NOW_ISO).ok, true);
});

test('merge: active setea started_at una sola vez y active:false conserva el resto', () => {
    const first = mergeOnboardingPatch({}, { assisted: { active: true } }, NOW_ISO);
    assert.equal(first.onboarding.assisted.active, true);
    assert.equal(first.onboarding.assisted.started_at, NOW_ISO);

    const later = '2026-11-02T09:00:00.000Z';
    const again = mergeOnboardingPatch(first.app_settings, { assisted: { active: true, acknowledge: 'compartir.bio', skip: 'retiro' } }, later);
    assert.equal(again.onboarding.assisted.started_at, NOW_ISO);
    assert.equal(again.onboarding.assisted.acknowledged['compartir.bio'], later);
    assert.equal(again.onboarding.assisted.skipped.retiro, later);

    const off = mergeOnboardingPatch(again.app_settings, { assisted: { active: false } }, '2026-11-03T00:00:00.000Z');
    assert.equal(off.onboarding.assisted.active, false);
    assert.equal(off.onboarding.assisted.started_at, NOW_ISO);
    assert.deepEqual(off.onboarding.assisted.acknowledged, { 'compartir.bio': later });
    assert.deepEqual(off.onboarding.assisted.skipped, { retiro: later });
});

test('merge: acknowledge compartir, skip/unskip, welcome_seen y flags del demo', () => {
    const ack = mergeOnboardingPatch({}, { assisted: { acknowledge: 'compartir' } }, NOW_ISO);
    assert.equal(ack.effects.profileShared, true);
    assert.equal(ack.onboarding.assisted.acknowledged.compartir, NOW_ISO);
    const ackAgain = mergeOnboardingPatch(ack.app_settings, { assisted: { acknowledge: 'compartir' } }, '2027-01-01T00:00:00.000Z');
    assert.equal(ackAgain.onboarding.assisted.acknowledged.compartir, NOW_ISO, 'conserva el primer timestamp');

    const skipped = mergeOnboardingPatch({}, { assisted: { skip: 'verificacion' } }, NOW_ISO);
    assert.deepEqual(skipped.onboarding.assisted.skipped, { verificacion: NOW_ISO });
    const unskipped = mergeOnboardingPatch(skipped.app_settings, { assisted: { unskip: 'verificacion' } }, NOW_ISO);
    assert.deepEqual(unskipped.onboarding.assisted.skipped, {});

    const welcome = mergeOnboardingPatch({}, { assisted: { welcome_seen: true } }, NOW_ISO);
    assert.equal(welcome.onboarding.assisted.welcome_seen_at, NOW_ISO);

    const demo = mergeOnboardingPatch({}, { demo_suggestions: false, demo_auto_started: true }, NOW_ISO);
    assert.equal(demo.onboarding.demo_suggestions, false);
    assert.equal(demo.onboarding.demo_auto_started_at, NOW_ISO);
    const demoAgain = mergeOnboardingPatch(demo.app_settings, { demo_auto_started: true, demo_suggestions: true }, '2027-01-01T00:00:00.000Z');
    assert.equal(demoAgain.onboarding.demo_auto_started_at, NOW_ISO);
    assert.equal(demoAgain.onboarding.demo_suggestions, true);
});

test('merge: conserva las demás claves de app_settings y no muta la entrada', () => {
    const current = {
        profile: { full_name: 'Laura Pérez', banner_url: 'https://cdn.example.test/b.jpg', tiktok: '@laura' },
        availability: { weekly: [{ day: 'lunes', enabled: true }], locations: { base: { weekly: [] } } },
        reminders: [{ id: 'r1', text: 'Llamar al estudio' }],
        recovery: { phone: '+5491100000000' },
        timezone: 'America/Argentina/Buenos_Aires',
        onboarding: {
            demo_suggestions: true, futuro: { x: 1 },
            assisted: { active: true, started_at: NOW_ISO, acknowledged: { notificaciones: NOW_ISO }, skipped: {}, nota: 'ok' }
        }
    };
    const snapshot = JSON.parse(JSON.stringify(current));
    const result = mergeOnboardingPatch(current, { assisted: { skip: 'retiro' } }, '2026-11-01T00:00:00.000Z');
    assert.equal(result.ok, true);
    assert.deepEqual(current, snapshot, 'la entrada no cambia');
    for (const key of ['profile', 'availability', 'reminders', 'recovery', 'timezone']) {
        assert.deepEqual(result.app_settings[key], snapshot[key], key);
    }
    assert.deepEqual(result.app_settings.onboarding.futuro, { x: 1 });
    assert.equal(result.app_settings.onboarding.assisted.nota, 'ok');
    assert.equal(result.app_settings.onboarding.assisted.started_at, NOW_ISO);
    assert.deepEqual(result.app_settings.onboarding.assisted.acknowledged, { notificaciones: NOW_ISO });
    assert.deepEqual(result.app_settings.onboarding.assisted.skipped, { retiro: '2026-11-01T00:00:00.000Z' });
});

// ---------------------------------------------------------------------------
// is_new y profile_url
// ---------------------------------------------------------------------------

test('isNewAccount: ventana de 14 días inclusive', () => {
    const at = (ms) => new Date(NOW.getTime() - ms).toISOString();
    assert.equal(isNewAccount(at(0), NOW), true);
    assert.equal(isNewAccount(at(14 * DAY), NOW), true);
    assert.equal(isNewAccount(at(14 * DAY + 1), NOW), false);
    assert.equal(isNewAccount(at(30 * DAY), NOW), false);
    assert.equal(isNewAccount(new Date(NOW.getTime() + DAY).toISOString(), NOW), true, 'reloj adelantado');
    assert.equal(isNewAccount(null, NOW), false);
    assert.equal(isNewAccount('no es fecha', NOW), false);
    assert.equal(isNewAccount(new Date(NOW.getTime() - DAY), NOW.getTime()), true);
});

test('buildProfileUrl: saca el sufijo .wo y respeta la base /beta', () => withEnv(NO_APP_URL, () => {
    assert.equal(buildProfileUrl('laura.wo', 'https://beta.weotzi.com'), 'https://beta.weotzi.com/artist/profile?artist=laura');
    assert.equal(buildProfileUrl('lau.marth.WO', 'https://weotzi.com/beta/'), 'https://weotzi.com/beta/artist/profile?artist=lau.marth');
    assert.equal(buildProfileUrl('laura', 'https://weotzi.com/beta'), 'https://weotzi.com/beta/artist/profile?artist=laura');
    assert.equal(buildProfileUrl('', 'https://weotzi.com'), null);
    assert.equal(buildProfileUrl(null, 'https://weotzi.com'), null);
    assert.equal(buildProfileUrl('laura.wo', { headers: { host: 'localhost:3000' }, weotziBasePath: '/beta' }),
        'http://localhost:3000/beta/artist/profile?artist=laura');
    assert.equal(buildProfileUrl('laura.wo', { headers: { host: 'localhost:3000' } }),
        'http://localhost:3000/artist/profile?artist=laura');
    assert.equal(buildProfileUrl('laura.wo', { headers: { host: 'evil.example' }, weotziBasePath: '/beta' }),
        'https://weotzi.com/beta/artist/profile?artist=laura', 'el Host de la request no es confiable');
    withEnv({ PUBLIC_APP_URL: 'https://beta.weotzi.com/' }, () => {
        assert.equal(buildProfileUrl('laura.wo', { headers: { host: 'localhost:3000' }, weotziBasePath: '/beta' }),
            'https://beta.weotzi.com/artist/profile?artist=laura');
    });
}));

// ---------------------------------------------------------------------------
// Contrato §3 · handlers con dependencias falsas
// ---------------------------------------------------------------------------

function response() {
    return { code: 200, body: null, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
}
function request(body) {
    return { headers: { host: 'localhost:3000', authorization: 'Bearer token' }, weotziBasePath: '/beta', body };
}
function fakeDeps(overrides = {}) {
    const fixture = complete();
    const calls = { saved: [], shared: [], instagramCtx: null };
    const deps = {
        resolveUser: async () => ({ id: 'user-1', email: 'laura@example.test', raw: { id: 'user-1', created_at: '2026-10-25T10:00:00.000Z' } }),
        loadArtist: async () => fixture.artist,
        loadPrefs: async () => ({ user_id: 'user-1', ...fixture.prefs }),
        loadPayouts: async () => fixture.payouts,
        loadDocuments: async () => fixture.documents,
        loadInstagram: async (ctx) => { calls.instagramCtx = ctx; return fixture.instagram; },
        savePrefs: async (userId, appSettings) => { calls.saved.push({ userId, appSettings }); },
        markProfileShared: async (userId) => { calls.shared.push(userId); },
        now: () => NOW,
        ...overrides
    };
    return { deps, calls, fixture };
}

test('handlers: 401 sin sesión y 403 sin perfil de artista', async () => {
    const res = response();
    await onboarding.getOnboarding({ headers: {} }, res);
    assert.equal(res.code, 401);
    assert.deepEqual(res.body, { success: false, error: 'Authentication required' });

    const post = response();
    await onboarding.patchOnboarding({ headers: {}, body: 'basura' }, post);
    assert.equal(post.code, 401, '401 antes que la validación del body');

    const { deps } = fakeDeps({ loadArtist: async () => null });
    const handlers = createHandlers(deps);
    for (const handler of [handlers.getOnboarding, handlers.patchOnboarding]) {
        const r = response();
        await handler(request({}), r);
        assert.equal(r.code, 403);
        assert.deepEqual(r.body, { success: false, error: 'Artist profile required' });
    }
});

test('GET: responde la forma del contrato', () => withEnv(NO_APP_URL, async () => {
    const { deps, calls } = fakeDeps();
    const res = response();
    await createHandlers(deps).getOnboarding(request(), res);
    assert.equal(res.code, 200);
    const body = res.body;
    assert.deepEqual(Object.keys(body).sort(), ['account_created_at', 'artist_name', 'completed', 'current_step', 'instagram',
        'is_new', 'new_window_days', 'onboarding', 'profile_url', 'progress', 'steps', 'success', 'user_id', 'username'].sort());
    assert.equal(body.success, true);
    assert.equal(body.user_id, 'user-1');
    assert.equal(body.username, 'laura.wo');
    assert.equal(body.artist_name, 'Laura');
    assert.equal(body.is_new, true);
    assert.equal(body.account_created_at, '2026-10-25T10:00:00.000Z');
    assert.equal(body.new_window_days, 14);
    assert.equal(body.profile_url, 'http://localhost:3000/beta/artist/profile?artist=laura');
    assert.deepEqual(body.onboarding, JSON.parse(JSON.stringify(DEFAULT_ONBOARDING)));
    assert.equal(body.steps.length, 8);
    assert.equal(body.completed, true);
    assert.deepEqual(Object.keys(body.instagram).sort(), ['available', 'email_masked', 'enforced', 'expires_at', 'handle', 'legacy_items',
        'pending_items', 'status', 'verified', 'verified_at', 'verified_handle'].sort());
    assert.equal(calls.instagramCtx.userId, 'user-1');
    assert.equal(calls.instagramCtx.authUser.id, 'user-1');
    assert.equal(calls.instagramCtx.artist.username, 'laura.wo');
    assert.equal(calls.saved.length, 0, 'sin modo asistido iniciado el GET no escribe');
}));

test('GET: si fallan las preferencias responde 503 y no inventa el estado', async () => {
    const { deps, calls } = fakeDeps({ loadPrefs: async () => { throw new Error('timeout'); } });
    const res = response();
    await createHandlers(deps).getOnboarding(request(), res);
    assert.equal(res.code, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'ONBOARDING_PREFS_UNAVAILABLE');
    assert.equal(res.body.onboarding, undefined, 'sin defaults que apaguen el modo asistido');
    assert.equal(calls.saved.length, 0);
});

test('GET: degrada si fallan Instagram, pagos o documentos', async () => {
    const { deps, calls } = fakeDeps({
        loadInstagram: async () => { throw new Error('modulo roto'); },
        loadPayouts: async () => { throw new Error('timeout'); },
        loadDocuments: async () => { throw new Error('timeout'); }
    });
    const res = response();
    await createHandlers(deps).getOnboarding(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.instagram.available, false);
    assert.equal(res.body.instagram.status, 'none');
    assert.equal(res.body.instagram.handle, 'laura.tattoo');
    const portafolio = res.body.steps.find((s) => s.id === 'portafolio');
    assert.equal(portafolio.status, 'done', 'sin Instagram el paso se completa con los trabajos');
    assert.ok(portafolio.checks.filter((c) => c.id !== 'trabajos').every((c) => c.optional && !c.done));
    assert.equal(res.body.steps.find((s) => s.id === 'retiro').status, 'pending');
    assert.equal(calls.saved.length, 0);
});

test('GET: registra completed_at cuando el modo asistido ya había empezado', async () => {
    const { deps, calls, fixture } = fakeDeps();
    fixture.prefs.app_settings.onboarding = { assisted: { active: true, started_at: '2026-10-29T00:00:00.000Z' } };
    const res = response();
    await createHandlers(deps).getOnboarding(request(), res);
    assert.equal(res.body.onboarding.assisted.completed_at, NOW_ISO);
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.saved[0].appSettings.profile.full_name, 'Laura Pérez');
    assert.equal(calls.saved[0].appSettings.onboarding.assisted.completed_at, NOW_ISO);

    const again = response();
    await createHandlers({ ...deps, loadPrefs: async () => ({ app_settings: calls.saved[0].appSettings }) }).getOnboarding(request(), again);
    assert.equal(calls.saved.length, 1, 'no vuelve a escribir');
});

test('POST: escribe app_settings entero, marca ms_profile_shared y setea completed_at', async () => {
    const { deps, calls, fixture } = fakeDeps();
    fixture.artist.ms_profile_shared = false;
    fixture.prefs.app_settings.reminders = [{ id: 'r1' }];
    fixture.prefs.app_settings.recovery = { phone: '+5491100000000' };
    const res = response();
    await createHandlers(deps).patchOnboarding(request({ assisted: { active: true, acknowledge: 'compartir' }, user_id: 'otro' }), res);
    assert.equal(res.code, 200);
    assert.deepEqual(calls.shared, ['user-1']);
    assert.equal(calls.saved.length, 1);
    const saved = calls.saved[0];
    assert.equal(saved.userId, 'user-1');
    assert.deepEqual(saved.appSettings.profile, fixture.prefs.app_settings.profile);
    assert.deepEqual(saved.appSettings.availability, fixture.prefs.app_settings.availability);
    assert.deepEqual(saved.appSettings.reminders, [{ id: 'r1' }]);
    assert.deepEqual(saved.appSettings.recovery, { phone: '+5491100000000' });
    assert.equal(saved.appSettings.timezone, 'America/Argentina/Buenos_Aires');
    assert.equal(saved.appSettings.onboarding.assisted.active, true);
    assert.equal(saved.appSettings.onboarding.assisted.started_at, NOW_ISO);
    assert.equal(saved.appSettings.onboarding.assisted.completed_at, NOW_ISO);
    assert.equal(res.body.completed, true);
    assert.equal(res.body.onboarding.assisted.completed_at, NOW_ISO);
    assert.equal(res.body.steps.find((s) => s.id === 'compartir').status, 'done');
});

test('POST: no pisa completed_at ni escribe si no hay cambios', async () => {
    const { deps, calls, fixture } = fakeDeps();
    fixture.prefs.app_settings.onboarding = JSON.parse(JSON.stringify({
        ...DEFAULT_ONBOARDING, assisted: { ...DEFAULT_ONBOARDING.assisted, active: true, started_at: '2026-10-01T00:00:00.000Z', completed_at: '2026-10-02T00:00:00.000Z' }
    }));
    const res = response();
    await createHandlers(deps).patchOnboarding(request({ assisted: { active: true } }), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.onboarding.assisted.completed_at, '2026-10-02T00:00:00.000Z');
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.shared.length, 0);
});

test('POST: 400 con body inválido y 500 sin escribir si no pudo leer las preferencias', async () => {
    const invalid = fakeDeps();
    const bad = response();
    await createHandlers(invalid.deps).patchOnboarding(request({ assisted: { skip: 'nada' } }), bad);
    assert.equal(bad.code, 400);
    assert.equal(bad.body.success, false);
    assert.equal(invalid.calls.saved.length, 0);

    const broken = fakeDeps({ loadPrefs: async () => { throw new Error('timeout'); } });
    const res = response();
    await createHandlers(broken.deps).patchOnboarding(request({ demo_suggestions: false }), res);
    assert.equal(res.code, 500);
    assert.equal(res.body.success, false);
    assert.equal(broken.calls.saved.length, 0, 'nunca escribe app_settings sin el actual');
});

// user_preferences en memoria con lecturas y escrituras asíncronas (un viaje a
// la base cada una), así las requests que se cruzan se intercalan como en producción.
function prefsStore(initial) {
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const store = {
        row: copy(initial),
        reads: 0,
        loadPrefs: async () => { store.reads += 1; await tick(); return copy(store.row); },
        savePrefs: async (userId, appSettings) => { await tick(); store.row = { ...store.row, app_settings: copy(appSettings) }; }
    };
    return store;
}

test('POST: dos requests que se cruzan conservan los dos cambios (cola por usuario)', async () => {
    const { deps, fixture } = fakeDeps();
    fixture.payouts = { available: true, count: 0 };
    fixture.documents = [];
    const store = prefsStore({ user_id: 'user-1', ...fixture.prefs });
    const handlers = createHandlers({ ...deps, loadPrefs: store.loadPrefs, savePrefs: store.savePrefs });
    const first = response();
    const second = response();
    await Promise.all([
        handlers.patchOnboarding(request({ assisted: { skip: 'retiro' } }), first),
        handlers.patchOnboarding(request({ assisted: { skip: 'verificacion' } }), second)
    ]);
    assert.equal(first.code, 200);
    assert.equal(second.code, 200);
    assert.deepEqual(Object.keys(store.row.app_settings.onboarding.assisted.skipped).sort(), ['retiro', 'verificacion'], 'el segundo upsert no pisa el primero');
    assert.deepEqual(Object.keys(second.body.onboarding.assisted.skipped).sort(), ['retiro', 'verificacion'], 'el segundo POST leyó lo que guardó el primero');
    assert.equal(second.body.steps.find((s) => s.id === 'retiro').status, 'skipped');
    assert.equal(second.body.steps.find((s) => s.id === 'verificacion').status, 'skipped');
    assert.equal(store.row.app_settings.profile.full_name, 'Laura Pérez', 'el resto de app_settings sigue intacto');
});

test('POST: un error no traba la cola y cada usuario tiene la suya', async () => {
    const { deps, fixture } = fakeDeps({
        resolveUser: async (req) => {
            const id = req.headers['x-user'] || 'user-1';
            return { id, email: `${id}@example.test`, raw: { id, created_at: '2026-10-25T10:00:00.000Z' } };
        }
    });
    const stores = { 'user-1': prefsStore({ user_id: 'user-1', ...fixture.prefs }), 'user-2': prefsStore({ user_id: 'user-2', ...fixture.prefs }) };
    let failNext = true;
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    let holdUser1 = false;
    const handlers = createHandlers({
        ...deps,
        loadPrefs: async (userId) => {
            if (userId === 'user-1' && failNext) { failNext = false; throw new Error('timeout'); }
            if (userId === 'user-1' && holdUser1) await gate;
            return stores[userId].loadPrefs();
        },
        savePrefs: async (userId, appSettings) => stores[userId].savePrefs(userId, appSettings)
    });
    const as = (user, body) => ({ ...request(body), headers: { ...request(body).headers, 'x-user': user } });

    const failed = response();
    const after = response();
    await Promise.all([
        handlers.patchOnboarding(as('user-1', { assisted: { skip: 'retiro' } }), failed),
        handlers.patchOnboarding(as('user-1', { assisted: { skip: 'verificacion' } }), after)
    ]);
    assert.equal(failed.code, 500);
    assert.equal(after.code, 200, 'la request siguiente corre aunque la anterior falló');
    assert.deepEqual(Object.keys(stores['user-1'].row.app_settings.onboarding.assisted.skipped), ['verificacion']);

    // Una request de user-1 trabada no demora a user-2.
    holdUser1 = true;
    const slow = response();
    const slowDone = handlers.patchOnboarding(as('user-1', { assisted: { skip: 'perfil' } }), slow);
    const other = response();
    await handlers.patchOnboarding(as('user-2', { assisted: { skip: 'retiro' } }), other);
    assert.equal(other.code, 200);
    assert.equal(slow.body, null, 'user-1 sigue esperando');
    release();
    await slowDone;
    assert.equal(slow.code, 200);
    assert.deepEqual(Object.keys(stores['user-1'].row.app_settings.onboarding.assisted.skipped).sort(), ['perfil', 'verificacion']);
});

test('GET: completed_at se escribe en la cola releyendo app_settings, sin pisar lo que guardó otra request', async () => {
    const { deps, fixture } = fakeDeps();
    fixture.prefs.app_settings.onboarding = { assisted: { active: true, started_at: '2026-10-29T00:00:00.000Z' } };
    const store = prefsStore({ user_id: 'user-1', ...fixture.prefs });
    const saved = [];
    const handlers = createHandlers({
        ...deps,
        loadPrefs: async () => {
            const row = await store.loadPrefs();
            // Justo después de la primera lectura del GET, un POST guarda un "más tarde".
            if (store.reads === 1) store.row.app_settings.onboarding.assisted.skipped = { retiro: NOW_ISO };
            return row;
        },
        savePrefs: async (userId, appSettings) => { saved.push(appSettings); await store.savePrefs(userId, appSettings); }
    });
    const res = response();
    await handlers.getOnboarding(request(), res);
    assert.equal(res.code, 200);
    assert.equal(store.reads, 2, 'relee app_settings antes de escribir');
    assert.equal(saved.length, 1);
    assert.equal(store.row.app_settings.onboarding.assisted.completed_at, NOW_ISO);
    assert.deepEqual(store.row.app_settings.onboarding.assisted.skipped, { retiro: NOW_ISO }, 'el cambio del POST sobrevive');
    assert.equal(res.body.onboarding.assisted.completed_at, NOW_ISO);
    assert.deepEqual(res.body.onboarding.assisted.skipped, { retiro: NOW_ISO });

    // Si al releer ya otra request registró completed_at, no se vuelve a escribir.
    store.row.app_settings.onboarding.assisted.completed_at = null;
    const already = createHandlers({
        ...deps,
        loadPrefs: async () => {
            const row = await store.loadPrefs();
            store.row.app_settings.onboarding.assisted.completed_at = '2026-10-29T18:00:00.000Z';
            return row;
        },
        savePrefs: async (userId, appSettings) => { saved.push(appSettings); await store.savePrefs(userId, appSettings); }
    });
    const again = response();
    await already.getOnboarding(request(), again);
    assert.equal(saved.length, 1, 'no pisa el completed_at que ya estaba');
    assert.equal(again.body.onboarding.assisted.completed_at, '2026-10-29T18:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Fuentes de datos con un query builder falso
// ---------------------------------------------------------------------------

function pgError(status, body) {
    const err = new Error(`PostgREST GET failed (${status}): ${JSON.stringify(body)}`);
    err.status = status;
    return err;
}
function fakeQuery(handler) {
    const calls = [];
    const query = (table) => {
        const call = { table, select: null, filters: [] };
        calls.push(call);
        const builder = {
            select(cols) { call.select = cols; return builder; },
            eq(col, val) { call.filters.push([col, val]); return builder; },
            limit() { return builder; },
            single() { call.single = true; return builder; },
            async execute() { return handler(call); },
            async upsert(values, opts) { call.upsert = { values, opts }; return []; },
            async patch(values, opts) { call.patch = { values, opts }; return []; }
        };
        return builder;
    };
    query.calls = calls;
    return query;
}

test('loadArtist: reintenta sin la columna opcional que falta', async () => {
    const query = fakeQuery((call) => {
        if (call.select.includes('instagram_verified_at')) {
            throw pgError(400, { code: '42703', message: 'column artists_db.instagram_verified_at does not exist' });
        }
        return { user_id: 'user-1', preferred_display_currency: 'ARS' };
    });
    const artist = await loaders.loadArtist('user-1', query);
    assert.equal(artist.preferred_display_currency, 'ARS');
    assert.equal(query.calls.length, 2);
    assert.match(query.calls[1].select, /preferred_display_currency/);
    assert.doesNotMatch(query.calls[1].select, /instagram_verified_at/);
    assert.match(query.calls[1].select, /instagram_verified_handle/);
    assert.deepEqual(query.calls[0].filters, [['user_id', 'user-1']]);

    const anonymous = fakeQuery((call) => {
        if (call.select.includes('profile_links')) throw pgError(400, { code: '42703', message: 'algo salió mal' });
        return { user_id: 'user-1' };
    });
    await loaders.loadArtist('user-1', anonymous);
    assert.equal(anonymous.calls.length, 2);
    for (const column of ['preferred_display_currency', 'instagram_verified_at', 'instagram_verified_handle', 'profile_links']) {
        assert.doesNotMatch(anonymous.calls[1].select, new RegExp(column));
    }

    const down = fakeQuery(() => { throw pgError(503, { message: 'unavailable' }); });
    await assert.rejects(loaders.loadArtist('user-1', down));
    assert.equal(down.calls.length, 1);
});

test('loadPayouts y loadDocuments: tabla ausente vs error transitorio', async () => {
    const missing = [
        pgError(404, { code: 'PGRST205', message: "Could not find the table 'public.artist_payout_destinations' in the schema cache" }),
        pgError(400, { code: '42P01', message: 'relation "public.artist_payout_destinations" does not exist' })
    ];
    for (const err of missing) {
        assert.deepEqual(await loaders.loadPayouts('user-1', fakeQuery(() => { throw err; })), { available: false, count: 0 });
        assert.equal(await loaders.loadDocuments('user-1', fakeQuery(() => { throw err; })), null);
    }
    const transient = pgError(500, { message: 'boom' });
    assert.deepEqual(await loaders.loadPayouts('user-1', fakeQuery(() => { throw transient; })), { available: true, count: 0 });
    assert.deepEqual(await loaders.loadDocuments('user-1', fakeQuery(() => { throw transient; })), []);

    const ok = fakeQuery(() => [{ id: 'd1' }, { id: 'd2' }]);
    assert.deepEqual(await loaders.loadPayouts('user-1', ok), { available: true, count: 2 });
    assert.deepEqual(ok.calls[0].filters, [['artist_user_id', 'user-1'], ['active', true]]);
});

test('savePrefs y markProfileShared escriben con service role las filas del usuario', async () => {
    const query = fakeQuery(() => []);
    await loaders.savePrefs('user-1', { onboarding: {} }, query);
    await loaders.markProfileShared('user-1', query);
    assert.equal(query.calls[0].table, 'user_preferences');
    assert.deepEqual(query.calls[0].upsert, { values: { user_id: 'user-1', app_settings: { onboarding: {} } }, opts: { onConflict: 'user_id', returning: false } });
    assert.equal(query.calls[1].table, 'artists_db');
    assert.deepEqual(query.calls[1].filters, [['user_id', 'user-1']]);
    assert.deepEqual(query.calls[1].patch.values, { ms_profile_shared: true });
});

test('loadInstagram: módulo ausente, con error o con estado', async () => {
    const artist = { instagram: '@laura.tattoo' };
    const ctx = { userId: 'user-1', artist, authUser: { id: 'user-1' } };
    const missing = () => { const err = new Error("Cannot find module './instagram-verification'"); err.code = 'MODULE_NOT_FOUND'; throw err; };
    const fallback = await loaders.loadInstagram(ctx, missing);
    assert.deepEqual(fallback, { available: false, enforced: false, verified: false, status: 'none', handle: 'laura.tattoo',
        verified_handle: null, verified_at: null, expires_at: null, email_masked: null, pending_items: 0, legacy_items: 0 });

    const throwing = await loaders.loadInstagram(ctx, () => ({ getStateForArtist: async () => { throw new Error('db'); } }));
    assert.equal(throwing.available, false);

    let received = null;
    const state = await loaders.loadInstagram(ctx, () => ({
        getStateForArtist: async (args) => {
            received = args;
            return { success: true, available: true, status: 'pending', handle: '@laura.tattoo', expires_at: '2026-11-02T12:00:00.000Z',
                email_masked: 'la***@example.test', pending_items: 4, legacy_items: 2, instructions: { account: 'weotzi' } };
        }
    }));
    assert.deepEqual(received, ctx);
    assert.deepEqual(state, { available: true, enforced: true, verified: false, status: 'pending', handle: 'laura.tattoo',
        verified_handle: null, verified_at: null, expires_at: '2026-11-02T12:00:00.000Z', email_masked: 'la***@example.test',
        pending_items: 4, legacy_items: 2 });
});
