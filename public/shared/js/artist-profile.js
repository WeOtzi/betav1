// ============================================
// WE OTZI - Public Artist Profile Logic
// Loads and displays public artist profile data
// No authentication required
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Artist data
let artistData = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeProfile();
    setupEventListeners();
});

async function initializeProfile() {
    try {
        // Get artist username from URL
        const urlParams = new URLSearchParams(window.location.search);
        const artistUsername = urlParams.get('artist');

        if (!artistUsername) {
            showError();
            return;
        }

        // Load artist data
        await loadArtistData(artistUsername);

    } catch (error) {
        console.error('Profile initialization error:', error);
        showError();
    }
}

// ============================================
// DATA LOADING
// ============================================

async function loadArtistData(username) {
    try {
        // Normalize username - add .wo if not present
        let searchUsername = username;
        if (!searchUsername.endsWith('.wo')) {
            searchUsername = searchUsername + '.wo';
        }

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

// ============================================
// PROFILE POPULATION
// ============================================

function populateProfile() {
    if (!artistData) return;

    // Update page title and meta tags
    const artisticName = artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista';
    document.title = `${artisticName} | We Otzi`;
    
    // Update Open Graph meta tags for sharing
    document.getElementById('og-title').content = `${artisticName} - Tatuador en We Otzi`;
    document.getElementById('og-description').content = artistData.bio_description || 'Conoce el trabajo de este increible artista tatuador';
    if (artistData.profile_picture) {
        document.getElementById('og-image').content = artistData.profile_picture;
    }

    // Identity Block
    document.getElementById('artist-name').textContent = artisticName;
    document.getElementById('artist-username').textContent = '@' + (artistData.username || 'usuario.wo');
    document.getElementById('location-text').textContent = artistData.ubicacion || 'Sin ubicacion';

    // Profile Picture (Avatar)
    if (artistData.profile_picture) {
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = artistData.profile_picture;
        avatarImg.classList.add('loaded');
    }

    // Stats Block
    document.getElementById('stat-experience').textContent = artistData.years_experience || '-';
    const stylesCount = artistData.styles_array ? artistData.styles_array.length : 0;
    document.getElementById('stat-styles').textContent = stylesCount;
    document.getElementById('stat-price').textContent = artistData.session_price || '-';

    // Bio & Portfolio
    const bioText = artistData.bio_description || 'Este artista aun no ha agregado una descripcion.';
    document.getElementById('bio-text').innerHTML = bioText;

    const portfolioLink = document.getElementById('portfolio-url');
    if (artistData.portafolio) {
        portfolioLink.href = artistData.portafolio;
        portfolioLink.style.display = 'inline-flex';
    } else {
        portfolioLink.style.display = 'none';
    }

    // Profile Form - Display Values
    document.getElementById('display-artistic-name').textContent = artisticName || '-';
    document.getElementById('display-full-name').textContent = artistData.name || '-';
    document.getElementById('display-location').textContent = artistData.ubicacion || '-';

    // Styles
    const stylesContainer = document.getElementById('display-styles');
    if (artistData.styles_array && artistData.styles_array.length > 0) {
        stylesContainer.innerHTML = artistData.styles_array
            .map(s => `<span class="style-tag">${s}</span>`)
            .join('');
    } else {
        stylesContainer.textContent = '-';
    }

    document.getElementById('display-experience').textContent = 
        artistData.years_experience ? `${artistData.years_experience} anos` : '-';
    document.getElementById('display-price').textContent = artistData.session_price || '-';
    document.getElementById('display-portfolio').textContent = artistData.portafolio || '-';

    // Work Type
    let workTypeDisplay = '-';
    let showStudio = false;
    if (artistData.estudios === 'Sin estudio/Independiente') {
        workTypeDisplay = 'Independiente';
    } else if (artistData.estudios) {
        workTypeDisplay = 'Estudio';
        showStudio = true;
    }
    document.getElementById('display-work-type').textContent = workTypeDisplay;

    const studioRow = document.getElementById('studio-row');
    if (showStudio && artistData.estudios && artistData.estudios !== 'Sin estudio/Independiente') {
        studioRow.style.display = 'flex';
        document.getElementById('display-studio').textContent = artistData.estudios;
    }

    // Instagram
    document.getElementById('display-instagram').textContent = artistData.instagram || '-';

    // Social links in identity block
    const instagramLink = document.getElementById('instagram-link');
    if (artistData.instagram) {
        const igHandle = artistData.instagram.replace('@', '');
        instagramLink.href = `https://instagram.com/${igHandle}`;
        instagramLink.style.display = 'flex';
    } else {
        instagramLink.style.display = 'none';
    }

    // Level Badge
    const levelBadge = document.getElementById('artist-level-badge');
    const levelText = document.getElementById('level-text');
    const nivel = artistData.nivel || 'Nuevo';
    levelText.textContent = nivel;
    levelBadge.setAttribute('data-level', nivel);

    // Verification Badge
    const verificationBadge = document.getElementById('verification-badge');
    if (artistData.verification_state === 'Yes') {
        verificationBadge.style.display = 'inline-flex';
        verificationBadge.setAttribute('data-state', 'Yes');
    }

    // Embajador Badge
    const embajadorBadge = document.getElementById('embajador-badge');
    if (artistData.embajador === 'si') {
        embajadorBadge.style.display = 'flex';
    }

    // Setup Quote CTA Button
    setupQuoteButton();

    // Setup Contact Options
    setupContactOptions();

    // Setup Achievements
    setupAchievements();

    // Setup Gallery
    setupGallery();
}

// ============================================
// QUOTE CTA BUTTON
// ============================================

function setupQuoteButton() {
    const quoteBtn = document.getElementById('quote-cta-btn');
    const username = artistData?.username || '';
    
    quoteBtn.addEventListener('click', () => {
        // Navigate to quotation form with artist pre-selected
        window.location.href = `/quotation?artist=${encodeURIComponent(username)}`;
    });
}

// ============================================
// CONTACT OPTIONS
// ============================================

function setupContactOptions() {
    const username = artistData?.username || '';
    
    // Cotizar Button in Contact Options
    const contactQuoteBtn = document.getElementById('contact-quote-btn');
    if (contactQuoteBtn) {
        contactQuoteBtn.addEventListener('click', () => {
            window.location.href = `/quotation?artist=${encodeURIComponent(username)}`;
        });
    }
    
    // WhatsApp Contact Button
    const whatsappBtn = document.getElementById('whatsapp-contact-btn');
    if (artistData.whatsapp_url) {
        whatsappBtn.href = artistData.whatsapp_url;
        whatsappBtn.style.display = 'flex';
    } else if (artistData.whatsapp_number) {
        // Generate WhatsApp URL for We Otzi
        const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541162079567';
        const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
        const artistUsername = artistData.username || 'artista';
        const whatsappMessage = encodeURIComponent(`Hola Otzi, quiero cotizar con ${artistUsername}`);
        const finalWhatsappUrl = `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;
        
        whatsappBtn.href = finalWhatsappUrl;
        whatsappBtn.style.display = 'flex';
    }

    // Instagram Contact Button
    const instagramBtn = document.getElementById('instagram-contact-btn');
    if (artistData.instagram) {
        const igHandle = artistData.instagram.replace('@', '');
        instagramBtn.href = `https://instagram.com/${igHandle}`;
        instagramBtn.style.display = 'flex';
    }

    // Copy Profile Button
    const copyProfileBtn = document.getElementById('copy-profile-btn');
    copyProfileBtn.addEventListener('click', copyProfileLink);
}

// ============================================
// ACHIEVEMENTS
// ============================================

function setupAchievements() {
    let achievementsCount = 0;

    // Verified Artist Achievement
    const verifiedAchievement = document.getElementById('achievement-verified');
    if (artistData.verification_state === 'Yes') {
        verifiedAchievement.style.display = 'flex';
        verifiedAchievement.classList.add('unlocked');
        achievementsCount++;
    }

    // Embajador Achievement
    const embajadorAchievement = document.getElementById('achievement-embajador');
    if (artistData.embajador === 'si') {
        embajadorAchievement.style.display = 'flex';
        embajadorAchievement.classList.add('unlocked');
        achievementsCount++;
    }

    // Studio Professional Achievement
    const studioAchievement = document.getElementById('achievement-studio');
    if (artistData.estudios && artistData.estudios !== 'Sin estudio/Independiente') {
        studioAchievement.style.display = 'flex';
        studioAchievement.classList.add('unlocked');
        achievementsCount++;
    }

    // Experience Achievement
    const experienceAchievement = document.getElementById('achievement-experience');
    const experienceLabel = document.getElementById('achievement-experience-label');
    const yearsExp = artistData.years_experience;
    
    if (yearsExp) {
        let expLabel = '';
        if (yearsExp === '10+') {
            expLabel = 'Maestro (+10 anos)';
        } else if (yearsExp === '5-10') {
            expLabel = 'Experto (5-10 anos)';
        } else if (yearsExp === '3-5') {
            expLabel = 'Profesional (3-5 anos)';
        }
        
        if (expLabel) {
            experienceAchievement.style.display = 'flex';
            experienceAchievement.classList.add('unlocked');
            experienceLabel.textContent = expLabel;
            achievementsCount++;
        }
    }

    // Profile Complete Achievement
    const profileAchievement = document.getElementById('achievement-complete-profile');
    if (artistData.ms_profile_complete) {
        profileAchievement.style.display = 'flex';
        profileAchievement.classList.add('unlocked');
        achievementsCount++;
    }

    // Show empty message if no achievements
    const emptyMessage = document.getElementById('achievements-empty');
    if (achievementsCount === 0) {
        emptyMessage.style.display = 'block';
    }
}

// ============================================
// GALLERY
// ============================================

const MAX_VISIBLE_GALLERY_IMAGES = 6;
let galleryImages = [];
let currentLightboxIndex = 0;

function setupGallery() {
    galleryImages = artistData.gallery_images || [];
    
    if (galleryImages.length === 0) {
        return; // Don't show gallery block if no images
    }

    const galleryBlock = document.getElementById('block-gallery');
    const galleryGrid = document.getElementById('gallery-grid');
    const viewAllBtn = document.getElementById('gallery-view-all-btn');

    // Show gallery block
    galleryBlock.style.display = 'flex';

    // Show "View All" button if more than max visible
    if (galleryImages.length > MAX_VISIBLE_GALLERY_IMAGES) {
        viewAllBtn.style.display = 'inline-flex';
        viewAllBtn.addEventListener('click', () => openLightbox(0));
    }

    // Render gallery images (limited to max visible)
    const visibleImages = galleryImages.slice(0, MAX_VISIBLE_GALLERY_IMAGES);
    galleryGrid.innerHTML = visibleImages.map((url, index) => `
        <div class="gallery-image-item" data-index="${index}" onclick="openLightbox(${index})">
            <img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">
        </div>
    `).join('');

    // Setup lightbox
    setupLightbox();
}

function setupLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    const closeBtn = document.getElementById('lightbox-close');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');

    closeBtn.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', () => navigateLightbox(-1));
    nextBtn.addEventListener('click', () => navigateLightbox(1));

    // Close on background click
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightbox();
        }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });
}

