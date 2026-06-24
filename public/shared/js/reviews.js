(function () {
    'use strict';

    const REVIEW_PAGE_SIZE = 10;
    const REVIEW_TAGS = [
        'Buena higiene',
        'Atencion rapida',
        'Buenos precios',
        'Espacio agradable',
        'Diseno cuidado',
        'Puntualidad',
        'Buena comunicacion',
        'Trabajo profesional'
    ];
    const BLOCKED_TERMS = [
        'puta',
        'mierda',
        'estafa',
        'scam',
        'spam',
        'fake'
    ];

    function getClient() {
        if (window._supabase) return window._supabase;
        if (!window.supabase?.createClient) return null;
        const url = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
        const key = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
        window._supabase = window.supabase.createClient(url, key);
        return window._supabase;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function normalizeList(value) {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (!value) return [];
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed.filter(Boolean);
            } catch (_) {
                return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
            }
        }
        return [];
    }

    function formatStars(rating) {
        const value = Number(rating) || 0;
        return `${'★'.repeat(value)}${'☆'.repeat(Math.max(0, 5 - value))} ${value}`;
    }

    function formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: '2-digit' });
    }

    function initials(name) {
        return String(name || 'R')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || '')
            .join('') || 'R';
    }

    function hasBlockedReviewContent(value) {
        const text = String(value || '').toLowerCase();
        return BLOCKED_TERMS.some((term) => text.includes(term));
    }

    function getProfileDisplayName(client) {
        return client?.public_username || client?.full_name || client?.email?.split('@')[0] || 'Cliente';
    }

    function isClientProfileComplete(client) {
        return Boolean(
            client
            && String(client.full_name || '').trim()
            && String(client.public_username || '').trim()
            && String(client.country || '').trim()
        );
    }

    function renderSummary(summary) {
        const count = Number(summary?.review_count || 0);
        const average = count ? Number(summary?.average_rating || 0).toFixed(1) : '0.0';
        return `
            <div class="reviews-summary">
                <strong>${average}</strong>
                <span>${count} resena${count === 1 ? '' : 's'}</span>
            </div>
        `;
    }

    function renderFilters(activeRating) {
        const buttons = ['all', 5, 4, 3, 2, 1].map((value) => {
            const active = String(activeRating || 'all') === String(value);
            const label = value === 'all' ? 'Todas' : `${value} estrellas`;
            return `<button type="button" class="review-filter-btn ${active ? 'is-active' : ''}" data-review-rating="${value}">${label}</button>`;
        }).join('');
        return `<div class="reviews-controls" aria-label="Filtrar resenas por calificacion">${buttons}</div>`;
    }

    function renderTags(tags) {
        if (!tags.length) return '<div class="reviews-tags"><span class="review-tag-chip">Sin tags frecuentes</span></div>';
        return `
            <div class="reviews-tags" aria-label="Tags frecuentes">
                ${tags.slice(0, 10).map((row) => `
                    <span class="review-tag-chip">${escapeHtml(row.tag)} <strong>${Number(row.tag_count || 0)}</strong></span>
                `).join('')}
            </div>
        `;
    }

    function renderReviewCard(review, responseActor) {
        const name = review.reviewer_username || review.reviewer_display_name || 'Cliente';
        const avatar = review.reviewer_avatar_url
            ? `<img src="${escapeAttr(review.reviewer_avatar_url)}" alt="">`
            : `<span>${escapeHtml(initials(name))}</span>`;
        const photos = normalizeList(review.photo_urls);
        const tags = normalizeList(review.tags);
        const response = review.response_status === 'approved' && review.response_comment
            ? `<div class="review-response">
                    <span class="review-response-label">Respuesta</span>
                    <p>${escapeHtml(review.response_comment)}</p>
                </div>`
            : '';
        const responseAction = responseActor && !review.response_comment
            ? `<div class="review-completion-actions" style="margin-top:1rem;">
                    <button type="button" class="review-write-btn" data-review-response="${escapeAttr(review.id)}">Responder</button>
                </div>`
            : '';
        const responsePending = responseActor && review.response_comment && review.response_status === 'pending'
            ? '<div class="review-response"><span class="review-response-label">Respuesta pendiente de soporte</span></div>'
            : '';

        return `
            <article class="review-card">
                <header class="review-card-header">
                    <div class="review-avatar">${avatar}</div>
                    <div>
                        <h3 class="review-card-name">${escapeHtml(name)}</h3>
                        <div class="review-card-country">${escapeHtml(review.reviewer_country || 'Pais no indicado')}</div>
                    </div>
                    <div>
                        <div class="review-stars" aria-label="${Number(review.rating)} de 5 estrellas">${formatStars(review.rating)}</div>
                        <div class="review-card-date">${formatDate(review.created_at)}</div>
                    </div>
                </header>
                <div class="review-card-body">
                    <p class="review-card-comment">${escapeHtml(review.comment)}</p>
                    ${tags.length ? `<div class="reviews-tags">${tags.map((tag) => `<span class="review-tag-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                    ${photos.length ? `<div class="review-photo-grid">${photos.map((url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" style="background-image:url('${escapeAttr(url)}')" aria-label="Foto de la resena"></a>`).join('')}</div>` : ''}
                    ${response}
                    ${responsePending}
                    ${responseAction}
                </div>
            </article>
        `;
    }

    function renderPagination(page, total) {
        const totalPages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
        if (totalPages <= 1) return '';
        return `
            <div class="reviews-pagination" aria-label="Paginacion de resenas">
                <button type="button" class="review-page-btn" data-review-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
                <span class="review-tag-chip">Pagina ${page} de ${totalPages}</span>
                <button type="button" class="review-page-btn" data-review-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Siguiente</button>
            </div>
        `;
    }

    async function renderPublicReviews(options) {
        const mount = typeof options.mount === 'string' ? document.getElementById(options.mount) : options.mount;
        if (!mount) return;

        const revieweeType = options.revieweeType;
        const revieweeId = options.revieweeId;
        const title = options.title || 'Resenas verificadas';
        const client = getClient();
        const state = {
            page: Number(options.page || 1),
            rating: options.rating || 'all'
        };
        const responseActor = await getResponseActor(revieweeType, revieweeId);

        if (!client || !revieweeType || !revieweeId) {
            mount.innerHTML = '<div class="reviews-empty">No se pudo cargar la reputacion publica.</div>';
            return;
        }

        async function load() {
            mount.innerHTML = '<div class="reviews-shell"><div class="reviews-empty">Cargando resenas...</div></div>';
            const from = (state.page - 1) * REVIEW_PAGE_SIZE;
            const to = from + REVIEW_PAGE_SIZE - 1;

            let query = WeotziData
                .from('verified_reviews')
                .select('id, reviewer_display_name, reviewer_username, reviewer_country, reviewer_avatar_url, rating, comment, tags, photo_urls, response_comment, response_status, created_at', { count: 'exact' })
                .eq('reviewee_type', revieweeType)
                .eq('reviewee_user_id', revieweeId)
                .eq('moderation_status', 'approved')
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .range(from, to);

            if (state.rating !== 'all') {
                query = query.eq('rating', Number(state.rating));
            }

            const [reviewsResult, summaryResult, tagsResult] = await Promise.all([
                query,
                WeotziData
                    .from('public_review_summary')
                    .select('*')
                    .eq('reviewee_type', revieweeType)
                    .eq('reviewee_user_id', revieweeId)
                    .maybeSingle(),
                WeotziData
                    .from('public_review_tag_counts')
                    .select('tag, tag_count')
                    .eq('reviewee_type', revieweeType)
                    .eq('reviewee_user_id', revieweeId)
                    .order('tag_count', { ascending: false })
                    .limit(10)
            ]);

            if (reviewsResult.error) {
                mount.innerHTML = `<div class="reviews-shell"><div class="reviews-error">${escapeHtml(reviewsResult.error.message)}</div></div>`;
                return;
            }

            const reviews = reviewsResult.data || [];
            const total = reviewsResult.count || 0;
            const tags = tagsResult.data || [];
            const summary = summaryResult.data || { review_count: 0, average_rating: 0 };

            mount.innerHTML = `
                <section class="reviews-shell" aria-label="${escapeAttr(title)}">
                    <div class="reviews-heading">
                        <div>
                            <p class="reviews-kicker">Reputacion publica</p>
                            <h2 class="reviews-title">${escapeHtml(title)}</h2>
                        </div>
                        ${renderSummary(summary)}
                    </div>
                    ${renderFilters(state.rating)}
                    ${renderTags(tags)}
                    <div class="reviews-list">
                        ${reviews.length ? reviews.map((review) => renderReviewCard(review, responseActor)).join('') : '<div class="reviews-empty">No hay resenas aprobadas para este filtro.</div>'}
                    </div>
                    ${renderPagination(state.page, total)}
                </section>
            `;

            mount.querySelectorAll('[data-review-rating]').forEach((button) => {
                button.addEventListener('click', () => {
                    state.rating = button.dataset.reviewRating;
                    state.page = 1;
                    void load();
                });
            });

            mount.querySelectorAll('[data-review-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    const nextPage = Number(button.dataset.reviewPage);
                    if (!nextPage || nextPage < 1) return;
                    state.page = nextPage;
                    void load();
                });
            });

            mount.querySelectorAll('[data-review-response]').forEach((button) => {
                button.addEventListener('click', () => {
                    openReviewResponseModal(button.dataset.reviewResponse, load);
                });
            });
        }

        await load();
    }

    async function getResponseActor(revieweeType, revieweeId) {
        const client = getClient();
        if (!client || !revieweeType || !revieweeId) return null;
        try {
            const { data: authData } = await client.auth.getSession();
            const session = authData?.session;
            if (!session) return null;

            if (revieweeType === 'studio') {
                const { data: studio } = await WeotziData.Studios.getOwnedByUser(revieweeId, session.user.id, 'id,user_id');
                return studio ? { userId: session.user.id, revieweeType } : null;
            }

            return revieweeId === session.user.id ? { userId: session.user.id, revieweeType } : null;
        } catch (_) {
            return null;
        }
    }

    async function fetchReviewerProfile(reviewerType) {
        const client = getClient();
        if (!client) return { session: null, profile: null, error: new Error('Supabase no disponible') };

        const { data: authData, error: authError } = await client.auth.getSession();
        const session = authData?.session;
        if (authError || !session) return { session: null, profile: null, error: authError || new Error('Sesion requerida') };

        if (reviewerType === 'artist') {
            const { data: profile, error } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id,email,username,name,country,city,profile_picture');
            return {
                session,
                profile,
                reviewerUserId: profile?.user_id,
                reviewerDisplayName: profile?.username || profile?.name || session.user.email,
                reviewerUsername: profile?.username || null,
                reviewerCountry: profile?.country || profile?.city || null,
                reviewerAvatarUrl: profile?.profile_picture || null,
                error
            };
        }

        if (reviewerType === 'studio') {
            const { data: profile, error } = await WeotziData.Studios.getByOwnerUserId(session.user.id, 'id,user_id,slug,name,logo_image,country');
            return {
                session,
                profile,
                reviewerUserId: profile?.id,
                reviewerDisplayName: profile?.slug || profile?.name || session.user.email,
                reviewerUsername: profile?.slug || null,
                reviewerCountry: profile?.country || null,
                reviewerAvatarUrl: profile?.logo_image || null,
                error
            };
        }

        const { data: profile, error } = await WeotziData
            .from('clients_db')
            .select('user_id,email,full_name,public_username,country,city_residence,profile_picture,profile_completed_at')
            .eq('user_id', session.user.id)
            .maybeSingle();

        return {
            session,
            profile,
            reviewerUserId: profile?.user_id,
            reviewerDisplayName: getProfileDisplayName(profile),
            reviewerUsername: profile?.public_username || null,
            reviewerCountry: profile?.country || profile?.city_residence || null,
            reviewerAvatarUrl: profile?.profile_picture || null,
            error
        };
    }

    function closeReviewModal() {
        const modal = document.getElementById('review-modal-root');
        if (modal) modal.remove();
        document.body.style.overflow = '';
    }

    function parsePhotoUrls(value) {
        return String(value || '')
            .split(/\n|,/)
            .map((item) => item.trim())
            .filter(Boolean)
            .filter((url) => /^https?:\/\//i.test(url));
    }

    async function openReviewModal(options) {
        const reviewerType = options.reviewerType || 'client';
        const {
            session,
            profile,
            reviewerUserId,
            reviewerDisplayName,
            reviewerUsername,
            reviewerCountry,
            reviewerAvatarUrl,
            error
        } = await fetchReviewerProfile(reviewerType);
        if (error || !session) {
            const loginPath = reviewerType === 'artist'
                ? '/artist/login'
                : reviewerType === 'studio'
                    ? '/studio/login'
                    : '/client/login';
            window.location.href = `${loginPath}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            return;
        }

        if (!reviewerUserId) {
            window.alert?.('No encontramos un perfil valido para dejar esta resena.');
            return;
        }

        if (reviewerType === 'client' && !isClientProfileComplete(profile)) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="review-modal-overlay" id="review-modal-root">
                    <div class="review-modal" role="dialog" aria-modal="true">
                        <div class="review-modal-header">
                            <div>
                                <p class="review-modal-kicker">Perfil requerido</p>
                                <h2 class="review-modal-title">Completa tu perfil publico</h2>
                            </div>
                            <button class="review-modal-close" type="button" data-review-close>&times;</button>
                        </div>
                        <div class="review-profile-gate" style="margin-top:1rem;">
                            Para dejar resenas necesitas nombre, alias publico y pais.
                        </div>
                        <div class="review-modal-actions" style="margin-top:1rem;">
                            <button class="review-modal-submit" type="button" data-review-edit-profile>Editar perfil</button>
                        </div>
                    </div>
                </div>
            `);
            document.querySelectorAll('[data-review-close]').forEach((button) => button.addEventListener('click', closeReviewModal));
            document.querySelector('[data-review-edit-profile]')?.addEventListener('click', () => {
                closeReviewModal();
                if (typeof window.openEditProfileModal === 'function') window.openEditProfileModal();
                else window.location.href = '/client/dashboard';
            });
            return;
        }

        const tagOptions = REVIEW_TAGS.map((tag, index) => `
            <label>
                <input type="checkbox" value="${escapeAttr(tag)}" ${index < 2 ? '' : ''}>
                <span>${escapeHtml(tag)}</span>
            </label>
        `).join('');

        document.body.insertAdjacentHTML('beforeend', `
            <div class="review-modal-overlay" id="review-modal-root">
                <div class="review-modal" role="dialog" aria-modal="true">
                    <div class="review-modal-header">
                        <div>
                            <p class="review-modal-kicker">Resena verificada</p>
                            <h2 class="review-modal-title">${escapeHtml(options.title || 'Calificar experiencia')}</h2>
                        </div>
                        <button class="review-modal-close" type="button" data-review-close>&times;</button>
                    </div>
                    <form class="review-form" id="review-form">
                        <div class="review-field">
                            <label for="review-rating">Calificacion</label>
                            <select id="review-rating" required>
                                <option value="5">5 estrellas</option>
                                <option value="4">4 estrellas</option>
                                <option value="3">3 estrellas</option>
                                <option value="2">2 estrellas</option>
                                <option value="1">1 estrella</option>
                            </select>
                        </div>
                        <div class="review-field">
                            <label for="review-comment">Comentario</label>
                            <textarea id="review-comment" rows="5" minlength="3" maxlength="2000" required placeholder="Cuenta como fue la experiencia"></textarea>
                        </div>
                        <div class="review-field">
                            <label>Que destacarias</label>
                            <div class="review-tag-options">${tagOptions}</div>
                        </div>
                        <div class="review-field">
                            <label for="review-photos">Fotos opcionales</label>
                            <textarea id="review-photos" rows="2" placeholder="Pega URLs de fotos, una por linea"></textarea>
                        </div>
                        <div class="reviews-error" id="review-form-error" hidden></div>
                        <div class="review-modal-actions">
                            <button type="button" class="review-modal-cancel" data-review-close>Cancelar</button>
                            <button type="submit" class="review-modal-submit">Enviar a moderacion</button>
                        </div>
                    </form>
                </div>
            </div>
        `);

        document.body.style.overflow = 'hidden';
        document.querySelectorAll('[data-review-close]').forEach((button) => button.addEventListener('click', closeReviewModal));

        document.getElementById('review-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const errorEl = document.getElementById('review-form-error');
            const submitBtn = event.currentTarget.querySelector('.review-modal-submit');
            const comment = document.getElementById('review-comment')?.value.trim() || '';

            if (hasBlockedReviewContent(comment)) {
                errorEl.hidden = false;
                errorEl.textContent = 'El comentario contiene palabras bloqueadas. Editalo antes de enviarlo.';
                return;
            }

            const tags = Array.from(document.querySelectorAll('.review-tag-options input:checked')).map((input) => input.value);
            const photoUrls = parsePhotoUrls(document.getElementById('review-photos')?.value);
            const payload = {
                context_type: options.contextType,
                reviewer_type: reviewerType,
                reviewer_user_id: reviewerUserId,
                reviewer_display_name: reviewerDisplayName || 'Usuario',
                reviewer_username: reviewerUsername || null,
                reviewer_country: reviewerCountry || null,
                reviewer_avatar_url: reviewerAvatarUrl || null,
                reviewee_type: options.revieweeType,
                reviewee_user_id: options.revieweeUserId,
                reviewee_display_name: options.revieweeDisplayName || null,
                rating: Number(document.getElementById('review-rating')?.value || 5),
                comment,
                tags,
                photo_urls: photoUrls,
                moderation_status: 'pending'
            };

            if (options.contextType === 'quotation') payload.quotation_id = options.contextId;
            if (options.contextType === 'studio_job') payload.studio_job_id = options.contextId;
            if (options.contextType === 'studio_membership') payload.studio_membership_id = options.contextId;
            if (options.contextType === 'studio_spot_application') payload.studio_spot_application_id = options.contextId;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Enviando...';

            const client = getClient();
            const { error: insertError } = await WeotziData.from('verified_reviews').insert(payload);
            if (insertError) {
                errorEl.hidden = false;
                errorEl.textContent = insertError.code === '23505'
                    ? 'Ya existe una resena para esta relacion.'
                    : insertError.message;
                submitBtn.disabled = false;
                submitBtn.textContent = 'Enviar a moderacion';
                return;
            }

            closeReviewModal();
            window.alert?.('Resena enviada. Soporte la revisara antes de publicarla.');
            if (typeof options.onSubmitted === 'function') options.onSubmitted();
        });
    }

    function openReviewResponseModal(reviewId, onSubmitted) {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="review-modal-overlay" id="review-response-modal-root">
                <div class="review-modal" role="dialog" aria-modal="true">
                    <div class="review-modal-header">
                        <div>
                            <p class="review-modal-kicker">Respuesta publica</p>
                            <h2 class="review-modal-title">Responder resena</h2>
                        </div>
                        <button class="review-modal-close" type="button" data-review-response-close>&times;</button>
                    </div>
                    <form class="review-form" id="review-response-form">
                        <div class="review-field">
                            <label for="review-response-comment">Respuesta</label>
                            <textarea id="review-response-comment" rows="4" minlength="3" maxlength="1200" required></textarea>
                        </div>
                        <div class="reviews-error" id="review-response-error" hidden></div>
                        <div class="review-modal-actions">
                            <button type="button" class="review-modal-cancel" data-review-response-close>Cancelar</button>
                            <button type="submit" class="review-modal-submit">Enviar a moderacion</button>
                        </div>
                    </form>
                </div>
            </div>
        `);

        const close = () => {
            document.getElementById('review-response-modal-root')?.remove();
        };
        document.querySelectorAll('[data-review-response-close]').forEach((button) => button.addEventListener('click', close));
        document.getElementById('review-response-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const comment = document.getElementById('review-response-comment')?.value.trim() || '';
            const errorEl = document.getElementById('review-response-error');

            if (hasBlockedReviewContent(comment)) {
                errorEl.hidden = false;
                errorEl.textContent = 'La respuesta contiene palabras bloqueadas.';
                return;
            }

            const client = getClient();
            const { data: authData } = await client.auth.getSession();
            const session = authData?.session;
            const { error } = await WeotziData
                .from('verified_reviews')
                .update({
                    response_comment: comment,
                    response_by_user_id: session?.user?.id || null,
                    response_status: 'pending',
                    response_created_at: new Date().toISOString(),
                    response_updated_at: new Date().toISOString()
                })
                .eq('id', reviewId);

            if (error) {
                errorEl.hidden = false;
                errorEl.textContent = error.message;
                return;
            }

            close();
            window.alert?.('Respuesta enviada. Soporte la revisara antes de publicarla.');
            if (typeof onSubmitted === 'function') onSubmitted();
        });
    }

    window.WeOtziReviews = {
        REVIEW_PAGE_SIZE,
        REVIEW_TAGS,
        renderPublicReviews,
        openReviewModal,
        openReviewResponseModal,
        isClientProfileComplete,
        hasBlockedReviewContent,
        escapeHtml,
        formatStars
    };
})();
