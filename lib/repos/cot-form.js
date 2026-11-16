'use strict';

// ===========================================================================
// Repositorio del cotizador web (frente cot-form · ronda 2) — capa PostgREST.
// ---------------------------------------------------------------------------
// Corre con service role: la autorización (dueño de la cotización, límites de
// uso) la hacen lib/routes/cot-form.js y services/quotation-intake.js ANTES de
// llamar aquí. Solo devuelve datos públicos del artista o datos del propio
// cliente autenticado.
// ===========================================================================

const { pgrest } = require('../postgrest');
const cotForm = require('../cot-form');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIST_LOCATION_SELECT = 'user_id,username,name,city,country,ubicacion,estudios,studio_id,registration_status';
const REUSE_ATTACHMENT_SELECT = 'google_drive_url,file_name,mime_type,sort_order,attachment_type';

// Una fuente caída (vista sin desplegar, tabla vacía) no rompe las demás.
async function safeRows(label, promise) {
    try {
        const rows = await promise;
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn(`[cot-form repo] ${label}:`, String(error.message || '').slice(0, 160));
        return [];
    }
}

function todayIso(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

const CotFormRepo = {
    /**
     * Fuentes públicas de las sedes del artista (P27). null si el artista no
     * existe o no terminó su alta.
     */
    async locationSources(artistId, { today = todayIso() } = {}) {
        if (!UUID_RE.test(String(artistId || ''))) return null;
        const artist = await pgrest('artists_db').select(ARTIST_LOCATION_SELECT)
            .eq('user_id', artistId).limit(1).single().execute();
        if (!artist || !artist.username || artist.registration_status === 'incompleto') return null;

        const [tattooLocations, memberships, trips] = await Promise.all([
            safeRows('artist_tattoo_locations', pgrest('artist_tattoo_locations')
                .select('id,period_type,studio_id,studio_name,city,country,agenda_status,start_date,end_date,sort_order')
                .eq('artist_user_id', artistId).order('sort_order').limit(40).execute()),
            safeRows('studio_public_roster', pgrest('studio_public_roster')
                .select('membership_id,studio_id,location_id,role,started_at,ends_on')
                .eq('artist_user_id', artistId).limit(40).execute()),
            // Solo viajes que el artista hizo públicos (share_enabled).
            safeRows('artist_trips', pgrest('artist_trips')
                .select('id,city,country,start_date,end_date,status,event_name,studio_name_hint,share_enabled')
                .eq('artist_user_id', artistId).eq('share_enabled', true).gte('end_date', today)
                .order('start_date').limit(20).execute())
        ]);

        const studioIds = [...new Set([
            artist.studio_id,
            ...memberships.map((m) => m.studio_id),
            ...tattooLocations.map((t) => t.studio_id)
        ].filter((id) => UUID_RE.test(String(id || ''))))];

        let studios = [];
        let studioLocations = [];
        if (studioIds.length) {
            [studios, studioLocations] = await Promise.all([
                safeRows('studios', pgrest('studios').select('id,name,city,country,is_active').in('id', studioIds).execute()),
                safeRows('studio_locations', pgrest('studio_locations')
                    .select('id,studio_id,label,city,locality,country,is_primary,is_active,sort_order')
                    .in('studio_id', studioIds).eq('is_active', true).limit(200).execute())
            ]);
        }
        return { artist, tattooLocations, memberships, trips, studios, studioLocations };
    },

    // Cotización completa (para clonar). La ruta valida al dueño.
    getQuotation(quoteId) {
        return pgrest('quotations_db').select('*').eq('quote_id', quoteId).limit(1).single().execute();
    },

    async getExtras(quoteId) {
        try {
            return await pgrest('quotation_intake_extras').select('idea_mode,personalization_level,reference_notes')
                .eq('quote_id', quoteId).limit(1).single().execute();
        } catch (_) {
            return null;
        }
    },

    // Referencias de una cotización, en orden. Con la migración de la ronda 2
    // trae además la nota y la marca de IA de cada imagen.
    async listReferences(quoteId) {
        const base = () => pgrest('quotations_attachments').eq('quotation_id', quoteId)
            .eq('attachment_type', 'reference').order('sort_order').limit(12);
        try {
            return await base().select(`${REUSE_ATTACHMENT_SELECT},note,ai_generated`).execute();
        } catch (_) {
            return safeRows('quotations_attachments', base().select(REUSE_ATTACHMENT_SELECT).execute());
        }
    },

    // P17: agrupa por contacto y vincula a la cuenta verificada dueña del email.
    linkContact(quoteId) {
        return pgrest.raw('rpc/link_quotation_contact', { method: 'POST', body: { p_quote_id: quoteId } });
    },

    /**
     * Copia un archivo AL bucket de referencias (Storage, service role).
     * Por defecto copia dentro del mismo bucket; con `fromBucket` copia desde
     * otro bucket del proyecto (Flash Tattoos: la imagen del flash sale de la
     * galería del artista). Devuelve true si quedó copiado.
     */
    async copyReference(fromPath, toPath, { fetchImpl = fetch, fromBucket = null } = {}) {
        const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) return false;
        const sourceBucket = fromBucket || cotForm.REFERENCE_BUCKET;
        const payload = { bucketId: sourceBucket, sourceKey: fromPath, destinationKey: toPath };
        if (sourceBucket !== cotForm.REFERENCE_BUCKET) payload.destinationBucket = cotForm.REFERENCE_BUCKET;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetchImpl(`${url}/storage/v1/object/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
                signal: controller.signal,
                body: JSON.stringify(payload)
            });
            return response.ok;
        } catch (_) {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }
};

module.exports = { CotFormRepo, UUID_RE };
