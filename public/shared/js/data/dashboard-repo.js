/**
 * WE OTZI - Repositorio del dashboard del artista (ronda 3, Figma 24:1425)
 * ------------------------------------------------------------------------
 * Lecturas y escrituras propias de la capa viva del dashboard que no tienen
 * un repo de dominio:
 *
 *   - DashboardActivity.listRecentReviews: reseñas aprobadas del artista
 *     (verified_reviews) para "Actividad reciente".
 *   - DashboardActivity.listRecentSessions: cambios de turnos
 *     (quotation_sessions) de las cotizaciones del artista.
 *   - DashboardActivity.registerSource(name, loader): PUNTO DE EXTENSIÓN. Otro
 *     módulo (p. ej. el grupo "pagos" con "Pago recibido · cliente · $") suma
 *     ítems a la actividad sin tocar dashboard-redesign.js:
 *
 *       WeotziData.DashboardActivity.registerSource('payments', async (ctx) => [
 *           { type: 'payment', text: 'Pago recibido · Mateo · $180', created_at: iso, href: '/my-quotations/detail?id=…' }
 *       ]);
 *
 *     ctx = { artistId, quotes, since }. El dashboard llama a cada loader al
 *     cargar y cada vez que se dispara `weotzi:dashboard-activity-refresh`.
 *     Registrar una fuente después de cargar también dispara un refresco.
 *
 *   - DesignStage.set(quotationId, { stage, due }): RPC security definer
 *     set_quotation_design_stage (migración 20261112180000). Solo el artista
 *     dueño o soporte.
 *
 * Carga: postgrest-client.js primero. Expone WeotziData.DashboardActivity y
 * WeotziData.DesignStage.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[dashboard-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;
    const sources = new Map();

    const DashboardActivity = {
        async listRecentReviews(artistUserId, sinceIso, limit = 10) {
            const { data } = await run('dashboard.reviews', (c) => {
                let q = c.from('verified_reviews')
                    .select('id, reviewer_display_name, rating, approved_at, created_at')
                    .eq('reviewee_type', 'artist')
                    .eq('reviewee_user_id', artistUserId)
                    .eq('moderation_status', 'approved')
                    .order('created_at', { ascending: false })
                    .limit(limit);
                if (sinceIso) q = q.gte('created_at', sinceIso);
                return q;
            });
            return data || [];
        },

        async listRecentSessions(quotationIds, sinceIso, limit = 30) {
            const ids = (quotationIds || []).filter((v) => v != null);
            if (!ids.length) return [];
            const { data } = await run('dashboard.sessions', (c) => {
                let q = c.from('quotation_sessions')
                    .select('id, quotation_id, session_number, session_date, status, created_at, updated_at')
                    .in('quotation_id', ids)
                    .order('updated_at', { ascending: false })
                    .limit(limit);
                if (sinceIso) q = q.gte('updated_at', sinceIso);
                return q;
            });
            return data || [];
        },

        registerSource(name, loader) {
            if (!name || typeof loader !== 'function') return;
            sources.set(String(name), loader);
            try { document.dispatchEvent(new CustomEvent('weotzi:dashboard-activity-refresh', { detail: { source: String(name) } })); } catch (_) { /* sin DOM */ }
        },

        unregisterSource(name) { sources.delete(String(name)); },

        // Corre todas las fuentes registradas; una que falle no tumba al resto.
        async loadSources(ctx) {
            const entries = [...sources.entries()];
            const results = await Promise.allSettled(entries.map(([, loader]) => Promise.resolve().then(() => loader(ctx || {}))));
            const items = [];
            results.forEach((result, i) => {
                if (result.status === 'fulfilled' && Array.isArray(result.value)) items.push(...result.value);
                else if (result.status === 'rejected') console.warn(`[dashboard-repo] fuente "${entries[i][0]}" falló`, result.reason);
            });
            return items;
        },
    };

    const DesignStage = {
        async set(quotationId, { stage = null, due = null } = {}) {
            const { data } = await run('dashboard.designStage', (c) =>
                c.rpc('set_quotation_design_stage', {
                    p_quotation_id: Number(quotationId),
                    p_stage: stage || null,
                    p_due_date: due || null,
                })
            );
            return Array.isArray(data) ? (data[0] || null) : (data || null);
        },
    };

    D.DashboardActivity = DashboardActivity;
    D.DesignStage = DesignStage;

    // Fuentes declaradas antes de que cargue este repo:
    // window.WoDashboardActivitySources = [{ name, loader }].
    (window.WoDashboardActivitySources || []).forEach((s) => {
        if (s && s.name && typeof s.loader === 'function') sources.set(String(s.name), s.loader);
    });
})();
