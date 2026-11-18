'use strict';

// ===========================================================================
// Repositorio de Flash Tattoos (capa PostgREST, service role).
// ---------------------------------------------------------------------------
// La autorización y las validaciones las hace lib/routes/flash.js ANTES de
// llamar aquí. Solo lee datos públicos del artista (su galería) y las
// solicitudes ya reservadas. La instantánea del flash la guarda
// save_web_quotation junto con la cotización (services/quotation-intake.js).
// ===========================================================================

const { pgrest } = require('../postgrest');
const { CotFormRepo } = require('./cot-form');
const { RESERVED_STATUSES } = require('../flash');
const { applyPublicFilter } = require('../artist-visibility');

const ARTIST_SELECT = 'user_id,username,name,email,registration_status,sanction_state,gallery_feed_items';

const FlashRepo = {
    // Artista por usuario exacto (en minúsculas), sin altas incompletas ni
    // sanciones (lib/artist-visibility.js).
    getArtistByUsername(username) {
        return applyPublicFilter(pgrest('artists_db').select(ARTIST_SELECT)
            .eq('username', String(username || '').toLowerCase()))
            .limit(1).single().execute();
    },

    // ¿Ya hay una cotización aprobada (o en curso) de este flash único?
    async hasReservedRequest(artistId, flashId) {
        const row = await pgrest('quotations_db').select('id')
            .eq('artist_id', artistId)
            .eq('source', 'flash')
            .eq('flash_snapshot->>id', flashId)
            .in('quote_status', RESERVED_STATUSES)
            // Un borrador del cotizador (in_progress sin respuesta del artista) no reserva el flash.
            .or([{ col: 'quote_status', op: 'neq', val: 'in_progress' }, { col: 'artist_responded_at', op: 'not.is', val: 'null' }, { col: 'artist_budget_amount', op: 'not.is', val: 'null' }, { col: 'final_budget_amount', op: 'not.is', val: 'null' }])
            .limit(1).single().execute();
        return !!row;
    },

    // Imagen del flash (galería del artista) → bucket de referencias.
    copyFlashImage(source, toPath) {
        return CotFormRepo.copyReference(source.path, toPath, { fromBucket: source.bucket });
    }
};

module.exports = { FlashRepo };
