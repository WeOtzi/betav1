'use strict';
const crypto = require('node:crypto');
const { pgrest } = require('../lib/postgrest');
const { resolveBearerUser } = require('../lib/auth/supabase-auth');

const CLIENT_FIELDS = ['tattoo_body_part','tattoo_body_side','tattoo_idea_description','tattoo_size','tattoo_style','tattoo_color_type','reference_images_count','tattoo_references','tattoo_is_first_tattoo','tattoo_is_cover_up','client_full_name','client_email','client_instagram','client_city_residence','client_travel_willing','city_mismatch_acknowledged','style_mismatch_acknowledged','client_preferred_date','client_flexible_dates','client_budget_amount','client_budget_currency','client_contact_preference','client_whatsapp','client_birth_date','client_age','client_health_conditions','client_allergies','tattoo_estimated_sessions'];
function invalid(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function normalizeIntake(body, user, artist) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submission_key || '')) invalid('La clave de la solicitud no es válida.');
    if (!['draft','submit'].includes(body.mode)) invalid('Operación no válida.');
    const input = body.quotation || {};
    if (input.artist_id && (!artist || artist.registration_status === 'incompleto' || !artist.username)) invalid('El artista no está disponible.', 404);
    const q = Object.fromEntries(CLIENT_FIELDS.map(k => [k, input[k] ?? null]));
    q.client_email = String(q.client_email || '').trim().toLowerCase();
    q.tattoo_idea_description = String(q.tattoo_idea_description || '').trim();
    q.client_full_name = String(q.client_full_name || '').trim();
    if (JSON.stringify(q).length > 40000) invalid('La solicitud es demasiado extensa.');
    if (body.mode === 'submit') {
        if (!q.client_full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.client_email)) invalid('Completá nombre y correo válidos.');
        if (!q.tattoo_idea_description || !q.tattoo_style || !q.tattoo_body_part || !q.tattoo_size) invalid('Completá la idea, estilo, zona y tamaño.');
    }
    if (q.client_budget_amount != null && (!Number.isFinite(Number(q.client_budget_amount)) || Number(q.client_budget_amount) < 0)) invalid('El presupuesto no es válido.');
    Object.assign(q, {
        quote_id: 'QN' + crypto.createHash('sha256').update('weotzi-intake:' + body.submission_key).digest('hex').slice(0,32),
        quote_status: body.mode === 'submit' ? 'pending' : 'in_progress',
        client_user_id: user && user.email?.toLowerCase() === q.client_email ? user.id : null,
        artist_id: artist?.user_id || null, artist_name: artist?.name || null, artist_email: artist?.email || null,
        artist_instagram: artist?.instagram || null, artist_styles: artist?.styles_array || [],
        artist_current_city: artist?.ubicacion || artist?.city || null, artist_studio_name: artist?.estudios || null,
        artist_session_cost_amount: artist?.session_price || null,
        quotation_medium: 'web', source: input.source === 'prequote' ? 'prequote' : 'web_chat'
    });
    const extra = body.extras || {};
    const extras = { idea_mode: extra.idea_mode === 'explorar' ? 'explorar' : 'idea', personalization_level: ['tal_cual','interpretacion','propuesta'].includes(extra.personalization_level) ? extra.personalization_level : null, reference_notes: Array.isArray(extra.reference_notes) ? extra.reference_notes.slice(0,4).map(n => String(n).slice(0,2000)) : [] };
    return { q, extras };
}

async function handleIntake(req, res) {
    try {
        const user = await resolveBearerUser(req);
        if (req.headers.authorization && !user) invalid('La sesión venció. Volvé a iniciar sesión.',401);
        const id = req.body?.quotation?.artist_id;
        if (id && !/^[0-9a-f-]{36}$/i.test(id)) invalid('Artista no válido.');
        const artist = id ? await pgrest('artists_db').select('user_id,username,name,email,instagram,styles_array,ubicacion,city,estudios,session_price,registration_status').eq('user_id',id).limit(1).single().execute() : null;
        const {q,extras} = normalizeIntake(req.body || {},user,artist);
        const response = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/save_web_quotation', {
            method:'POST', headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},
            body:JSON.stringify({p_quote:q,p_extras:extras})
        });
        if (!response.ok) { const detail = await response.json(); console.error('[quotation-intake]',detail.code,detail.message); invalid('No pudimos guardar la cotización. Intentá nuevamente.',502); }
        const result = await response.json();
        res.json({success:true,quote_id:result.quote_id,status:result.status});
    } catch (e) { res.status(e.status || 500).json({success:false,error:e.status ? e.message : 'No pudimos guardar la cotización.'}); }
}
module.exports = {handleIntake,normalizeIntake,CLIENT_FIELDS};
