const feedSupabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const feedSupabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const feedSupabase = (window._supabase = window._supabase || supabase.createClient(feedSupabaseUrl, feedSupabaseKey));

const FEED_CATEGORIES = ['realizados', 'flash', 'proyectos'];
const FEED_CATEGORY_LABELS = {
    realizados: 'Realizado',
    flash: 'Flash',
    proyectos: 'Proyecto'
};

const FEED_THEME_STORAGE_KEY = 'weotzi:artist-gallery:theme';
const PROFILE_MOBILE_MENU_BREAKPOINT = 768;

let feedArtist = null;
let allFeedItems = [];
let activeCategory = 'realizados';
let visibleCategoryItems = [];
let lightboxIndex = 0;

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isUrlVideo(url) {
    const ext = String(url || '').split('?')[0].split('.').pop()?.toLowerCase();
    return ext === 'mp4' || ext === 'mov' || ext === 'webm' || ext === 'm4v';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeCategory(rawCategory) {
    const raw = String(rawCategory || '').trim().toLowerCase();
    if (!raw) return 'realizados';

    if (['realizados', 'realizado', 'completed', 'trabajos', 'trabajo'].includes(raw)) {
        return 'realizados';
    }
    if (['flash', 'flash_disponibles', 'available_flash'].includes(raw)) {
        return 'flash';
    }
    if (['proyectos', 'proyecto', 'projects', 'project'].includes(raw)) {
        return 'proyectos';
    }

    return 'realizados';
}

function normalizeUsernameFromUrl(username) {
    if (!username) return '';
    return username.endsWith('.wo') ? username : `${username}.wo`;
}

function sanitizeArtistHandle(value) {
    return String(value || '')
        .trim()
        .replace(/^@+/, '')
        .replace(/\/+$/, '');
}

function readArtistQueryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const artist = params.get('artist');
    const short = params.get('u');
    return sanitizeArtistHandle(artist || short || '');
}

function getQuotationUrlWithArtist(username) {
    return `/quotations?artist=${encodeURIComponent(username || '')}`;
}

function maybeMissingAnyColumnError(error, columnNames) {
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
    if (!text.includes('column')) return false;

    return columnNames.some((columnName) => text.includes(String(columnName).toLowerCase()));
}

async function queryArtistByUsername(username, fields) {
    const exactResponse = await feedSupabase
        .from('artists_db')
        .select(fields)
        .eq('username', username)
        .limit(1);

    if (!exactResponse.error) {
        return {
            data: Array.isArray(exactResponse.data) ? exactResponse.data[0] || null : null,
            error: null
        };
    }

    const fallbackResponse = await feedSupabase
        .from('artists_db')
        .select(fields)
        .ilike('username', username)
        .limit(1);

    return {
        data: Array.isArray(fallbackResponse.data) ? fallbackResponse.data[0] || null : null,
        error: fallbackResponse.error
    };
}

async function fetchArtistForFeed() {
    const selectLevels = [
        'username,name,profile_picture,bio_description,gallery_images,gallery_feed_items',
        'username,name,profile_picture,bio_description,gallery_images',
        'username,name,profile_picture,gallery_images'
    ];

    const rawQuery = readArtistQueryFromUrl();
    const normalized = normalizeUsernameFromUrl(rawQuery);
    const withoutSuffix = rawQuery.endsWith('.wo') ? rawQuery.slice(0, -3) : rawQuery;
    const lowerQuery = rawQuery.toLowerCase();
    const lowerWithoutSuffix = withoutSuffix.toLowerCase();
    const lowerNormalized = normalizeUsernameFromUrl(lowerWithoutSuffix);

    const candidates = Array.from(new Set([
        normalized,
        rawQuery,
        withoutSuffix,
        lowerNormalized,
        lowerQuery,
        lowerWithoutSuffix
    ].filter(Boolean)));

    if (!candidates.length) return null;

    for (const candidate of candidates) {
        for (const fields of selectLevels) {
            const response = await queryArtistByUsername(candidate, fields);
            if (!response.error && response.data) return response.data;

            if (response.error && maybeMissingAnyColumnError(response.error, ['gallery_feed_items', 'bio_description'])) {
                continue;
            }

            // Candidate exists without errors but no row found.
            if (!response.error && !response.data) {
                break;
            }

            // For non-column errors, stop fallback attempts for this candidate.
            if (response.error) {
                break;
            }
        }
    }

    return null;
}

