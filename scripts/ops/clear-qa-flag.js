#!/usr/bin/env node
'use strict';

// ===========================================================================
// Acceso · ACC-07 · quitar la marca qa_unverified_email a artistas confirmados.
// CORRER SOLO CON OK DEL DUEÑO.
// ---------------------------------------------------------------------------
// Hasta 2.2.15 createArtistAuthUser marcaba a TODO artista con
// app_metadata.qa_unverified_email = true. La marca impide reclamar por email
// las cotizaciones hechas como invitado y deja clients_db.email_verified en
// false si el artista pasa a modo cliente. Desde este cambio solo se marca la
// cuenta autoconfirmada sin verificar el email.
//
// Toca solo cuentas de ARTISTA (tienen registration_draft_id) con el email
// confirmado. Los clientes de prueba (registro de auditoría) quedan como están.
//
// Uso:
//   node scripts/ops/clear-qa-flag.js            → solo lista (no cambia nada)
//   node scripts/ops/clear-qa-flag.js --apply    → quita la marca
// Lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del .env.
// ===========================================================================

try { require('dotenv').config(); } catch (_) { /* dotenv opcional */ }

function shouldClear(user) {
    const app = (user && user.app_metadata) || {};
    return app.qa_unverified_email === true
        && Boolean(user.email_confirmed_at)
        && Boolean(app.registration_draft_id);
}

async function listAllUsers({ url, key, fetchImpl = fetch, perPage = 200 }) {
    const users = [];
    for (let page = 1; page < 100; page += 1) {
        const res = await fetchImpl(`${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        if (!res.ok) throw new Error(`No se pudo listar usuarios (HTTP ${res.status})`);
        const body = await res.json();
        const batch = Array.isArray(body) ? body : (body.users || []);
        users.push(...batch);
        if (batch.length < perPage) break;
    }
    return users;
}

async function clearFlag({ url, key, userId, fetchImpl = fetch }) {
    const res = await fetchImpl(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata: { qa_unverified_email: null } })
    });
    if (!res.ok) throw new Error(`No se pudo actualizar ${userId} (HTTP ${res.status})`);
}

async function main() {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el .env');
    const apply = process.argv.includes('--apply');
    const targets = (await listAllUsers({ url, key })).filter(shouldClear);
    console.log(`${targets.length} artista(s) confirmados con la marca qa_unverified_email.`);
    targets.forEach((u) => console.log(` - ${u.id}`));
    if (!apply) {
        console.log('Modo lectura. Para quitar la marca: node scripts/ops/clear-qa-flag.js --apply');
        return;
    }
    for (const u of targets) {
        await clearFlag({ url, key, userId: u.id });
        console.log(`   marca quitada: ${u.id}`);
    }
}

if (require.main === module) {
    main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { shouldClear, listAllUsers, clearFlag };
