// ============================================
// WE OTZI - Public Artist Profile Logic
// Right summary layout
// ============================================

const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let artistData = null;
let galleryImages = [];
let currentLightboxIndex = 0;
const MAX_VISIBLE_GALLERY_IMAGES = 6;

function isUrlVideo(url) {
    const ext = (url || '').split('?')[0].split('.').pop().toLowerCase();
    return ext === 'mp4' || ext === 'mov';
}

function parseStylesArray(styles) {
    if (Array.isArray(styles)) return styles.filter(Boolean);
    if (typeof styles === 'string') {
        try {
            const parsed = JSON.parse(styles);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [styles].filter(Boolean);
        } catch {
            return styles ? [styles] : [];
        }
    }
    return [];
}

function resolveWorkType(data) {
    const wt = data.work_type
        || (data.estudios === 'Sin estudio/Independiente' ? 'independent'
            : (data.estudios ? 'studio' : ''));

    const labels = {
        independent: 'Independiente',
        studio: 'Estudio',
        both: 'Estudio e independiente'
    };

    return {
        key: wt,
        label: labels[wt] || 'No especificado'
    };
}

function normalizeUsernameFromUrl(username) {
    if (!username) return '';
    return username.endsWith('.wo') ? username : `${username}.wo`;
}

function getQuotationUrl() {
    const username = artistData?.username || '';
    return `/quotation?artist=${encodeURIComponent(username)}`;
}

function getWhatsappQuoteUrl() {
    if (artistData?.whatsapp_url) return artistData.whatsapp_url;

    const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541127015926';
    const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
    const artistUsername = artistData?.username || 'artista';
    const whatsappMessage = encodeURIComponent(`Hola Otzi, quiero cotizar con ${artistUsername}`);
    return `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;
}

function getInstagramProfileUrl(instagramValue) {
    if (!instagramValue) return '';
    const handle = String(instagramValue).trim().replace(/^@+/, '');
    if (!handle) return '';
    return `https://instagram.com/${encodeURIComponent(handle)}`;
}

function normalizeExternalUrl(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

document.addEventListener('DOMContentLoaded', () => {
    initializeProfile();
    setupEventListeners();
});

async function initializeProfile() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const artistUsername = urlParams.get('artist');

        if (!artistUsername) {
            showError();
            return;
        }

        await loadArtistData(artistUsername);
    } catch (error) {
        console.error('Profile initialization error:', error);
        showError();
    }
}

async function loadArtistData(username) {
    try {
        const searchUsername = normalizeUsernameFromUrl(username);

        const { data: artist, error } = await _supabase
            .from('artists_db')
            .select('*')
            .eq('username', searchUsername)
            .single();

        if (error || !artist) {
            console.error('Error loading artist data:', error);
            showError();
            return;
        }

        artistData = artist;
        populateProfile();
        hideLoading();
        showContent();
    } catch (error) {
        console.error('Error loading artist data:', error);
        showError();
    }
}