function normalizeFeedItems(artist) {
    const normalized = [];
    const seenUrls = new Set();

    const feedItems = parseJsonArray(artist?.gallery_feed_items);
    for (const rawItem of feedItems) {
        const url = String(rawItem?.url || '').trim();
        if (!url || seenUrls.has(url)) continue;

        const category = normalizeCategory(rawItem?.category);
        const kind = rawItem?.kind === 'video' || isUrlVideo(url) ? 'video' : 'image';
        normalized.push({
            url,
            category,
            kind,
            created_at: rawItem?.created_at || ''
        });
        seenUrls.add(url);
    }

    if (!normalized.length) {
        const legacy = parseJsonArray(artist?.gallery_images);
        for (const entry of legacy) {
            const url = typeof entry === 'string' ? entry.trim() : String(entry?.url || '').trim();
            if (!url || seenUrls.has(url)) continue;

            normalized.push({
                url,
                category: 'realizados',
                kind: isUrlVideo(url) ? 'video' : 'image',
                created_at: ''
            });
            seenUrls.add(url);
        }
    }

    return normalized;
}

function normalizeBioText(rawValue) {
    const fallback = 'Este artista todavía no agregó una bio pública.';
    if (rawValue == null) return fallback;

    if (window.BioFormatting) {
        return window.BioFormatting.bioHtmlToPlainText(rawValue) || fallback;
    }

    const html = String(rawValue);
    if (!html.trim()) return fallback;

    const withBreakHints = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n');

    const parser = document.createElement('div');
    parser.innerHTML = withBreakHints;
    const text = (parser.textContent || parser.innerText || html)
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return text || fallback;
}

function updateArtistSummary() {
    const username = feedArtist?.username || '';
    const quoteUrl = getQuotationUrlWithArtist(username);

    const artistNameEl = document.getElementById('artist-name');
    const artistUsernameEl = document.getElementById('artist-username');
    const artistBioEl = document.getElementById('artist-bio');

    if (artistNameEl) artistNameEl.textContent = feedArtist?.name || 'Artista';
    if (artistUsernameEl) artistUsernameEl.textContent = `@${username || 'artista.wo'}`;
    if (artistBioEl) {
        if (window.BioFormatting) {
            window.BioFormatting.renderBioHtml(artistBioEl, feedArtist?.bio_description, {
                emptyMessage: 'Este artista todavia no agrego una bio publica.'
            });
        } else {
            artistBioEl.textContent = normalizeBioText(feedArtist?.bio_description);
        }
    }

    const avatar = document.getElementById('artist-avatar');
    const avatarFallback = document.getElementById('artist-avatar-fallback');
    const avatarUrl = String(feedArtist?.profile_picture || '').trim();

    if (avatar && avatarUrl) {
        avatar.src = avatarUrl;
        avatar.style.display = 'block';
        if (avatarFallback) avatarFallback.style.display = 'none';
    } else {
        if (avatar) avatar.style.display = 'none';
        if (avatarFallback) {
            avatarFallback.style.display = 'flex';
            avatarFallback.textContent = (feedArtist?.name || 'WO').slice(0, 2).toUpperCase();
        }
    }

    const headerQuote = document.getElementById('profile-header-quote-link');
    const mobileQuote = document.getElementById('profile-mobile-quote-link');
    if (headerQuote) headerQuote.href = quoteUrl;
    if (mobileQuote) mobileQuote.href = quoteUrl;

    document.getElementById('stat-total').textContent = String(allFeedItems.length);
    document.getElementById('stat-realizados').textContent = String(allFeedItems.filter((item) => item.category === 'realizados').length);
    document.getElementById('stat-flash').textContent = String(allFeedItems.filter((item) => item.category === 'flash').length);
    document.getElementById('stat-proyectos').textContent = String(allFeedItems.filter((item) => item.category === 'proyectos').length);

    const ogTitle = document.getElementById('og-title');
    const ogDescription = document.getElementById('og-description');
    const ogImage = document.getElementById('og-image');
    if (ogTitle) ogTitle.content = `${feedArtist?.name || 'Artista'} · Galeria en We Otzi`;
    if (ogDescription) ogDescription.content = normalizeBioText(feedArtist?.bio_description);

    const firstImage = allFeedItems.find((item) => item.kind === 'image');
    if (ogImage && firstImage) ogImage.content = firstImage.url;
}

