/* Screen-local visual samples. No shared store writes and no production fallback. */
(function (window) {
    'use strict';
    window.WoJobBoardScreen15Preview = {
        build: function (source) {
            if (window.WEOTZI_PREVIEW !== true) return null;
            const rows = [
                ['59407', 'Calavera con auriculares y notas musicales, estilo new school', ['New School', 'Tradicional'], 'Medellín', 'Hombro', 200, 400, 4, true],
                ['76217', 'Retrato de gato persa estilo anime con ojos grandes', ['Anime', 'New School'], 'Lima', 'Antebrazo', 100, 250, 1, true],
                ['33005', 'Mandala geométrico con simbolismo lunar', ['Geométrico', 'Mandala'], 'Bogotá', 'Costilla', 150, 300, 2, false],
                ['34654', 'Serpiente enroscada en estilo japonés tradicional', ['Japonés', 'Tradicional'], 'CDMX', 'Pierna', 400, 800, 6, false],
                ['28471', 'Brújula vintage con mapa náutico', ['Tradicional', 'Lettering'], 'Rosario', 'Pantorrilla', 150, 350, 3, false],
                ['51027', 'Loro tropical con flores exóticas y colores vibrantes', ['Realismo', 'Acuarela'], 'Quito', 'Antebrazo', 200, 500, 4, false],
                ['24872', 'Retrato realista de abuela en blanco y negro', ['Realismo', 'Black & Grey'], 'Santiago', 'Antebrazo', 300, 600, 5, true],
                ['45210', 'Retrato hiperrealista de lobo aullando bajo la luna', ['Hiperrealismo', 'Realismo'], 'Montevideo', 'Pantorrilla', 400, 900, 4, false],
                ['30991', 'Paisaje de montaña en acuarela realista', ['Realismo', 'Acuarela'], 'Medellín', 'Brazo', 250, 500, 2, true],
                ['41432', 'Ángel caído con alas desplegadas y plumas cayendo', ['Blackwork', 'Surrealista'], 'Lima', 'Espalda alta', 500, 1000, 3, false],
                ['19832', 'Tigre feroz en blackwork con detalle ornamental', ['Blackwork', 'Ornamental'], 'Medellín', 'Brazo completo', 600, 1200, 7, false],
                ['38820', 'Cráneo ornamental con mandala en blackwork', ['Blackwork', 'Ornamental'], 'Bogotá', 'Pecho', 500, 900, 5, false],
                ['27654', 'Fénix renaciendo entre líneas geométricas blackwork', ['Blackwork', 'Geométrico'], 'Lima', 'Espalda', 600, 1100, 6, false]
            ];
            const requests = rows.map(function (row, index) {
                const original = source[index] || source[0] || {};
                return Object.assign({}, original, {
                    id: source[index]?.id || 'screen15-' + row[0],
                    request_code: source[index]?.request_code || 'JB-' + row[0],
                    display_code: 'JB-' + row[0], display_title: row[1], tattoo_idea_title: row[1], tattoo_idea_description: row[1],
                    tattoo_style: row[2], _parsedStyles: row[2], client_city: row[3], tattoo_body_part: row[4],
                    tattoo_size: 'medium', client_budget_min: row[5], client_budget_max: row[6], client_budget_currency: 'USD',
                    application_count: row[7], created_at: new Date(Date.now() - (row[8] ? 1 : 12) * 86400000).toISOString(),
                    feed_rank: index + 1, is_featured: false, is_sponsored: false, job_board_attachments: []
                });
            });
            // Additional searchable samples make the sidebar counts real, not decorative.
            for (let index = 0; index < 12; index++) {
                const styles = ['Fine Line'];
                if (index < 7) styles.push('Blackwork', 'Black & Grey');
                if (index < 8) styles.push('Microrealismo');
                requests.push(Object.assign({}, requests[0], {
                    id: 'screen15-filter-' + index, request_code: 'JB-SAMPLE-' + index, display_code: 'JB-SAMPLE-' + index,
                    display_title: 'Solicitud de prueba · Fine Line ' + (index + 1),
                    tattoo_idea_description: 'Solicitud de prueba · Fine Line ' + (index + 1),
                    tattoo_style: styles, _parsedStyles: styles, feed_rank: null
                }));
            }
            const sponsor = Object.assign({}, requests[0], {
                id: 'screen15-sponsor', request_code: 'JB-SPONSOR', display_code: 'SPONSOR', feed_rank: null,
                display_title: 'Buscamos artistas residentes para nueva sede en Ciudad de México',
                tattoo_idea_description: 'Estudio boutique especializado en blackwork y fine line abre agenda para una residencia de 3 meses. Clientela propia, marketing incluido y flexibilidad de fechas.',
                tattoo_style: [], _parsedStyles: [], client_city: 'Ciudad de México', client_budget_min: 800, client_budget_max: 2500
            });
            requests.push(sponsor);
            return {
                requests: requests,
                featured: {
                    request_id: sponsor.id, studio_name: 'Aurora Ink Collective', studio_initials: 'AI', slots_count: 3,
                    title: 'Buscamos artistas residentes para nueva sede en Ciudad de México',
                    description: 'Estudio boutique especializado en blackwork y fine line abre agenda para una residencia de 3 meses. Clientela propia, marketing incluido y flexibilidad de fechas.',
                    city: 'Ciudad de México', budget_min: 800, budget_max: 2500, budget_currency: 'USD',
                    tags: ['Agenda inmediata', 'Múltiples proyectos', 'Contratación frecuente'], published_label: 'Publicado hoy', cta_label: 'Postularme'
                }
            };
        }
    };
}(window));