function populateProfile() {
    if (!artistData) return;

    const artisticName = artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista';
    const styles = parseStylesArray(artistData.styles_array);
    const workType = resolveWorkType(artistData);

    document.title = `${artisticName} | We Otzi`;
    document.getElementById('og-title').content = `${artisticName} - Tatuador en We Otzi`;

    const ogBio = window.BioFormatting
        ? window.BioFormatting.bioHtmlToPlainText(artistData.bio_description)
        : (artistData.bio_description || '');
    document.getElementById('og-description').content = ogBio || 'Conoce el trabajo de este increible artista tatuador';

    if (artistData.profile_picture) {
        document.getElementById('og-image').content = artistData.profile_picture;
    }

    document.getElementById('artist-name').textContent = artisticName;
    document.getElementById('artist-username').textContent = `@${artistData.username || 'usuario.wo'}`;

    if (artistData.profile_picture) {
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = artistData.profile_picture;
        avatarImg.classList.add('loaded');
    }

    const verificationBadge = document.getElementById('verification-badge');
    verificationBadge.setAttribute('data-state', 'verified');
    document.getElementById('verification-text').textContent = 'Verificado';

    const levelBadge = document.getElementById('artist-level-badge');
    if (levelBadge) levelBadge.hidden = true;
    const embajadorBadge = document.getElementById('embajador-badge');
    if (embajadorBadge) embajadorBadge.hidden = true;

    renderStyles(styles);
    document.getElementById('stat-styles').textContent = styles.length ? String(styles.length) : '-';

    document.getElementById('display-price').textContent = artistData.session_price || 'Consultar';
    document.getElementById('stat-price').textContent = artistData.session_price || '-';

    document.getElementById('display-experience').textContent = artistData.years_experience
        ? `${artistData.years_experience} anios`
        : 'No especificada';
    document.getElementById('stat-experience').textContent = artistData.years_experience || '-';

    const locationValue = artistData.ubicacion || 'No especificada';
    const locationText = document.getElementById('display-location');
    const locationLink = document.getElementById('display-location-link');
    locationText.textContent = locationValue;
    if (locationLink) {
        if (artistData.ubicacion) {
            locationLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(artistData.ubicacion)}`;
            locationLink.classList.remove('is-empty');
        } else {
            locationLink.removeAttribute('href');
            locationLink.classList.add('is-empty');
        }
    }
    document.getElementById('display-work-type').textContent = workType.label;

    const studioRow = document.getElementById('studio-row');
    const showStudio = (workType.key === 'studio' || workType.key === 'both')
        && artistData.estudios
        && artistData.estudios !== 'Sin estudio/Independiente';

    if (showStudio) {
        studioRow.style.display = 'flex';
        document.getElementById('display-studio').textContent = artistData.estudios;
    } else {
        studioRow.style.display = 'none';
    }

    const bioTextEl = document.getElementById('bio-text');
    if (window.BioFormatting) {
        window.BioFormatting.renderBioHtml(bioTextEl, artistData.bio_description);
    } else {
        bioTextEl.textContent = artistData.bio_description || 'Este artista aun no ha agregado una descripcion.';
    }

    document.getElementById('display-artistic-name').textContent = artisticName || '-';
    document.getElementById('display-full-name').textContent = artistData.name || '-';
    document.getElementById('display-username').textContent = `@${artistData.username || '-'}`;
    const instagramDisplay = document.getElementById('display-instagram');
    const instagramDisplayLink = document.getElementById('display-instagram-link');
    const portfolioDisplay = document.getElementById('display-portfolio');
    const portfolioDisplayLink = document.getElementById('display-portfolio-link');

    const instagramText = artistData.instagram || '-';
    const instagramUrl = getInstagramProfileUrl(artistData.instagram);
    instagramDisplay.textContent = instagramText;
    if (instagramDisplayLink) {
        if (instagramUrl) {
            instagramDisplayLink.href = instagramUrl;
            instagramDisplayLink.classList.remove('is-empty');
        } else {
            instagramDisplayLink.removeAttribute('href');
            instagramDisplayLink.classList.add('is-empty');
        }
    }

    const portfolioText = artistData.portafolio || '-';
    const portfolioUrl = normalizeExternalUrl(artistData.portafolio);
    portfolioDisplay.textContent = portfolioText;
    if (portfolioDisplayLink) {
        if (portfolioUrl) {
            portfolioDisplayLink.href = portfolioUrl;
            portfolioDisplayLink.classList.remove('is-empty');
        } else {
            portfolioDisplayLink.removeAttribute('href');
            portfolioDisplayLink.classList.add('is-empty');
        }
    }

    setupActionButtons();
    setupQuoteButtons();
    setupGallery();
}

function renderStyles(styles) {
    const stylesContainer = document.getElementById('display-styles');
    stylesContainer.innerHTML = '';

    if (!styles.length) {
        stylesContainer.textContent = 'Sin estilos cargados';
        return;
    }

    for (const styleName of styles) {
        const tag = document.createElement('span');
        tag.className = 'style-tag';
        tag.textContent = styleName;
        stylesContainer.appendChild(tag);
    }
}

function setActionLink(anchor, href, enabled) {
    if (enabled) {
        anchor.href = href;
        anchor.classList.remove('is-disabled');
        anchor.setAttribute('aria-disabled', 'false');
    } else {
        anchor.href = '#';
        anchor.classList.add('is-disabled');
        anchor.setAttribute('aria-disabled', 'true');
    }
}

function setupActionButtons() {
    const whatsappBtn = document.getElementById('whatsapp-quote-btn');
    const instagramBtn = document.getElementById('instagram-link');
    const portfolioBtn = document.getElementById('portfolio-action-link');

    setActionLink(whatsappBtn, getWhatsappQuoteUrl(), true);

    const instagramUrl = getInstagramProfileUrl(artistData.instagram);
    if (instagramUrl) {
        setActionLink(instagramBtn, instagramUrl, true);
    } else {
        setActionLink(instagramBtn, '#', false);
    }

    const portfolioUrl = normalizeExternalUrl(artistData.portafolio);
    if (portfolioUrl) {
        setActionLink(portfolioBtn, portfolioUrl, true);
    } else {
        setActionLink(portfolioBtn, '#', false);
    }
}

function setupQuoteButtons() {
    const topBtn = document.getElementById('quote-cta-top-btn');
    const bottomBtn = document.getElementById('quote-cta-bottom-btn');

    const goToQuote = () => {
        window.location.href = getQuotationUrl();
    };

    topBtn.addEventListener('click', goToQuote);
    bottomBtn.addEventListener('click', goToQuote);
}

function setupGallery() {
    galleryImages = Array.isArray(artistData.gallery_images)
        ? artistData.gallery_images.filter(Boolean)
        : [];

    const galleryBlock = document.getElementById('block-gallery');
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');
    const viewAllBtn = document.getElementById('gallery-view-all-btn');

    galleryBlock.style.display = 'flex';
    galleryGrid.innerHTML = '';

    if (!galleryImages.length) {
        galleryEmpty.style.display = 'block';
        viewAllBtn.style.display = 'none';
        return;
    }

    galleryEmpty.style.display = 'none';

    if (galleryImages.length > MAX_VISIBLE_GALLERY_IMAGES) {
        viewAllBtn.style.display = 'inline-flex';
        viewAllBtn.onclick = () => openLightbox(0);
    } else {
        viewAllBtn.style.display = 'none';
    }

    const visibleImages = galleryImages.slice(0, MAX_VISIBLE_GALLERY_IMAGES);

    galleryGrid.innerHTML = visibleImages.map((url, index) => {
        const isVideo = isUrlVideo(url);
        return `
        <div class="gallery-image-item" data-index="${index}" onclick="openLightbox(${index})" style="animation-delay:${0.08 + index * 0.08}s;">
            ${isVideo
                ? `<video src="${url}" preload="metadata" muted playsinline></video>
                   <span class="gallery-play-overlay">&#9654;</span>`
                : `<img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">`}
        </div>`;
    }).join('');

    setupLightbox();
}

function setupLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    const closeBtn = document.getElementById('lightbox-close');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');

    closeBtn.onclick = closeLightbox;
    prevBtn.onclick = () => navigateLightbox(-1);
    nextBtn.onclick = () => navigateLightbox(1);

    lightbox.onclick = (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    };

    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;

        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });
}

function openLightbox(index) {
    if (!galleryImages.length) return;
    const lightbox = document.getElementById('gallery-lightbox');
    currentLightboxIndex = index;
    updateLightboxImage();
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    const video = document.getElementById('lightbox-video');

    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function navigateLightbox(direction) {
    const video = document.getElementById('lightbox-video');
    if (video) video.pause();

    currentLightboxIndex += direction;

    if (currentLightboxIndex < 0) {
        currentLightboxIndex = galleryImages.length - 1;
    } else if (currentLightboxIndex >= galleryImages.length) {
        currentLightboxIndex = 0;
    }

    updateLightboxImage();
}

function updateLightboxImage() {
    const image = document.getElementById('lightbox-image');
    const video = document.getElementById('lightbox-video');
    const counter = document.getElementById('lightbox-counter');

    const url = galleryImages[currentLightboxIndex];
    const isVideo = isUrlVideo(url);

    if (isVideo) {
        image.style.display = 'none';
        image.src = '';

        video.style.display = 'block';
        video.src = url;
        video.load();
    } else {
        video.pause();
        video.style.display = 'none';
        video.removeAttribute('src');
        video.load();

        image.style.display = 'block';
        image.src = url;
    }

    counter.textContent = `${currentLightboxIndex + 1} / ${galleryImages.length}`;
}

window.openLightbox = openLightbox;

function setupEventListeners() {
    const shareProfileBtn = document.getElementById('share-profile-btn');
    if (shareProfileBtn) {
        shareProfileBtn.addEventListener('click', shareProfile);
    }
}

async function shareProfile() {
    const shareBtn = document.getElementById('share-profile-btn');
    const username = artistData?.username || 'artista';
    const profileUrl = window.location.href;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `${username} - We Otzi`,
                text: `Conoce el trabajo de ${username} como tatuador en We Otzi`,
                url: profileUrl
            });

            shareBtn.classList.add('shared');
            setTimeout(() => shareBtn.classList.remove('shared'), 2000);
            return;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.log('Share failed, falling back to clipboard');
            }
        }
    }

    try {
        await navigator.clipboard.writeText(profileUrl);
        shareBtn.classList.add('shared');
        showStatusMessage('Enlace del perfil copiado al portapapeles.', 'success');
        setTimeout(() => shareBtn.classList.remove('shared'), 2000);
    } catch (err) {
        console.error('Error sharing profile:', err);
        showStatusMessage('Error al compartir el perfil.', 'error');
    }
}

function showLoading() {
    document.getElementById('profile-loading').style.display = 'flex';
    document.getElementById('profile-error').style.display = 'none';
    document.getElementById('profile-content').style.display = 'none';
}

function hideLoading() {
    document.getElementById('profile-loading').style.display = 'none';
}

function showError() {
    document.getElementById('profile-loading').style.display = 'none';
    document.getElementById('profile-error').style.display = 'flex';
    document.getElementById('profile-content').style.display = 'none';
}

function showContent() {
    document.getElementById('profile-content').style.display = 'grid';
}

function showStatusMessage(message, type = 'info') {
    const messageDiv = document.getElementById('status-message');
    messageDiv.textContent = message;
    messageDiv.className = `status-message ${type}`;

    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'status-message';
    }, 4000);
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const btn = document.querySelector('.theme-toggle');
    btn.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-yellow');

    setTimeout(() => {
        btn.style.backgroundColor = '';
    }, 300);
}