function renderTabs() {
    document.querySelectorAll('.feed-tab').forEach((tabBtn) => {
        const tabCategory = tabBtn.dataset.category;
        const isActive = tabCategory === activeCategory;
        tabBtn.classList.toggle('is-active', isActive);
        tabBtn.setAttribute('aria-selected', String(isActive));
    });
}

function renderFeedGrid() {
    const grid = document.getElementById('feed-grid');
    const empty = document.getElementById('feed-empty');
    if (!grid || !empty) return;

    visibleCategoryItems = allFeedItems.filter((item) => item.category === activeCategory);

    if (!visibleCategoryItems.length) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';

    grid.innerHTML = visibleCategoryItems.map((item, index) => {
        const mediaHtml = item.kind === 'video'
            ? `<video src="${escapeHtml(item.url)}" preload="metadata" muted playsinline></video>`
            : `<img src="${escapeHtml(item.url)}" alt="Trabajo ${index + 1}" loading="lazy" width="1200" height="1200">`;

        return `
            <button type="button" class="feed-item" data-feed-index="${index}" data-category="${escapeHtml(item.category)}" aria-label="Abrir ${escapeHtml(FEED_CATEGORY_LABELS[item.category] || 'Trabajo')} ${index + 1}">
                ${mediaHtml}
                <span class="feed-item-badge">${escapeHtml(FEED_CATEGORY_LABELS[item.category] || 'Trabajo')}</span>
                <span class="feed-item-index">${String(index + 1).padStart(2, '0')}</span>
            </button>
        `;
    }).join('');
}

function setActiveCategory(category) {
    activeCategory = FEED_CATEGORIES.includes(category) ? category : 'realizados';
    renderTabs();
    renderFeedGrid();
}

function openLightbox(startIndex) {
    if (!visibleCategoryItems.length) return;
    lightboxIndex = startIndex;

    const lightbox = document.getElementById('feed-lightbox');
    if (!lightbox) return;

    renderLightboxMedia();
    lightbox.classList.add('active');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('feed-lightbox');
    const video = document.getElementById('feed-lightbox-video');
    if (!lightbox || !video) return;

    video.pause();
    video.removeAttribute('src');
    video.load();

    lightbox.classList.remove('active');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function navigateLightbox(step) {
    if (!visibleCategoryItems.length) return;

    lightboxIndex += step;
    if (lightboxIndex < 0) lightboxIndex = visibleCategoryItems.length - 1;
    if (lightboxIndex >= visibleCategoryItems.length) lightboxIndex = 0;

    renderLightboxMedia();
}

function renderLightboxMedia() {
    const item = visibleCategoryItems[lightboxIndex];
    if (!item) return;

    const image = document.getElementById('feed-lightbox-image');
    const video = document.getElementById('feed-lightbox-video');
    const counter = document.getElementById('feed-lightbox-counter');
    if (!image || !video || !counter) return;

    if (item.kind === 'video') {
        image.style.display = 'none';
        image.removeAttribute('src');

        video.style.display = 'block';
        video.src = item.url;
        video.load();
    } else {
        video.pause();
        video.style.display = 'none';
        video.removeAttribute('src');
        video.load();

        image.style.display = 'block';
        image.src = item.url;
    }

    counter.textContent = `${lightboxIndex + 1} / ${visibleCategoryItems.length}`;
}

function setProfileMobileMenuOpen(isOpen) {
    const toggleBtn = document.getElementById('profile-mobile-menu-toggle');
    const menu = document.getElementById('profile-mobile-menu');
    if (!toggleBtn || !menu) return;

    const shouldOpen = Boolean(isOpen);
    menu.hidden = !shouldOpen;
    toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
}

function setupProfileNavigationMenu() {
    const toggleBtn = document.getElementById('profile-mobile-menu-toggle');
    const menu = document.getElementById('profile-mobile-menu');
    if (!toggleBtn || !menu) return;
    if (toggleBtn.dataset.menuBound === 'true') return;

    setProfileMobileMenuOpen(false);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
        setProfileMobileMenuOpen(shouldOpen);
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            setProfileMobileMenuOpen(false);
        });
    });

    document.addEventListener('click', (event) => {
        if (menu.hidden) return;
        const clickInsideMenu = menu.contains(event.target);
        const clickOnToggle = toggleBtn.contains(event.target);
        if (!clickInsideMenu && !clickOnToggle) {
            setProfileMobileMenuOpen(false);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > PROFILE_MOBILE_MENU_BREAKPOINT) {
            setProfileMobileMenuOpen(false);
        }
    });

    toggleBtn.dataset.menuBound = 'true';
}

