/**
 * Bandeja mínima del estudio para resolver solicitudes Travel.
 * La autorización real está en resolve_trip_studio_link: solo propietario del
 * estudio o soporte. Esta superficie nunca actualiza estados directamente.
 */
(function () {
    'use strict';

    const D = window.WeotziData || {};
    let studio = null;
    let channel = null;
    let loading = false;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const auth = window.WeOtziStudioAuth;
        if (!auth || !D.Travel) return;
        for (let attempt = 0; attempt < 24; attempt += 1) {
            studio = auth.getCurrent();
            if (studio) break;
            await wait(150);
        }
        if (!studio && typeof auth.check === 'function') studio = await auth.check();
        if (!studio) return;

        document.querySelector('[data-tab="travel"]')?.addEventListener('click', load);
        document.getElementById('studio-travel-links')?.addEventListener('click', onDecision);
        await load();
        subscribe(auth.getSupabase());
    }

    async function load() {
        if (loading || !studio) return;
        loading = true;
        const host = document.getElementById('studio-travel-links');
        try {
            const links = await D.Travel.listPendingStudioLinks(studio.id);
            const artists = await loadArtists(links);
            render(links, artists);
        } catch (error) {
            console.error('[studio-travel] cargar', error);
            if (host) host.innerHTML = '<div class="studio-status studio-status-error">No pudimos cargar las solicitudes Travel.</div>';
        } finally {
            loading = false;
        }
    }

    async function loadArtists(links) {
        const ids = [...new Set((links || []).map(function (link) {
            return link.artist_trips && link.artist_trips.artist_user_id;
        }).filter(Boolean))];
        if (!ids.length) return new Map();
        const client = D.getClient();
        const result = await client.from('artists_db').select('user_id,name,username').in('user_id', ids);
        if (result.error) throw result.error;
        return new Map((result.data || []).map(function (artist) { return [artist.user_id, artist]; }));
    }

    function render(links, artists) {
        const host = document.getElementById('studio-travel-links');
        if (!host) return;
        if (!links.length) {
            host.innerHTML = '<div class="studio-card"><p class="studio-section-kicker">Al día</p><h2 class="studio-h2">No hay solicitudes pendientes</h2><p class="studio-help">Cuando un artista quiera vincular un viaje con este estudio, aparecerá acá.</p></div>';
            return;
        }
        host.innerHTML = '<div style="display:grid;gap:14px;">' + links.map(function (link) {
            const trip = link.artist_trips || {};
            const artist = artists.get(trip.artist_user_id) || {};
            const artistName = artist.name || (artist.username ? '@' + artist.username : 'Artista');
            return '<article class="studio-card" data-travel-request="' + esc(link.id) + '">' +
                '<div style="display:flex;gap:14px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;">' +
                    '<div style="min-width:0;">' +
                        '<p class="studio-section-kicker">Solicitud Travel</p>' +
                        '<h2 class="studio-h2" style="margin-bottom:8px;">' + esc(artistName) + '</h2>' +
                        '<p class="studio-help" style="margin:0 0 4px;"><strong>' + esc([trip.city, trip.country].filter(Boolean).join(', ')) + '</strong></p>' +
                        '<p class="studio-help" style="margin:0;">' + esc(formatRange(trip.start_date, trip.end_date)) + ' · ' + esc(typeLabel(trip.trip_type)) + '</p>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button type="button" class="studio-btn" data-travel-action="reject">Rechazar</button>' +
                        '<button type="button" class="studio-btn studio-btn-primary" data-travel-action="confirm">Confirmar vínculo</button>' +
                    '</div>' +
                '</div>' +
            '</article>';
        }).join('') + '</div>';
    }

    async function onDecision(event) {
        const button = event.target.closest('[data-travel-action]');
        if (!button) return;
        const card = button.closest('[data-travel-request]');
        const linkId = card && card.dataset.travelRequest;
        const action = button.dataset.travelAction;
        if (!linkId || !['confirm', 'reject'].includes(action)) return;
        const buttons = card.querySelectorAll('button');
        buttons.forEach(function (item) { item.disabled = true; });
        try {
            await D.Travel.resolveStudioLink(linkId, action);
            showStatus('success', action === 'confirm' ? 'Vínculo confirmado. El viaje ya puede proyectarse públicamente.' : 'Solicitud rechazada.');
            await load();
        } catch (error) {
            console.error('[studio-travel] resolver', error);
            showStatus('error', 'No pudimos resolver la solicitud. Verificá que siga pendiente.');
            buttons.forEach(function (item) { item.disabled = false; });
        }
    }

    function subscribe(client) {
        if (!client || !studio) return;
        channel = client.channel('studio-travel-links-' + studio.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'trip_studio_links', filter: 'studio_id=eq.' + studio.id,
            }, load)
            .subscribe();
        window.addEventListener('beforeunload', function () {
            if (channel) client.removeChannel(channel);
        }, { once: true });
    }

    function showStatus(kind, message) {
        const node = document.getElementById('studio-travel-status');
        if (!node) return;
        node.className = 'studio-status studio-status-' + kind;
        node.textContent = message;
        node.hidden = false;
        window.setTimeout(function () { node.hidden = true; }, 5000);
    }

    function wait(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }

    function typeLabel(value) {
        return ({ guest_spot: 'Guest spot', convencion: 'Convención', estudio_invitado: 'Estudio invitado' })[value] || value || 'Viaje';
    }

    function formatRange(start, end) {
        const fmt = function (value) {
            if (!value) return 'Por confirmar';
            const date = new Date(value + 'T12:00:00');
            return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
        };
        return fmt(start) + ' — ' + fmt(end);
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
