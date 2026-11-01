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
        studio = auth.getCurrent() || await auth.check();
        if (!studio) return;

        document.addEventListener('click', event => {
            if (event.target.closest('.studio-dash-tab[data-tab="travel"]')) load();
        });
        window.addEventListener('studio:tabchange', event => {
            if (event.detail?.tab === 'travel') load();
        });
        document.getElementById('studio-travel-links')?.addEventListener('click', onDecision);
        await load();
        subscribe(auth.getSupabase());
    }

    async function load() {
        if (loading || !studio) return;
        loading = true;
        const host = document.getElementById('studio-travel-links');
        if (host) {
            host.setAttribute('aria-busy', 'true');
            if (!host.childElementCount) host.innerHTML = '<p class="wo-help" role="status">Cargando solicitudes Travel…</p>';
        }
        try {
            const result = await D.StudioOps.listTravelLinks(studio.id);
            if (result.error) throw result.error;
            const links = result.data || [];
            const artists = await loadArtists(links);
            render(links, artists);
        } catch (error) {
            console.error('[studio-travel] cargar', error);
            if (host) host.innerHTML = '<div class="studio-status studio-status-error" role="alert">No pudimos cargar las solicitudes Travel. Volvé a abrir esta sección para intentar nuevamente.</div>';
        } finally {
            loading = false;
            if (host) host.setAttribute('aria-busy', 'false');
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
            host.innerHTML = '<div class="studio-empty"><i data-wo-icon="map-pin" aria-hidden="true"></i><h3 class="studio-item-title">Todavía no hay solicitudes</h3><p class="wo-help">Cuando un artista quiera vincular un viaje con este estudio, aparecerá acá. También vas a ver el historial de solicitudes resueltas.</p></div>';
            return;
        }
        host.innerHTML = '<div class="studio-list">' + links.map(function (link) {
            const trip = link.artist_trips || {};
            const artist = artists.get(trip.artist_user_id) || {};
            const artistName = artist.name || (artist.username ? '@' + artist.username : 'Artista');
            const pending = link.status === 'esperando_confirmacion' && trip.status !== 'cancelado';
            const label = trip.status === 'cancelado' ? 'Viaje cancelado' : ({ esperando_confirmacion: 'Pendiente', confirmado: 'Confirmado', rechazado: 'Rechazado', cancelado: 'Cancelado' })[link.status] || link.status;
            return '<article class="studio-location-row studio-travel-request" data-travel-request="' + esc(link.id) + '">' +
                '<div class="studio-location-row-head">' +
                    '<div class="studio-travel-details">' +
                        '<span class="wo-badge wo-badge--s ' + (pending ? 'wo-badge--outline' : link.status === 'confirmado' ? 'wo-badge--success' : 'wo-badge--outline') + '">' + esc(label) + '</span>' +
                        '<h3 class="studio-item-title">' + esc(artistName) + '</h3>' +
                        '<p class="wo-help"><strong>' + esc([trip.city, trip.country].filter(Boolean).join(', ')) + '</strong></p>' +
                        '<p class="wo-help">' + esc(formatRange(trip.start_date, trip.end_date)) + ' · ' + esc(typeLabel(trip.trip_type)) + '</p>' +
                    '</div>' +
                    (pending ? '<div class="studio-actions">' +
                        '<button type="button" class="wo-btn wo-btn--secondary" data-travel-action="reject">Rechazar</button>' +
                        '<button type="button" class="wo-btn" data-travel-action="confirm"><i data-wo-icon="check" aria-hidden="true"></i>Confirmar vínculo</button>' +
                    '</div>' : '') +
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
        node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        window.setTimeout(function () { node.hidden = true; }, 5000);
    }

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
