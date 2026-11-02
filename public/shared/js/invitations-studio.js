// ================================================================
// WE OTZI - Invitaciones · detalle de estudio ampliado + escribir al estudio
// Figma 2007:5794 "Invitaciones - Detalle de estudio ampliado" y
//       2007:5795 "Invitaciones - Escribir al estudio" (archivo w3JA83CcP5ISKjyOu87mx1).
// Ruta: /artist/invitations?estudio=<studio_id>[&contactar=1][&solicitar=1]
// Datos: WeotziData.Invitations (invitations-repo.js). El mensaje viaja por la
// RPC contact_studio_as_artist y queda como hilo del Inbox unificado.
// "Trabajo acá / Solicitar alta" (Plataforma de Estudios): drawer con rol,
// sede, fecha, mensaje y portfolio → StudioMemberships.requestMembership; si
// el estudio tiene dueño se le avisa por /api/artist/studio-notify.
// Depende de invitations-model.js y de window.WoInvitationsApp (artist-invitations.js).
// ================================================================

(function () {
    'use strict';

    const M = window.WoInvitationsModel;
    const D = window.WeotziData || {};
    const app = () => window.WoInvitationsApp || {};
    let currentStudioId = null;
    let currentData = null;
    let modalReturnFocus = null;
    let toastTimer = null;

    function esc(value) { return app().escapeHtml ? app().escapeHtml(value) : String(value == null ? '' : value); }
    function icon(name) { return `<i data-wo-icon="${name}" aria-hidden="true"></i>`; }
    function cssUrl(value) { return app().cssUrl ? app().cssUrl(value) : String(value); }
    function href(next) { return app().hrefFor ? app().hrefFor(next) : '?'; }
    // href armados con datos del estudio: solo http(s).
    function safeUrl(value) { return app().safeUrl ? app().safeUrl(value) : M.safeUrl(value); }

    function view() { return document.getElementById('inv-studio-view'); }

    /* ------------------------------ vista ------------------------------ */
    async function show(studioId, options = {}) {
        const host = view();
        if (!host) return;
        const changed = currentStudioId !== studioId;
        currentStudioId = studioId;
        if (changed || !currentData) {
            host.innerHTML = `<a class="isd-back" href="${esc(href({ vista: 'mapa' }))}" data-inv-nav="map">${icon('arrow-left')} Mapa de estudios</a><p class="isd-loading">Cargando estudio…</p>`;
            currentData = await loadStudio(studioId);
            if (currentStudioId !== studioId) return;
        }
        render();
        if (options.contact && currentData && currentData.studio) openContact(contactTargetFromData(currentData));
        else if (options.request && currentData && currentData.studio && canRequest(currentData.studio)) openRequest(null);
    }

    function hide() {
        closeContact({ restoreFocus: false });
        currentStudioId = null;
        currentData = null;
    }

    async function loadStudio(studioId) {
        if (!D.Invitations) return { error: { message: 'No pudimos cargar el estudio.' } };
        const [studioRes, locationsRes, spotsRes, rosterRes] = await Promise.all([
            D.Invitations.getStudio(studioId),
            D.Invitations.listStudioLocations(studioId),
            D.Invitations.listOpenSpotsByStudio(studioId),
            D.Invitations.listStudioRoster(studioId),
        ]);
        if (studioRes.error) return { error: studioRes.error };
        if (!studioRes.data) return { error: { message: 'Este estudio no existe o ya no está publicado.' } };
        return {
            studio: studioRes.data,
            location: (locationsRes.data || [])[0] || null,
            locations: locationsRes.data || [],
            spots: spotsRes.data || [],
            roster: rosterRes.data || [],
        };
    }

    // Se puede pedir el alta si no hay un vínculo abierto con el estudio
    // (solicitud enviada, invitación pendiente o membresía activa).
    function openMembership(studioId) {
        if (app().openMembershipForStudio) return app().openMembershipForStudio(studioId);
        const membership = app().membershipForStudio ? app().membershipForStudio(studioId) : null;
        return membership && ['requested', 'pending', 'active'].includes(membership._state) ? membership : null;
    }

    function canRequest(studio) {
        return !!(studio && studio.id && D.StudioMemberships && typeof D.StudioMemberships.requestMembership === 'function'
            && !openMembership(studio.id));
    }

    function contactTargetFromData(data) {
        const studio = data.studio;
        const opp = M.opportunitiesFor(studio, data.spots);
        return {
            studioId: studio.id,
            studioName: studio.name,
            guestStart: opp.guest.start,
            guestEnd: opp.guest.end,
            reason: opp.guest.open ? 'guest_spot' : opp.resident.open ? 'resident' : 'other',
            hasAccount: studio.user_id === undefined ? true : !!studio.user_id,
            acceptsInquiries: studio.accepts_artist_inquiries !== false,
        };
    }

    function render() {
        const host = view();
        if (!host || !currentData) return;
        const back = `<a class="isd-back" href="${esc(href({ vista: 'mapa', estudio: currentStudioId }))}" data-inv-nav-map-studio="${esc(currentStudioId)}">${icon('arrow-left')} Mapa de estudios</a>`;
        if (currentData.error) {
            host.innerHTML = `${back}<div class="isd-empty"><strong>No pudimos abrir este estudio</strong><p>${esc(currentData.error.message || 'Probá de nuevo en unos minutos.')}</p></div>`;
            wireBack(host);
            return;
        }
        const { studio, location, spots, roster } = currentData;
        const opp = M.opportunitiesFor(studio, spots);
        const membership = app().membershipForStudio ? app().membershipForStudio(studio.id) : null;
        const contact = M.contactSummary(app().contactForStudio ? app().contactForStudio(studio.id) : null);
        const locality = M.text((location && location.locality) || studio.locality);
        const city = M.text((location && location.city) || studio.city);
        const country = M.text((location && location.country) || studio.country);
        const address = M.text((location && location.formatted_address) || studio.formatted_address)
            || [locality, city].filter(Boolean).join(', ');
        const eyebrow = ['Estudio', locality, [city, country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
        const photos = M.studioPhotos(studio);
        const styles = M.studioStyles(studio, roster);
        const languages = M.toList(studio.languages);
        const target = contactTargetFromData(currentData);
        const canWrite = target.hasAccount && target.acceptsInquiries;
        // 2007:5794 muestra "Escribir al estudio" y 2007:5795 (mismo estudio, ya
        // contactado) "Escribir de nuevo": el rótulo sigue al contacto previo.
        const ctaLabel = contact ? 'Escribir de nuevo' : 'Escribir al estudio';
        const website = M.text(studio.website);
        const websiteUrl = website ? safeUrl(/^https?:\/\//i.test(website) ? website : 'https://' + website) : null;
        const instagram = M.text(studio.instagram).replace(/^@/, '');
        const writeButton = (extra) => `<button type="button" class="isd-btn isd-btn--accent ${extra || ''}" data-isd-contact ${canWrite ? '' : 'disabled aria-describedby="isd-contact-note"'}>${icon('message-circle')} ${esc(ctaLabel)}</button>`;
        // Alta pedida por el artista: solo sin un vínculo abierto con el estudio.
        const requestButton = canRequest(studio)
            ? `<button type="button" class="isd-btn" data-isd-request>${icon('user-plus')} Trabajo acá / Solicitar alta</button>`
            : '';
        const isRequestRow = membership && M.initiatedBy(membership) === 'artist';

        const workRows = [
            ['Oportunidades', opp.summary || 'Sin oportunidades abiertas por ahora'],
            opp.guest.dates ? ['Fechas para guests', opp.guest.dates] : null,
            M.numberOrNull(studio.station_count) != null ? ['Espacios', `${studio.station_count} ${Number(studio.station_count) === 1 ? 'puesto' : 'puestos'}`] : null,
            M.toList(studio.equipment).length ? ['Equipamiento', M.toList(studio.equipment)] : null,
            opp.resident.split ? ['Modalidad', opp.resident.split] : null,
            opp.requirements.length ? ['Condiciones y requisitos', opp.requirements] : null,
            ['Consultas', studio.accepts_artist_inquiries === false ? 'No recibe consultas por ahora' : 'Acepta consultas de artistas'],
        ].filter(Boolean);

        host.innerHTML = `
            ${back}
            <div class="isd-hero">
                <div class="isd-hero-text">
                    <span class="isd-eyebrow">${esc(eyebrow)}</span>
                    <h1 class="isd-title">${esc(studio.name || 'Estudio')}</h1>
                    ${studio.tagline ? `<p class="isd-tagline">${esc(studio.tagline)}</p>` : ''}
                    ${opp.guest.open || opp.resident.open ? `<div class="isd-badges">
                        ${opp.guest.open ? '<span class="isd-badge isd-badge--guest">Recibe guest spots</span>' : ''}
                        ${opp.resident.open ? '<span class="isd-badge isd-badge--resident">Busca artista residente</span>' : ''}
                    </div>` : ''}
                    ${address ? `<p class="isd-address">${icon('map-pin')}<span>${esc(address)}</span></p>` : ''}
                    ${membership ? `<div class="isd-invite"><i class="isd-square" aria-hidden="true"></i><span>${esc(M.invitationLine(membership, 'detail'))}</span><a href="${esc(href({ invitacion: membership.id }))}" data-inv-nav="invitation" data-invitation="${esc(membership.id)}">${isRequestRow ? 'Ver solicitud →' : 'Ver invitación →'}</a></div>` : ''}
                    <div class="isd-cta">
                        ${writeButton()}
                        ${requestButton}
                        <a class="isd-maplink" href="${esc(href({ vista: 'mapa', estudio: studio.id }))}" data-inv-nav-map-studio="${esc(studio.id)}">${icon('map-pin')} Ver en el mapa</a>
                    </div>
                    ${canWrite ? '' : `<p class="isd-note" id="isd-contact-note">${esc(target.acceptsInquiries ? 'Este estudio todavía no tiene cuenta en We Ötzi. Escribile por Instagram o por su web.' : 'Este estudio no recibe consultas por ahora.')}</p>`}
                </div>
                <div class="isd-gallery">
                    ${galleryCell(photos[0], `Foto principal de ${studio.name || 'estudio'}`, 'isd-gallery-main')}
                    ${[1, 2, 3].map((index) => galleryCell(photos[index], 'Galería')).join('')}
                </div>
            </div>

            <section class="isd-section" aria-labelledby="isd-s1">
                <h2 class="isd-section-title" id="isd-s1"><span>01</span>Presentación</h2>
                <div class="isd-presentation">
                    <div class="isd-presentation-main">
                        ${studio.bio ? `<p class="isd-bio">${esc(studio.bio)}</p>` : ''}
                        <div class="isd-team">
                            <span class="isd-key isd-team-head">Equipo · ${roster.length} ${roster.length === 1 ? 'artista' : 'artistas'}</span>
                            ${roster.length ? roster.map((artist) => `
                                <div class="isd-team-row">
                                    <span class="isd-team-avatar" aria-hidden="true">${esc(M.initials(artist.name || artist.username))}</span>
                                    ${artist.username ? `<a class="isd-team-name" href="${esc(app().appUrl ? app().appUrl('/artist/profile?artist=' + encodeURIComponent(artist.username)) : '#')}">${esc(artist.name || artist.username)}</a>` : `<span class="isd-team-name">${esc(artist.name || 'Artista')}</span>`}
                                    <span class="isd-team-style">${esc((M.toList(artist.styles_array)[0]) || '')}</span>
                                </div>`).join('') : '<p class="isd-muted">El estudio todavía no publicó su equipo.</p>'}
                        </div>
                    </div>
                    <dl class="isd-facts">
                        ${styles.length ? `<div><dt class="isd-key">Estilos</dt><dd class="isd-chips">${styles.map((style) => `<span class="isd-chip">${esc(style)}</span>`).join('')}</dd></div>` : ''}
                        ${languages.length ? `<div><dt class="isd-key">Idiomas</dt><dd>${esc(languages.join(' · '))}</dd></div>` : ''}
                        ${address ? `<div><dt class="isd-key">Ubicación</dt><dd>${esc(address)}</dd></div>` : ''}
                    </dl>
                </div>
            </section>

            <section class="isd-section" aria-labelledby="isd-s2">
                <h2 class="isd-section-title" id="isd-s2"><span>02</span>Trabajar en este estudio</h2>
                <p class="isd-section-sub">Información publicada por el estudio. Confirmá las condiciones antes de viajar o firmar.</p>
                <dl class="isd-work">
                    ${workRows.map(([key, value]) => `<div><dt class="isd-key">${esc(key)}</dt><dd>${Array.isArray(value) ? value.map((v) => `<span>${esc(v)}</span>`).join('') : `<span>${esc(value)}</span>`}</dd></div>`).join('')}
                </dl>
            </section>

            <section class="isd-contact" aria-labelledby="isd-s3">
                <div class="isd-contact-text">
                    <span class="isd-contact-eyebrow">03 · Contacto</span>
                    <h2 class="isd-contact-title" id="isd-s3">¿Te interesa trabajar acá?</h2>
                    ${contact ? `<p class="isd-contact-sub">${esc(contact.summary)}</p>` : ''}
                </div>
                <div class="isd-contact-actions">
                    ${websiteUrl ? `<a class="isd-contact-link" href="${esc(websiteUrl)}" target="_blank" rel="noopener">${esc(website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''))}</a>` : ''}
                    ${instagram ? `<a class="isd-contact-link" href="https://instagram.com/${encodeURIComponent(instagram)}" target="_blank" rel="noopener">${icon('instagram')}@ ${esc(instagram)}</a>` : ''}
                    ${writeButton()}
                    ${requestButton ? requestButton.replace('class="isd-btn"', 'class="isd-btn isd-btn--on-dark"') : ''}
                </div>
            </section>`;
        host.querySelectorAll('[data-isd-contact]').forEach((button) => {
            button.addEventListener('click', () => openContact(Object.assign(contactTargetFromData(currentData), { trigger: button })));
        });
        host.querySelectorAll('[data-isd-request]').forEach((button) => {
            button.addEventListener('click', () => openRequest(button));
        });
        wireBack(host);
    }

    /* ---------------------- trabajo acá / solicitar alta ---------------------- */
    // Drawer de 380px (mismo patrón que "Solicitar cambios"): rol, sede, fecha
    // propuesta, mensaje y portfolio. Llama a request_studio_membership.
    function openRequest(trigger) {
        if (!currentData || !currentData.studio || !app().openDrawer) return;
        const studio = currentData.studio;
        const opp = M.opportunitiesFor(studio, currentData.spots);
        const defaultRole = opp.guest.open && !opp.resident.open ? 'guest' : 'resident';
        const locations = (currentData.locations || []).filter((location) => location && location.id);
        const today = M.isoDate(new Date());
        app().openDrawer(`
            <aside class="inv-drawer inv-drawer--request" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <button type="button" class="inv-drawer-close" data-drawer-close aria-label="Cerrar">${icon('x')}</button>
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Trabajo acá</h2>
                <p class="inv-change-copy">${esc(`Pedile el alta a ${studio.name || 'este estudio'}. Cuando la apruebe vas a figurar en su equipo.`)}</p>
                <form class="inv-change-form" id="inv-request-form" novalidate>
                    <label class="inv-key" for="inv-request-role">Rol</label>
                    <select class="inv-input" id="inv-request-role" name="role">
                        ${Object.entries(M.REQUEST_ROLES).map(([value, label]) => `<option value="${esc(value)}"${value === defaultRole ? ' selected' : ''}>${esc(label)}</option>`).join('')}
                    </select>
                    <p class="inv-drawer-error" data-error="role" role="alert" hidden></p>
                    ${locations.length ? `
                    <label class="inv-key" for="inv-request-location">Sede</label>
                    <select class="inv-input" id="inv-request-location" name="locationId">
                        <option value="">Sin preferencia</option>
                        ${locations.map((location) => `<option value="${esc(location.id)}">${esc([location.label, location.city].filter(Boolean).join(' · ') || 'Sede')}</option>`).join('')}
                    </select>` : ''}
                    <label class="inv-key" for="inv-request-date">Fecha de inicio propuesta · opcional</label>
                    <input class="inv-input" id="inv-request-date" name="proposedStartDate" type="date" min="${esc(today)}">
                    <p class="inv-drawer-error" data-error="proposedStartDate" role="alert" hidden></p>
                    <label class="inv-key" for="inv-request-message">Mensaje · opcional</label>
                    <textarea class="inv-change-textarea" id="inv-request-message" name="message" maxlength="${M.REQUEST_MESSAGE_MAX}" placeholder="Contale al estudio desde cuándo trabajás ahí o por qué querés sumarte."></textarea>
                    <p class="inv-drawer-error" data-error="message" role="alert" hidden></p>
                    <label class="inv-key" for="inv-request-portfolio">Portfolio · opcional</label>
                    <input class="inv-input" id="inv-request-portfolio" name="portfolioUrl" type="url" inputmode="url" placeholder="https://" autocomplete="url">
                    <p class="inv-drawer-error" data-error="portfolioUrl" role="alert" hidden></p>
                    <p class="inv-drawer-error" data-error="submit" role="alert" hidden></p>
                    <div class="inv-change-actions">
                        <button class="inv-change-submit" type="submit">Solicitar alta ${icon('send')}</button>
                        <button class="inv-aside-btn" type="button" data-drawer-close>Volver</button>
                    </div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-request-form');
        form?.elements.role.focus();
        form?.addEventListener('submit', (event) => { event.preventDefault(); submitRequest(form, studio); });
    }

    function setDrawerError(form, key, message) {
        const node = form.querySelector(`[data-error="${key}"]`);
        if (!node) return;
        node.textContent = message || '';
        node.hidden = !message;
    }

    async function submitRequest(form, studio) {
        const values = {
            role: form.elements.role.value,
            locationId: form.elements.locationId ? form.elements.locationId.value : '',
            proposedStartDate: form.elements.proposedStartDate.value,
            message: form.elements.message.value,
            portfolioUrl: form.elements.portfolioUrl.value,
        };
        const check = M.validateMembershipRequest(values);
        ['role', 'proposedStartDate', 'message', 'portfolioUrl', 'submit'].forEach((key) => setDrawerError(form, key, check.errors[key] || ''));
        if (!check.ok) {
            const first = ['role', 'proposedStartDate', 'message', 'portfolioUrl'].find((key) => check.errors[key]);
            if (first && form.elements[first]) form.elements[first].focus();
            return;
        }
        const submit = form.querySelector('[type="submit"]');
        if (app().setBusy) app().setBusy(submit, true);
        let result;
        try {
            result = await D.StudioMemberships.requestMembership({ studioId: studio.id, ...check.value });
        } catch (error) {
            result = { data: null, error };
        }
        if (app().setBusy) app().setBusy(submit, false);
        if (!result || result.error) {
            setDrawerError(form, 'submit', M.friendlyError(result && result.error, 'No pudimos enviar tu solicitud. Probá de nuevo.'));
            return;
        }
        const data = (Array.isArray(result.data) ? result.data[0] : result.data) || {};
        const membershipId = data.membership_id || null;
        const hasOwner = data.studio_has_owner != null ? data.studio_has_owner === true : !!studio.user_id;
        if (hasOwner && membershipId && app().notifyStudio) {
            app().notifyStudio('membership_request_created', { membership_id: membershipId });
        }
        document.dispatchEvent(new CustomEvent('weotzi:studio-membership-requested', {
            detail: { membershipId, studioId: studio.id, studioHasOwner: hasOwner },
        }));
        const done = hasOwner
            ? `Le enviamos tu solicitud a ${studio.name || 'el estudio'}. Tu alta queda pendiente hasta que la apruebe.`
            : 'Este estudio todavía no está en We Ötzi. Guardamos tu solicitud y la va a ver cuando active su cuenta';
        form.outerHTML = `<div class="inv-drawer-status" role="status">${icon('check-circle')}<div><strong>Solicitud enviada</strong><p>${esc(done)}</p></div></div>
            <button class="inv-aside-btn inv-aside-btn--outline" type="button" data-drawer-close>Volver al estudio</button>`;
        document.querySelectorAll('#inv-drawer-layer [data-drawer-close]').forEach((button) => button.addEventListener('click', () => app().closeDrawer()));
        document.querySelector('#inv-drawer-layer .inv-aside-btn[data-drawer-close]')?.focus();
        if (app().reload) await app().reload();
        if (currentStudioId && String(currentStudioId) === String(studio.id)) render();
    }

    function wireBack(host) {
        host.querySelectorAll('[data-inv-nav-map-studio]').forEach((link) => {
            link.addEventListener('click', (event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                app().navigate({ vista: 'mapa', estudio: link.dataset.invNavMapStudio });
            });
        });
    }

    function galleryCell(photo, label, extra) {
        if (photo) {
            return `<div class="isd-photo ${extra || ''}" style="background-image:url('${cssUrl(photo)}')" role="img" aria-label="${esc(label)}"></div>`;
        }
        return `<div class="isd-photo isd-photo--empty ${extra || ''}">${icon('image')}<span>${esc(label)}</span></div>`;
    }

    /* ------------------------- escribir al estudio ------------------------- */
    function openContact(target) {
        if (!target || !target.studioId) return;
        closeContact({ restoreFocus: false });
        modalReturnFocus = target.trigger instanceof HTMLElement ? target.trigger : document.activeElement;
        const reason = M.REASONS[target.reason] ? target.reason : 'guest_spot';
        const suggestion = target.guestStart && target.guestEnd ? M.rangeLabel(target.guestStart, target.guestEnd) : '';
        const today = M.isoDate(new Date());
        const blocked = target.hasAccount === false || target.acceptsInquiries === false;
        const layer = document.createElement('div');
        layer.className = 'isc-layer';
        layer.id = 'isc-layer';
        layer.innerHTML = `
            <div class="isc-scrim" data-isc-close aria-hidden="true"></div>
            <div class="isc-dialog" role="dialog" aria-modal="true" aria-labelledby="isc-title" tabindex="-1">
                <header class="isc-head">
                    <h2 class="isc-title" id="isc-title">Contactar a ${esc(target.studioName || 'el estudio')}</h2>
                    <button type="button" class="isc-close" data-isc-close aria-label="Cerrar">${icon('x')}</button>
                </header>
                <form class="isc-form" id="isc-form" novalidate>
                    <div class="isc-body">
                        <fieldset class="isc-field">
                            <legend class="isc-label">Motivo</legend>
                            <div class="isc-segmented" role="radiogroup" aria-label="Motivo">
                                ${Object.entries(M.REASONS).map(([value, label]) => `<label class="isc-seg"><input type="radio" name="reason" value="${value}" ${value === reason ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
                            </div>
                        </fieldset>
                        <fieldset class="isc-field isc-field--dates">
                            <legend class="isc-label">Fechas tentativas · opcional</legend>
                            ${suggestion ? `<div class="isc-suggestions"><button type="button" class="isc-suggestion" data-start="${esc(String(target.guestStart).slice(0, 10))}" data-end="${esc(String(target.guestEnd).slice(0, 10))}">${esc(suggestion)}</button></div>` : ''}
                            <div class="isc-dates">
                                <label><span class="wo-sr-only">Desde</span><input type="date" name="start" min="${today}" class="isc-input" aria-label="Desde"></label>
                                <label><span class="wo-sr-only">Hasta</span><input type="date" name="end" min="${today}" class="isc-input" aria-label="Hasta"></label>
                            </div>
                            <p class="isc-error" data-error="dates" hidden></p>
                        </fieldset>
                        <div class="isc-field">
                            <label class="isc-label" for="isc-message">Mensaje *</label>
                            <textarea class="isc-textarea" id="isc-message" name="message" required minlength="${M.MESSAGE_MIN}" maxlength="${M.MESSAGE_MAX}" placeholder="Contales quién sos, qué estilo trabajás y por qué te interesa su estudio." aria-describedby="isc-count"></textarea>
                            <p class="isc-count" id="isc-count">${esc(M.characterCount(''))}</p>
                            <p class="isc-error" data-error="message" hidden></p>
                        </div>
                        <label class="isc-check">
                            <input type="checkbox" name="portfolio" checked>
                            <span class="isc-box" aria-hidden="true">${icon('check')}</span>
                            <span>Incluir el link a mi portfolio</span>
                        </label>
                        ${blocked ? `<p class="isc-error isc-error--block" role="alert">${esc(target.acceptsInquiries === false ? 'Este estudio no recibe consultas por ahora.' : 'Este estudio todavía no tiene cuenta en We Ötzi. Escribile por Instagram o por su web.')}</p>` : ''}
                        <p class="isc-error" data-error="submit" role="alert" hidden></p>
                    </div>
                    <footer class="isc-foot">
                        <button type="button" class="isc-btn" data-isc-close>Cancelar</button>
                        <button type="submit" class="isc-btn isc-btn--accent" ${blocked ? 'disabled' : ''}>Enviar mensaje ${icon('arrow-right')}</button>
                    </footer>
                </form>
            </div>`;
        document.body.appendChild(layer);
        document.body.classList.add('inv-modal-open');
        const form = layer.querySelector('#isc-form');
        const textarea = layer.querySelector('#isc-message');
        const count = layer.querySelector('#isc-count');
        layer.querySelectorAll('[data-isc-close]').forEach((button) => button.addEventListener('click', () => closeContact()));
        layer.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { event.preventDefault(); closeContact(); }
            if (event.key === 'Tab') trapFocus(event, layer);
        });
        textarea.addEventListener('input', () => {
            count.textContent = M.characterCount(textarea.value);
            if (M.text(textarea.value).length >= M.MESSAGE_MIN) {
                setError(form, 'message', '');
                textarea.setAttribute('aria-invalid', 'false');
            }
        });
        layer.querySelector('.isc-suggestion')?.addEventListener('click', (event) => {
            const { start, end } = event.currentTarget.dataset;
            form.elements.start.value = start;
            form.elements.end.value = end;
            event.currentTarget.classList.add('is-active');
        });
        form.addEventListener('submit', (event) => { event.preventDefault(); submitContact(form, target); });
        layer.querySelector('.isc-dialog').focus({ preventScroll: true });
        setTimeout(() => textarea.focus({ preventScroll: true }), 0);
    }

    function trapFocus(event, layer) {
        const focusable = [...layer.querySelectorAll('button:not([disabled]), a[href], textarea, input:not([disabled]), select')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function setError(form, key, message) {
        const node = form.querySelector(`[data-error="${key}"]`);
        if (!node) return;
        node.textContent = message || '';
        node.hidden = !message;
    }

    async function submitContact(form, target) {
        const values = {
            reason: (form.querySelector('input[name="reason"]:checked') || {}).value,
            message: form.elements.message.value,
            startDate: form.elements.start.value,
            endDate: form.elements.end.value,
        };
        const check = M.validateContact(values);
        ['dates', 'message', 'submit'].forEach((key) => setError(form, key, ''));
        form.elements.message.setAttribute('aria-invalid', String(!!check.errors.message));
        if (!check.ok) {
            setError(form, 'dates', check.errors.dates);
            setError(form, 'message', check.errors.message || check.errors.reason);
            (check.errors.message ? form.elements.message : form.elements.start).focus();
            return;
        }
        if (!D.Invitations) { setError(form, 'submit', 'La mensajería con estudios todavía no está disponible.'); return; }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        const result = await D.Invitations.contactStudio({
            studioId: target.studioId,
            reason: values.reason,
            message: check.message,
            startDate: values.startDate || null,
            endDate: values.endDate || null,
            includePortfolio: form.elements.portfolio.checked,
        });
        submit.disabled = false;
        submit.setAttribute('aria-busy', 'false');
        if (result.error || !result.data) {
            setError(form, 'submit', friendlyError(result.error));
            return;
        }
        const threadId = result.data.thread_id || null;
        closeContact();
        if (app().refreshContacts) await app().refreshContacts();
        document.dispatchEvent(new CustomEvent('weotzi:studio-contacted', { detail: { studioId: target.studioId, threadId } }));
        if (currentStudioId && String(currentStudioId) === String(target.studioId)) render();
        toast(`Le escribiste a ${target.studioName || 'el estudio'}. La respuesta llega a tu Inbox.`, threadId);
    }

    function friendlyError(error) {
        if (!error) return 'No pudimos enviar el mensaje. Probá de nuevo.';
        if (error.unavailable) return 'La mensajería con estudios todavía no está disponible. Escribile por Instagram o por su web.';
        const text = String(error.message || '');
        if (/no account/i.test(text)) return 'Este estudio todavía no tiene cuenta en We Ötzi. Escribile por Instagram o por su web.';
        if (/does not accept/i.test(text)) return 'Este estudio no recibe consultas por ahora.';
        if (/too many/i.test(text)) return 'Enviaste muchos mensajes seguidos. Probá de nuevo en un rato.';
        if (/20 characters|too long/i.test(text)) return `El mensaje tiene que tener entre ${M.MESSAGE_MIN} y ${M.MESSAGE_MAX} caracteres.`;
        if (/dates/i.test(text)) return 'Revisá las fechas tentativas.';
        return 'No pudimos enviar el mensaje. Probá de nuevo.';
    }

    function closeContact(options = {}) {
        const layer = document.getElementById('isc-layer');
        if (!layer) return;
        layer.remove();
        document.body.classList.remove('inv-modal-open');
        const url = new URL(window.location.href);
        if (url.searchParams.get('contactar')) {
            url.searchParams.delete('contactar');
            window.history.replaceState(null, '', url);
        }
        if (options.restoreFocus !== false && modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus();
        modalReturnFocus = null;
    }

    function toast(message, threadId) {
        document.querySelector('.isc-toast')?.remove();
        window.clearTimeout(toastTimer);
        const node = document.createElement('div');
        node.className = 'isc-toast';
        node.setAttribute('role', 'status');
        const inbox = app().appUrl ? app().appUrl('/artist/inbox' + (threadId ? '?thread=' + encodeURIComponent(threadId) : '')) : '/artist/inbox';
        node.innerHTML = `<span>${esc(message)}</span><a href="${esc(inbox)}">Ver conversación</a>`;
        document.body.appendChild(node);
        toastTimer = window.setTimeout(() => node.remove(), 7000);
    }

    window.WoInvitationsStudio = { show, hide, openContact, closeContact };
})();
