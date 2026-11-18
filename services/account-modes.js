'use strict';
const { resolveBearerUser } = require('../lib/auth/supabase-auth');
const { pgrest } = require('../lib/postgrest');
const { isEmailVerified } = require('../lib/cot-cliente');
const termsGate = require('../lib/terms-gate');

function testingEnabled() { return process.env.AUDIT_REGISTRATION_OPEN === 'true'; }
// Vínculo por correo (hide/complete de una cotización sin dueño): solo con el
// correo verificado de verdad, el mismo criterio que lib/cot-cliente.js y que
// las funciones SQL que vinculan cuentas (link_quotation_contact,
// create_manual_quotation).
function canClaimByEmail(user, quotation) {
    return !!user && !!quotation && !quotation.client_user_id && isEmailVerified(user)
        && String(quotation.client_email || '').trim().toLowerCase() === String(user.email).trim().toLowerCase();
}
function clientProfile(user) {
    return { user_id: user.id, email: user.email, full_name: user.raw?.user_metadata?.full_name || user.raw?.user_metadata?.name || user.email.split('@')[0], email_verified: isEmailVerified(user) };
}
// ── acceso (ACC-08): el artista que pasa a modo cliente ya aceptó los mismos
// Términos al registrarse; se reutiliza esa aceptación (dato del servidor).
// Best-effort: un fallo aquí no impide cambiar de modo.
async function carryArtistTermsToClient(userId) {
    try {
        const { AccesoRepo } = require('../lib/repos/acceso');
        const { termsFromArtist } = require('../lib/acceso');
        const terms = termsFromArtist(await AccesoRepo.getArtistProfile(userId));
        if (terms) await AccesoRepo.stampClientTerms(userId, terms);
    } catch (e) {
        console.warn('[account-mode] términos del cliente:', e.message);
    }
}
// Identificadores de una cuenta ya creada para checkReentry (sin perfil todavía).
function accountReentryInput(user, flow) {
    const raw = user.raw || {};
    const meta = raw.user_metadata || {};
    return {
        email: user.email || null,
        phone: String(raw.phone || meta.whatsapp || '').trim() || null,
        instagram: String(meta.instagram || '').trim() || null,
        country: null,
        flow,
        userId: user.id
    };
}
async function activate(req, res) {
    const user = await resolveBearerUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para cambiar de modo.' });
    const mode = req.body?.mode;
    if (!['artist','client'].includes(mode)) return res.status(400).json({ error: 'Modo no válido.' });
    try {
        if (mode === 'client') {
            // ── términos (2.7.0): bloqueo de reingreso antes de crear el perfil
            // de cliente (Google, Facebook, enlace mágico). Una cuenta nueva que
            // coincide con una sanción queda bloqueada también en Auth.
            const reentry = await termsGate.checkReentrySafe(accountReentryInput(user, 'client'));
            if (reentry.blocked) {
                if (termsGate.isEnforcedAccount(user)) {
                    await termsGate.blockNewAccountSafe({ userId: user.id, matches: reentry.matches, flow: 'client' });
                }
                return res.status(403).json({ success: false, ...termsGate.REGISTRATION_BLOCKED });
            }
            // Ignore user-supplied identity and never overwrite an existing profile.
            await pgrest.raw('clients_db?on_conflict=user_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: clientProfile(user) });
            await carryArtistTermsToClient(user.id);
            return res.json({ success: true, mode, url: '/client/dashboard' });
        }
        const rows = await pgrest('artists_db').select('user_id,registration_status').eq('user_id',user.id).limit(1).execute();
        return res.json({ success: true, mode, url: rows[0] && rows[0].registration_status !== 'incompleto' ? '/artist/dashboard' : '/register-artist?mode=artist' });
    } catch (e) {
        console.error('[account-mode]', e.message);
        return res.status(500).json({ error: 'No pudimos activar el modo. Intenta de nuevo.' });
    }
}
async function registerTestClient(req, res) {
    if (!testingEnabled()) return res.status(403).json({ error: 'El registro de prueba está desactivado.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.full_name || '').trim().slice(0,150);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || password.length < 8 || password.length > 256) return res.status(400).json({error:'Completa nombre, correo válido y contraseña de al menos 8 caracteres.'});
    try {
        // ── términos (2.7.0): bloqueo de reingreso antes de crear la cuenta.
        const reentry = await termsGate.checkReentrySafe({ email, phone: null, instagram: null, country: null, flow: 'client', userId: null });
        if (reentry.blocked) return res.status(403).json({ success: false, ...termsGate.REGISTRATION_BLOCKED });
        const result = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
            method:'POST', headers:{ apikey:process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json' },
            body:JSON.stringify({email,password,email_confirm:true,app_metadata:{qa_unverified_email:true},user_metadata:{full_name:name,user_type:'client',qa_unverified_email:true}})
        });
        const data = await result.json();
        if (!result.ok) return res.status(result.status === 422 ? 409 : 400).json({error: /already|registered|exists/i.test(data.msg || data.message || '') ? 'Ya existe una cuenta con ese correo. Inicia sesión y cambia a modo cliente.' : 'No pudimos registrar esa cuenta.'});
        const user = data.user || data;
        await pgrest.raw('clients_db?on_conflict=user_id',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{user_id:user.id,email,full_name:name,email_verified:false}});
        return res.json({success:true,user:{id:user.id,email},test_registration:true});
    } catch(e) { console.error('[test-registration]',e.message); return res.status(500).json({error:'No pudimos completar el registro.'}); }
}
module.exports = { activate, registerTestClient, testingEnabled, clientProfile, canClaimByEmail };
