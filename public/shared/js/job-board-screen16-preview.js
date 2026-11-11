/* Read-only visual sample for this detail only. Never changes feed/shared fixtures. */
(function (window) {
    'use strict';
    window.WoJobBoardScreen16Preview = {
        build: function (source) {
            if (window.WEOTZI_PREVIEW !== true || source.display_code !== 'JB-24872') return null;
            const now = Date.now();
            return {
                request: Object.assign({}, source, {
                    tattoo_idea_description: 'Quiero un retrato realista en blanco y negro de mi abuela, basado en una foto de los años\n70. Me gustaría que se note el detalle de su expresión y el pañuelo que llevaba puesto. Es\nmi primer tatuaje grande y busco un artista con experiencia real en retratos hiperrealistas.',
                    tattoo_size: 'Mediano (15–20 cm)',
                    _parsedStyles: ['Realismo', 'Black & grey'],
                    expires_at: new Date(now + 3 * 86400000).toISOString(),
                    created_at: new Date(now - 2 * 86400000).toISOString(),
                    _screen16Deadline: '28 de julio',
                    _screen16Requirements: ['Mostrar trabajos previos de retratos', 'Prefiere resolverlo en una sola sesión si es posible', 'Abierta a recibir un boceto antes de confirmar'],
                    client_travel_willing: true,
                    client_public_profiles: { public_username: 'Camila R.', created_at: '2026-01-02', review: { average_rating: 4.9 } }
                }),
                artist: { username: 'Lauumarth.wo', city: 'BUENOS AIRES', styles_array: ['Blackwork', 'Fine line'], gallery_images: [] },
                stats: { averageRating: 4.9, workCount: 32 }
            };
        }
    };
}(window));