function openLightbox(index) {
    const lightbox = document.getElementById('gallery-lightbox');
    currentLightboxIndex = index;
    updateLightboxImage();
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}

function navigateLightbox(direction) {
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
    const counter = document.getElementById('lightbox-counter');
    
    image.src = galleryImages[currentLightboxIndex];
    counter.textContent = `${currentLightboxIndex + 1} / ${galleryImages.length}`;
}

// Make openLightbox available globally
window.openLightbox = openLightbox;

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Share Profile Button
    const shareProfileBtn = document.getElementById('share-profile-btn');
    shareProfileBtn.addEventListener('click', shareProfile);
}

// ============================================
// SHARING FUNCTIONS
// ============================================

async function shareProfile() {
    const shareBtn = document.getElementById('share-profile-btn');
    const username = artistData?.username || 'artista';
    
    // Get current URL for sharing
    const profileUrl = window.location.href;
    
    // Try native share API first (mobile)
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
            // User cancelled or share failed, fall back to clipboard
            if (err.name !== 'AbortError') {
                console.log('Share failed, falling back to clipboard');
            }
        }
    }
    
    // Fallback: copy to clipboard
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

async function copyProfileLink() {
    const copyBtn = document.getElementById('copy-profile-btn');
    const profileUrl = window.location.href;

    try {
        await navigator.clipboard.writeText(profileUrl);
        
        // Visual feedback
        copyBtn.classList.add('copied');
        showStatusMessage('Enlace del perfil copiado al portapapeles.', 'success');
        
        setTimeout(() => {
            copyBtn.classList.remove('copied');
        }, 2000);

    } catch (err) {
        console.error('Error copying to clipboard:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = profileUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            copyBtn.classList.add('copied');
            showStatusMessage('Enlace del perfil copiado al portapapeles.', 'success');
            setTimeout(() => {
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (e) {
            showStatusMessage('Error al copiar el enlace.', 'error');
        }
        document.body.removeChild(textArea);
    }
}

// ============================================
// UI STATE FUNCTIONS
// ============================================

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

// ============================================
// UTILITY FUNCTIONS
// ============================================

function showStatusMessage(message, type = 'info') {
    const messageDiv = document.getElementById('status-message');
    messageDiv.textContent = message;
    messageDiv.className = 'status-message ' + type;

    setTimeout(() => {
        messageDiv.textContent = '';
        messageDiv.className = 'status-message';
    }, 4000);
}

// ============================================
// THEME TOGGLE
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const btn = document.querySelector('.theme-toggle');
    btn.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-yellow');
    setTimeout(() => {
        btn.style.backgroundColor = '';
    }, 300);
}