function getStoredTheme() {
    try {
        return localStorage.getItem(FEED_THEME_STORAGE_KEY);
    } catch {
        return null;
    }
}

function persistTheme(theme) {
    try {
        localStorage.setItem(FEED_THEME_STORAGE_KEY, theme);
    } catch {
        // ignore persistence errors
    }
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    persistTheme(isDark ? 'dark' : 'light');
}

function initTheme() {
    const stored = getStoredTheme();
    if (stored === 'dark' || stored === 'light') {
        applyTheme(stored);
        return;
    }

    const prefersDark = Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(prefersDark ? 'dark' : 'light');
}

function toggleTheme() {
    const nextTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    applyTheme(nextTheme);
}

window.toggleTheme = toggleTheme;

function bindEvents() {
    setupProfileNavigationMenu();

    document.querySelectorAll('.feed-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
            setActiveCategory(tabBtn.dataset.category || 'realizados');
        });
    });

    document.getElementById('feed-grid')?.addEventListener('click', (event) => {
        const card = event.target.closest('[data-feed-index]');
        if (!card) return;

        const index = Number(card.dataset.feedIndex);
        if (!Number.isInteger(index)) return;

        openLightbox(index);
    });

    document.getElementById('feed-lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('feed-lightbox-prev')?.addEventListener('click', () => navigateLightbox(-1));
    document.getElementById('feed-lightbox-next')?.addEventListener('click', () => navigateLightbox(1));

    document.getElementById('feed-lightbox')?.addEventListener('click', (event) => {
        if (event.target.id === 'feed-lightbox') closeLightbox();
    });

    document.addEventListener('keydown', (event) => {
        const lightbox = document.getElementById('feed-lightbox');
        if (!lightbox?.classList.contains('active')) return;

        if (event.key === 'Escape') closeLightbox();
        if (event.key === 'ArrowLeft') navigateLightbox(-1);
        if (event.key === 'ArrowRight') navigateLightbox(1);
    });
}

function showLoading() {
    document.getElementById('feed-loading').style.display = 'flex';
    document.getElementById('feed-error').style.display = 'none';
    document.getElementById('feed-content').style.display = 'none';
}

function showError() {
    document.getElementById('feed-loading').style.display = 'none';
    document.getElementById('feed-content').style.display = 'none';
    document.getElementById('feed-error').style.display = 'flex';
}

function showContent() {
    document.getElementById('feed-loading').style.display = 'none';
    document.getElementById('feed-error').style.display = 'none';
    document.getElementById('feed-content').style.display = 'flex';
}

async function initArtistFeedPage() {
    initTheme();
    bindEvents();
    showLoading();

    feedArtist = await fetchArtistForFeed();
    if (!feedArtist) {
        showError();
        return;
    }

    allFeedItems = normalizeFeedItems(feedArtist);
    updateArtistSummary();

    const firstNonEmpty = FEED_CATEGORIES.find((category) => (
        allFeedItems.some((item) => item.category === category)
    )) || 'realizados';

    setActiveCategory(firstNonEmpty);
    showContent();
}

document.addEventListener('DOMContentLoaded', initArtistFeedPage);
