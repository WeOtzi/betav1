'use strict';

// ===========================================================================
// Repositorio de Flash Tattoos (capa PostgREST, service role).
// ---------------------------------------------------------------------------
// La autorización y las validaciones las hace lib/routes/flash.js ANTES de
// llamar aquí. Solo lee datos públicos del artista (su galería) y escribe la
// instantánea del flash en la cotización que el propio servidor acaba de crear.
// ===========================================================================

const { pgrest } = require('../postgrest');
const { CotFormRepo } = require('./cot-form');
const { RESERVED_STATUSES } = require('../flash');

const ARTIST_SELECT = 'user_id,username,name,email,registration_status,gallery_feed_items';

const FlashRepo = {
    // Artista por usuario exacto (en minúsculas), sin altas incompletas.
    getArtistByUsername(username) {
        return pgrest('artists_db').select(ARTIST_SELECT)
            .eq('username', String(username || '').toLowerCase())
            .or([
                { col: 'registration_status', op: 'is', val: null },
                { col: 'registration_status', op: 'neq', val: 'incompleto' }
            ])
            .limit(1).single().execute();
    },

    // ¿Ya hay una cotización aprobada (o en curso) de este flash único?
    async hasReservedRequest(artistId, flashId) {
        const row = await pgrest('quotations_db').select('id')
            .eq('artist_id', artistId)
            .eq('source', 'flash')
            .eq('flash_snapshot->>id', flashId)
            .in('quote_status', RESERVED_STATUSES)
            .limit(1).single().execute();
        return !!row;
    },

    // Instantánea del flash en la cotización recién creada (una sola vez).
    saveSnapshot(quoteId, snapshot) {
        return pgrest('quotations_db').eq('quote_id', quoteId).is('flash_snapshot', null)
            .patch({ flash_snapshot: snapshot }, { returning: false });
    },

    // Imagen del flash (galería del artista) → bucket de referencias.
    copyFlashImage(source, toPath) {
        return CotFormRepo.copyReference(source.path, toPath, { fromBucket: source.bucket });
    }
};

module.exports = { FlashRepo };
