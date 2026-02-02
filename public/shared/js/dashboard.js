// ============================================
// WE ÖTZI - Artist Dashboard Logic
// Authentication, data management, and profile editing
// Connected to Supabase artists_db
// ============================================

// Supabase Configuration - Uses config-manager.js (provides window.CONFIG)
const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Current user and artist data
let currentUser = null;
let artistData = null;
let isEditMode = false;

// Milestone definitions
const MILESTONES = {
    ms_profile_complete: 'milestone-profile',
    ms_first_quote_received: 'milestone-quote-received',
    ms_whatsapp_shared: 'milestone-whatsapp-shared',
    ms_profile_shared: 'milestone-profile-shared',
    ms_first_quote_completed: 'milestone-quote-completed'
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupEventListeners();
    setupGalleryListeners();
    restoreZoomPreference();
});

async function initializeDashboard() {
    try {
        // Check authentication
        const { data: { session }, error } = await _supabase.auth.getSession();
        
        if (error) throw error;

        if (!session) {
            console.log('No authenticated session found. Redirecting to login...');
            window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        console.log('User authenticated:', currentUser.email);

        // Load artist data
        await loadArtistData();

    } catch (error) {
        console.error('Dashboard initialization error:', error);
        window.location.href = 'index.html';
    }
}

// ============================================
// DATA LOADING
// ============================================

async function loadArtistData() {
    if (!currentUser) return;

    try {
        const { data: artist, error } = await _supabase
            .from('artists_db')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error loading artist data:', error);
            return;
        }

        if (!artist) {
            // No profile found, redirect to registration
            console.log('No artist profile found. Redirecting to registration...');
            window.location.href = 'register-artist.html';
            return;
        }

        artistData = artist;
        populateDashboard();
        populateQuotes();
        updateLevelBadge();
        updateMilestonesUI();
        checkProfileCompletion();
        renderGalleryAdmin();

    } catch (error) {
        console.error('Error loading artist data:', error);
    }
}

function populateDashboard() {
    if (!artistData) return;

    // Identity Block
    const artisticName = artistData.username ? artistData.username.replace(/\.wo$/, '') : 'Artista';
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
    const bioText = artistData.bio_description || 'Sin bio aun. Edita tu perfil para agregar una descripcion.';
    document.getElementById('bio-text').innerHTML = bioText;
    document.getElementById('bio-textarea').value = stripHtml(bioText);

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
    document.getElementById('display-email').textContent = artistData.email || currentUser.email || '-';
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

    // Birth Date
    if (artistData.birth_date) {
        const birthDate = new Date(artistData.birth_date);
        document.getElementById('display-birthdate').textContent = birthDate.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    // Newsletter
    document.getElementById('display-newsletter').textContent = 
        artistData.subscribed_newsletter ? 'Suscrito' : 'No suscrito';
    document.getElementById('input-newsletter').checked = artistData.subscribed_newsletter || false;

    // Instagram
    document.getElementById('display-instagram').textContent = artistData.instagram || '-';
    document.getElementById('input-instagram').value = artistData.instagram || '';

    // WhatsApp
    document.getElementById('display-whatsapp').textContent = artistData.whatsapp_number || '-';
    document.getElementById('input-whatsapp').value = artistData.whatsapp_number || '';

    // Embajador (read-only, managed by support team)
    const embajadorValue = artistData.embajador || '';
    document.getElementById('display-embajador').textContent = 
        embajadorValue === 'si' ? 'Si' : 
        embajadorValue === 'pendiente' ? 'Pendiente' : 'No';

    // Show embajador badge if active
    const embajadorBadge = document.getElementById('embajador-badge');
    if (embajadorValue === 'si') {
        embajadorBadge.style.display = 'flex';
    } else {
        embajadorBadge.style.display = 'none';
    }

    // Show verification pending banner if not an embajador
    const verificationBanner = document.getElementById('verification-pending-banner');
    if (verificationBanner) {
        if (embajadorValue !== 'si') {
            verificationBanner.style.display = 'block';
        } else {
            verificationBanner.style.display = 'none';
        }
    }

    // Verification State Display
    updateVerificationUI(artistData.verification_state || 'No');

    // Social links in identity block
    const instagramLink = document.getElementById('instagram-link');
    if (artistData.instagram) {
        const igHandle = artistData.instagram.replace('@', '');
        instagramLink.href = `https://instagram.com/${igHandle}`;
        instagramLink.style.display = 'flex';
    } else {
        instagramLink.style.display = 'none';
    }

    const whatsappLink = document.getElementById('whatsapp-link');
    const copyWhatsappBtn = document.getElementById('copy-whatsapp-btn');
    
    // Always generate link to We Otzi, using artist username
    const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541162079567';
    const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
    const username = artistData.username || 'artista';
    const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${username}`);
    const finalWhatsappUrl = `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;

    if (artistData.whatsapp_url || artistData.whatsapp_number) {
        whatsappLink.href = finalWhatsappUrl;
        whatsappLink.style.display = 'flex';
        copyWhatsappBtn.style.display = 'flex';
        copyWhatsappBtn.dataset.url = finalWhatsappUrl;
    } else {
        whatsappLink.style.display = 'none';
        copyWhatsappBtn.style.display = 'none';
    }

    // Set quotes admin button listener (placeholder removed)
    const quotesAdminBtn = document.getElementById('go-to-quotes-btn');
    if (quotesAdminBtn) {
        // Navigation is now handled by inline onclick in dashboard.html
    }

    // Populate input fields for edit mode
    document.getElementById('input-artistic-name').value = artisticName;
    document.getElementById('input-full-name').value = artistData.name || '';
    document.getElementById('input-location').value = artistData.ubicacion || '';
    document.getElementById('input-styles').value = artistData.styles_array ? artistData.styles_array.join(', ') : '';
    document.getElementById('input-experience').value = artistData.years_experience || '0-1';
    
    // Parse session price
    if (artistData.session_price) {
        const priceParts = artistData.session_price.split(' ');
        document.getElementById('input-price').value = priceParts[0] || '';
        document.getElementById('input-currency').value = priceParts[1] || 'USD';
    }

    document.getElementById('input-portfolio').value = artistData.portafolio || '';
    document.getElementById('input-birthdate').value = artistData.birth_date || '';

    // Work type input
    if (artistData.estudios === 'Sin estudio/Independiente') {
        document.getElementById('input-work-type').value = 'independent';
    } else if (artistData.estudios) {
        document.getElementById('input-work-type').value = 'studio';
        document.getElementById('input-studio').value = artistData.estudios;
    }
}

// ============================================
// QUOTES MANAGEMENT
// ============================================

async function populateQuotes() {
    if (!currentUser) return;

    try {
        // Fetch all quotes for the current artist (excluding drafts/in_progress)
        const { data, error } = await _supabase
            .from('quotations_db')
            .select('quote_status')
            .eq('artist_id', currentUser.id)
            .neq('quote_status', 'in_progress');

        if (error) throw error;

        const stats = {
            total: data ? data.length : 0,
            pending: data ? data.filter(q => q.quote_status === 'pending').length : 0,
            answered: data ? data.filter(q => q.quote_status === 'responded').length : 0
        };

        // Update UI
        document.getElementById('quote-total').textContent = stats.total;
        document.getElementById('quote-pending').textContent = stats.pending;
        document.getElementById('quote-answered').textContent = stats.answered;

        // Visual feedback for pending quotes
        const pendingVal = document.getElementById('quote-pending');
        if (stats.pending > 0) {
            pendingVal.classList.add('highlight-red');
        } else {
            pendingVal.classList.remove('highlight-red');
        }

        // Check quote-related milestones
        checkQuoteMilestones(stats);

    } catch (error) {
        console.error('Error fetching quotes stats:', error);
    }
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Edit toggle button
    const editToggleBtn = document.getElementById('edit-toggle-btn');
    editToggleBtn.addEventListener('click', toggleEditMode);

    // Profile form submission
    const profileForm = document.getElementById('profile-form');
    profileForm.addEventListener('submit', handleProfileSave);

    // Cancel button
    const cancelBtn = document.getElementById('profile-cancel');
    cancelBtn.addEventListener('click', cancelEditMode);

    // Bio edit
    const editBioBtn = document.getElementById('edit-bio-btn');
    editBioBtn.addEventListener('click', toggleBioEdit);

    const bioCancelBtn = document.getElementById('bio-cancel');
    bioCancelBtn.addEventListener('click', cancelBioEdit);

    const bioSaveBtn = document.getElementById('bio-save');
    bioSaveBtn.addEventListener('click', saveBio);

    // Work type change
    const workTypeSelect = document.getElementById('input-work-type');
    workTypeSelect.addEventListener('change', handleWorkTypeChange);

    // Avatar upload
    const avatarUploadBtn = document.getElementById('avatar-upload-btn');
    const avatarInput = document.getElementById('avatar-input');
    avatarUploadBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', handleAvatarUpload);

    // Action buttons
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', handleLogout);

    const changePasswordBtn = document.getElementById('change-password-btn');
    changePasswordBtn.addEventListener('click', openPasswordModal);

    // Verification button
    const verificationBtn = document.getElementById('request-verification-btn');
    verificationBtn.addEventListener('click', openVerificationModal);

    // Copy WhatsApp link button
    const copyWhatsappBtn = document.getElementById('copy-whatsapp-btn');
    copyWhatsappBtn.addEventListener('click', copyWhatsappLink);

    // Share profile button
    const shareProfileBtn = document.getElementById('share-profile-btn');
    shareProfileBtn.addEventListener('click', shareProfile);

    // Preview profile button
    const previewProfileBtn = document.getElementById('preview-profile-btn');
    if (previewProfileBtn) {
        previewProfileBtn.addEventListener('click', previewPublicProfile);
    }

    // Gallery edit input
    const galleryEditInput = document.getElementById('gallery-edit-input');
    if (galleryEditInput) {
        galleryEditInput.addEventListener('change', handleGalleryEditUpload);
    }
}

// ============================================
// COPY WHATSAPP LINK
// ============================================

async function copyWhatsappLink() {
    const copyBtn = document.getElementById('copy-whatsapp-btn');
    const url = copyBtn.dataset.url;

    if (!url) {
        showStatusMessage('No hay enlace de WhatsApp.', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        
        // Visual feedback
        copyBtn.classList.add('copied');
        showStatusMessage('Enlace de WhatsApp copiado al portapapeles.', 'success');
        
        // Track milestone
        trackMilestone('ms_whatsapp_shared');
        
        setTimeout(() => {
            copyBtn.classList.remove('copied');
        }, 2000);

    } catch (err) {
        console.error('Error copying to clipboard:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            copyBtn.classList.add('copied');
            showStatusMessage('Enlace de WhatsApp copiado al portapapeles.', 'success');
            trackMilestone('ms_whatsapp_shared');
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
// EDIT MODE TOGGLE
// ============================================

function toggleEditMode() {
    isEditMode = !isEditMode;
    const editBtn = document.getElementById('edit-toggle-btn');
    const formActions = document.getElementById('form-actions');
    const galleryEditSection = document.getElementById('gallery-edit-section');

    // Toggle button state
    if (isEditMode) {
        editBtn.classList.add('active');
        editBtn.querySelector('span').textContent = 'Cancelar';
        formActions.style.display = 'flex';
        // Show gallery edit section and render preview
        if (galleryEditSection) {
            galleryEditSection.style.display = 'flex';
            renderGalleryEditPreview();
        }
    } else {
        editBtn.classList.remove('active');
        editBtn.querySelector('span').textContent = 'Editar';
        formActions.style.display = 'none';
        // Hide gallery edit section
        if (galleryEditSection) {
            galleryEditSection.style.display = 'none';
        }
    }

    // Toggle display/input visibility
    const displayElements = document.querySelectorAll('.form-value:not(.form-value-readonly)');
    const inputElements = document.querySelectorAll('.form-input-dashboard, .form-select-dashboard, .price-input-group, .toggle-switch');

    displayElements.forEach(el => {
        el.style.display = isEditMode ? 'none' : 'block';
    });

    inputElements.forEach(el => {
        // Check if this is the studio row
        if (el.id === 'input-studio' || el.closest('#studio-row')) {
            const workType = document.getElementById('input-work-type').value;
            if (workType === 'studio' || workType === 'both') {
                el.style.display = isEditMode ? 'block' : 'none';
            }
        } else if (el.id === 'price-input-group') {
            el.style.display = isEditMode ? 'flex' : 'none';
        } else {
            el.style.display = isEditMode ? 'block' : 'none';
        }
    });

    // Special handling for styles value container
    const stylesValue = document.getElementById('display-styles');
    if (stylesValue) {
        stylesValue.style.display = isEditMode ? 'none' : 'flex';
    }

    // Handle studio row visibility based on work type
    handleWorkTypeChange();
}

function cancelEditMode() {
    if (isEditMode) {
        // Restore original values
        populateDashboard();
        toggleEditMode();
    }
}

function handleWorkTypeChange() {
    const workType = document.getElementById('input-work-type').value;
    const studioRow = document.getElementById('studio-row');
    const studioInput = document.getElementById('input-studio');
    const studioDisplay = document.getElementById('display-studio');

    if (workType === 'studio' || workType === 'both') {
        studioRow.style.display = 'flex';
        if (isEditMode) {
            studioInput.style.display = 'block';
            studioDisplay.style.display = 'none';
        }
    } else {
        studioRow.style.display = 'none';
    }
}

// ============================================
// BIO EDITING
// ============================================

function toggleBioEdit() {
    const bioContent = document.getElementById('bio-content');
    const bioEditMode = document.getElementById('bio-edit-mode');

    bioContent.style.display = 'none';
    bioEditMode.style.display = 'flex';
}

function cancelBioEdit() {
    const bioContent = document.getElementById('bio-content');
    const bioEditMode = document.getElementById('bio-edit-mode');

    // Restore original value
    const bioText = artistData?.bio_description || 'Sin bio aun. Edita tu perfil para agregar una descripcion.';
    document.getElementById('bio-textarea').value = stripHtml(bioText);

    bioContent.style.display = 'block';
    bioEditMode.style.display = 'none';
}

async function saveBio() {
    const bioTextarea = document.getElementById('bio-textarea');
    const newBio = bioTextarea.value.trim();

    try {
        const { error } = await _supabase
            .from('artists_db')
            .update({ bio_description: newBio })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        // Update local data
        artistData.bio_description = newBio;
        document.getElementById('bio-text').innerHTML = newBio || 'Sin bio aun. Edita tu perfil para agregar una descripcion.';

        // Close edit mode
        const bioContent = document.getElementById('bio-content');
        const bioEditMode = document.getElementById('bio-edit-mode');
        bioContent.style.display = 'block';
        bioEditMode.style.display = 'none';

        showStatusMessage('Bio actualizada correctamente.', 'success');

    } catch (error) {
        console.error('Error saving bio:', error);
        showStatusMessage('Error al guardar la bio.', 'error');
    }
}

// ============================================
// PROFILE SAVE
// ============================================

async function handleProfileSave(e) {
    e.preventDefault();

    const saveBtn = document.getElementById('profile-save');
    saveBtn.textContent = 'Guardando...';
    saveBtn.disabled = true;

    try {
        // Gather form data
        const artisticName = document.getElementById('input-artistic-name').value.trim();
        const fullName = document.getElementById('input-full-name').value.trim();
        const location = document.getElementById('input-location').value.trim();
        const stylesRaw = document.getElementById('input-styles').value;
        const styles = stylesRaw.split(',').map(s => s.trim()).filter(s => s);
        const experience = document.getElementById('input-experience').value;
        const price = document.getElementById('input-price').value;
        const currency = document.getElementById('input-currency').value;
        const portfolio = document.getElementById('input-portfolio').value.trim();
        const workType = document.getElementById('input-work-type').value;
        const studioName = document.getElementById('input-studio').value.trim();
        const birthDate = document.getElementById('input-birthdate').value;
        const newsletter = document.getElementById('input-newsletter').checked;
        const instagram = document.getElementById('input-instagram').value.trim();
        const whatsappNumber = document.getElementById('input-whatsapp').value.trim();
        // Note: embajador is managed by support team only - not editable by artist

        // Format username
        const username = formatUsername(artisticName);

        // Format session price
        const sessionPrice = price ? `${price} ${currency}` : null;

        // Format estudios based on work type
        let estudios;
        if (workType === 'independent') {
            estudios = 'Sin estudio/Independiente';
        } else {
            estudios = studioName || null;
        }

        // Capitalize full name
        const capitalizedName = capitalizeWords(fullName);

        // Generate WhatsApp URL for We Otzi (always points to We Otzi)
        const weOtziWA = window.CONFIG?.weOtzi?.whatsapp || '+541162079567';
        const cleanWeOtziNumber = weOtziWA.replace(/[^0-9]/g, '');
        const whatsappMessage = encodeURIComponent(`Hola Ötzi, quiero cotizar con ${username}`);
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanWeOtziNumber}&text=${whatsappMessage}`;

        const updateData = {
            username: username,
            name: capitalizedName,
            ubicacion: location,
            styles_array: styles,
            estilo: styles.join(', '),
            years_experience: experience,
            session_price: sessionPrice,
            portafolio: portfolio || null,
            estudios: estudios,
            birth_date: birthDate || null,
            subscribed_newsletter: newsletter,
            instagram: instagram || null,
            whatsapp_number: whatsappNumber || null,
            whatsapp_url: whatsappUrl
            // embajador is managed by support team only - not included here
        };

        console.log('Updating artist data:', updateData);

        const { error } = await _supabase
            .from('artists_db')
            .update(updateData)
            .eq('user_id', currentUser.id);

        if (error) throw error;

        // Update local data
        artistData = { ...artistData, ...updateData };

        // Exit edit mode and refresh display
        toggleEditMode();
        populateDashboard();
        
        // Recheck profile completion milestone
        checkProfileCompletion();

        showStatusMessage('Perfil actualizado correctamente.', 'success');

    } catch (error) {
        console.error('Error saving profile:', error);
        showStatusMessage('Error al guardar el perfil.', 'error');
    } finally {
        saveBtn.textContent = 'Guardar Cambios';
        saveBtn.disabled = false;
    }
}

// ============================================
// AVATAR UPLOAD
// ============================================

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        showStatusMessage('Por favor selecciona una imagen.', 'error');
        return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showStatusMessage('La imagen es muy grande. Maximo 5MB.', 'error');
        return;
    }

    const loadingEl = document.getElementById('avatar-loading');
    loadingEl.classList.add('active');

    try {
        // Generate unique filename with user folder structure
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${currentUser.id}/${fileName}`;

        // Upload to Supabase Storage (profile-pictures bucket)
        const { data: uploadData, error: uploadError } = await _supabase.storage
            .from('profile-pictures')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (uploadError) {
            console.error('Upload error:', uploadError);
            if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('not found')) {
                showStatusMessage('El almacenamiento de fotos no esta configurado. Contacta al administrador.', 'error');
                return;
            }
            throw uploadError;
        }

        // Get public URL
        const { data: urlData } = _supabase.storage
            .from('profile-pictures')
            .getPublicUrl(filePath);

        const publicUrl = urlData.publicUrl;

        // Update artist record with new profile picture URL
        const { error: updateError } = await _supabase
            .from('artists_db')
            .update({ profile_picture: publicUrl })
            .eq('user_id', currentUser.id);

        if (updateError) throw updateError;

        // Update UI
        const avatarImg = document.getElementById('avatar-image');
        avatarImg.src = publicUrl;
        avatarImg.classList.add('loaded');

        artistData.profile_picture = publicUrl;

        showStatusMessage('Foto de perfil actualizada.', 'success');
        
        // Recheck profile completion milestone
        checkProfileCompletion();

    } catch (error) {
        console.error('Error uploading avatar:', error);
        showStatusMessage('Error al subir la imagen.', 'error');
    } finally {
        loadingEl.classList.remove('active');
        e.target.value = ''; // Reset input
    }
}

// ============================================
// GALLERY MANAGEMENT
// ============================================

const MAX_GALLERY_IMAGES = 12;

function setupGalleryListeners() {
    const galleryInput = document.getElementById('gallery-input');
    if (galleryInput) {
        galleryInput.addEventListener('change', handleGalleryUpload);
    }
}

async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentImages = artistData.gallery_images || [];
    const remainingSlots = MAX_GALLERY_IMAGES - currentImages.length;

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} imagenes mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    // Validate file types and sizes
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            showStatusMessage('Solo se permiten archivos de imagen.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 5MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    const loadingEl = document.getElementById('gallery-admin-loading');
    loadingEl.style.display = 'flex';

    try {
        const uploadedUrls = [];

        for (const file of files) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { data: uploadData, error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                continue;
            }

            const { data: urlData } = _supabase.storage
                .from('artist-gallery')
                .getPublicUrl(filePath);

            uploadedUrls.push(urlData.publicUrl);
        }

        if (uploadedUrls.length > 0) {
            const newGalleryImages = [...currentImages, ...uploadedUrls];

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ gallery_images: newGalleryImages })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            artistData.gallery_images = newGalleryImages;
            renderGalleryAdmin();
            showStatusMessage(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`, 'success');
        }

    } catch (error) {
        console.error('Error uploading gallery images:', error);
        showStatusMessage('Error al subir las imagenes.', 'error');
    } finally {
        loadingEl.style.display = 'none';
        e.target.value = '';
    }
}

function renderGalleryAdmin() {
    const grid = document.getElementById('gallery-admin-grid');
    const emptyState = document.getElementById('gallery-empty');
    const images = artistData.gallery_images || [];

    if (images.length === 0) {
        grid.innerHTML = '';
        grid.appendChild(emptyState);
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = images.map((url, index) => `
        <div class="gallery-item" data-index="${index}">
            <img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">
            <button class="gallery-item-delete" onclick="deleteGalleryImage(${index})" aria-label="Eliminar imagen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `).join('');
}

async function deleteGalleryImage(index) {
    const images = artistData.gallery_images || [];
    const imageUrl = images[index];

    if (!imageUrl) return;

    if (!confirm('Estas seguro de eliminar esta imagen?')) return;

    try {
        // Extract file path from URL
        const urlParts = imageUrl.split('/artist-gallery/');
        if (urlParts.length > 1) {
            const filePath = urlParts[1];
            
            await _supabase.storage
                .from('artist-gallery')
                .remove([filePath]);
        }

        // Update database
        const newImages = images.filter((_, i) => i !== index);

        const { error } = await _supabase
            .from('artists_db')
            .update({ gallery_images: newImages })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        artistData.gallery_images = newImages;
        renderGalleryAdmin();
        showStatusMessage('Imagen eliminada correctamente.', 'success');

    } catch (error) {
        console.error('Error deleting gallery image:', error);
        showStatusMessage('Error al eliminar la imagen.', 'error');
    }
}

// ============================================
// LOGOUT
// ============================================

async function handleLogout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        showStatusMessage('Error al cerrar sesion.', 'error');
    }
}

// ============================================
// PASSWORD CHANGE
// ============================================

function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('new-password').focus();
}

function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('password-form').reset();
    clearPasswordMessage();
}

function closePasswordModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closePasswordModal();
    }
}

function showPasswordMessage(message, type = 'info') {
    const messageDiv = document.getElementById('password-message');
    messageDiv.textContent = message;
    messageDiv.className = 'form-message ' + type;
}

function clearPasswordMessage() {
    const messageDiv = document.getElementById('password-message');
    messageDiv.textContent = '';
    messageDiv.className = 'form-message';
}

async function handlePasswordChange(e) {
    e.preventDefault();
    
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        showPasswordMessage('Las contrasenas no coinciden.', 'error');
        return;
    }

    if (newPassword.length < 8) {
        showPasswordMessage('La contrasena debe tener al menos 8 caracteres.', 'error');
        return;
    }

    const submitBtn = document.querySelector('#password-form .btn-modal-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Actualizando...';

    try {
        const { error } = await _supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        // Also update password in artists_db
        await _supabase
            .from('artists_db')
            .update({ password: newPassword })
            .eq('user_id', currentUser.id);

        showPasswordMessage('Contrasena actualizada correctamente.', 'success');
        
        setTimeout(() => {
            closePasswordModal();
        }, 1500);

    } catch (error) {
        console.error('Password change error:', error);
        showPasswordMessage('Error al cambiar la contrasena.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            Actualizar
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
        `;
    }
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePasswordModal();
        closeVerificationModal();
    }
});

// ============================================
// VERIFICATION SYSTEM
// ============================================

const VERIFICATION_STATES = {
    'No': { text: 'No Verificado', canRequest: true },
    'Requested': { text: 'Solicitud Enviada', canRequest: false },
    'In Progress': { text: 'En Proceso', canRequest: false },
    'In Analysis': { text: 'En Analisis', canRequest: false },
    'Yes': { text: 'Verificado', canRequest: false },
    'Denied': { text: 'Denegado', canRequest: true },
    'Canceled': { text: 'Cancelado', canRequest: true }
};

function updateVerificationUI(state) {
    const badge = document.getElementById('verification-badge');
    const badgeText = document.getElementById('verification-text');
    const verifyBtn = document.getElementById('request-verification-btn');
    
    const stateConfig = VERIFICATION_STATES[state] || VERIFICATION_STATES['No'];
    
    // Update badge
    badge.setAttribute('data-state', state);
    badgeText.textContent = stateConfig.text;
    badge.style.display = 'inline-flex';
    
    // Update button state and text
    if (state === 'Yes') {
        verifyBtn.classList.add('verified');
        verifyBtn.classList.remove('requested', 'in-progress');
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Perfil Verificado
        `;
        verifyBtn.disabled = true;
    } else if (state === 'Requested' || state === 'In Progress' || state === 'In Analysis') {
        verifyBtn.classList.add('requested');
        verifyBtn.classList.remove('verified', 'in-progress');
        const statusText = state === 'Requested' ? 'Solicitud Enviada' : 
                          state === 'In Progress' ? 'En Proceso' : 'En Analisis';
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${statusText}
        `;
        verifyBtn.disabled = true;
    } else {
        verifyBtn.classList.remove('verified', 'requested', 'in-progress');
        verifyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
            </svg>
            Verificar Perfil
        `;
        verifyBtn.disabled = false;
    }
}

function openVerificationModal() {
    // Check if user can request verification
    const currentState = artistData?.verification_state || 'No';
    const stateConfig = VERIFICATION_STATES[currentState];
    
    if (!stateConfig.canRequest) {
        showStatusMessage(`Tu solicitud ya esta ${stateConfig.text.toLowerCase()}.`, 'info');
        return;
    }
    
    const modal = document.getElementById('verification-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    clearVerificationMessage();
}

function closeVerificationModal() {
    const modal = document.getElementById('verification-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    clearVerificationMessage();
}

function closeVerificationModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        closeVerificationModal();
    }
}

function showVerificationMessage(message, type = 'info') {
    const messageDiv = document.getElementById('verification-message');
    messageDiv.textContent = message;
    messageDiv.className = 'form-message ' + type;
}

function clearVerificationMessage() {
    const messageDiv = document.getElementById('verification-message');
    messageDiv.textContent = '';
    messageDiv.className = 'form-message';
}

async function submitVerificationRequest() {
    const submitBtn = document.getElementById('submit-verification-btn');
    
    if (!currentUser || !artistData) {
        showVerificationMessage('Error: No se pudo identificar tu cuenta.', 'error');
        return;
    }
    
    // Disable button and show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
        <span>Enviando solicitud...</span>
    `;
    
    try {
        // Update verification_state to "Requested"
        const { error } = await _supabase
            .from('artists_db')
            .update({ verification_state: 'Requested' })
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        
        // Update local data
        artistData.verification_state = 'Requested';
        
        // Update UI
        updateVerificationUI('Requested');
        
        // Show success message
        showVerificationMessage('Solicitud enviada correctamente. Nuestro equipo se pondra en contacto contigo pronto.', 'success');
        
        // Close modal after delay
        setTimeout(() => {
            closeVerificationModal();
            showStatusMessage('Solicitud de verificacion enviada.', 'success');
        }, 2500);
        
    } catch (error) {
        console.error('Error submitting verification request:', error);
        showVerificationMessage('Error al enviar la solicitud. Intenta de nuevo.', 'error');
        
        // Restore button
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            Solicitar Verificacion
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
        `;
    }
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

function capitalizeWords(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatUsername(artisticName) {
    if (!artisticName) return '';
    
    let username = artisticName.toLowerCase();
    username = username.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    username = username.replace(/[^a-z0-9]/g, '');
    
    return username + '.wo';
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

// ============================================
// ZOOM CONTROLS
// ============================================

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

function getCurrentZoom() {
    const root = document.documentElement;
    const currentZoom = getComputedStyle(root).getPropertyValue('--zoom-factor');
    return parseFloat(currentZoom) || 0.8;
}

function setZoom(factor) {
    const clampedFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
    document.documentElement.style.setProperty('--zoom-factor', clampedFactor);
    localStorage.setItem('weotzi-zoom', clampedFactor);
}

function zoomIn() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom + ZOOM_STEP);
}

function zoomOut() {
    const currentZoom = getCurrentZoom();
    setZoom(currentZoom - ZOOM_STEP);
}

function restoreZoomPreference() {
    const savedZoom = localStorage.getItem('weotzi-zoom');
    if (savedZoom) {
        setZoom(parseFloat(savedZoom));
    }
}

// ============================================
// LEVEL & MILESTONES SYSTEM
// ============================================

function updateLevelBadge() {
    if (!artistData) return;
    
    const levelBadge = document.getElementById('artist-level-badge');
    const levelText = document.getElementById('level-text');
    const nivel = artistData.nivel || 'Nuevo';
    
    levelText.textContent = nivel;
    levelBadge.setAttribute('data-level', nivel);
}

function updateMilestonesUI() {
    if (!artistData) return;
    
    // Update each milestone based on artistData
    for (const [field, elementId] of Object.entries(MILESTONES)) {
        const element = document.getElementById(elementId);
        if (element) {
            if (artistData[field]) {
                element.classList.add('completed');
            } else {
                element.classList.remove('completed');
            }
        }
    }
}

async function checkProfileCompletion() {
    if (!artistData || !currentUser) return;
    
    // Already completed, no need to check again
    if (artistData.ms_profile_complete) return;
    
    // Define required fields for profile completion
    const requiredFields = [
        'name',
        'username',
        'ubicacion',
        'styles_array',
        'session_price',
        'years_experience',
        'whatsapp_number',
        'instagram',
        'profile_picture'
    ];
    
    // Check if all required fields are filled
    const isComplete = requiredFields.every(field => {
        const value = artistData[field];
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        return value && value.trim && value.trim() !== '';
    });
    
    if (isComplete) {
        await trackMilestone('ms_profile_complete');
    }
}

async function trackMilestone(milestoneField) {
    if (!currentUser || !artistData) return;
    
    // Already completed
    if (artistData[milestoneField]) return;
    
    try {
        const updateData = { [milestoneField]: true };
        
        const { error } = await _supabase
            .from('artists_db')
            .update(updateData)
            .eq('user_id', currentUser.id);
        
        if (error) throw error;
        
        // Update local data
        artistData[milestoneField] = true;
        
        // Update UI
        updateMilestonesUI();
        
        // Show success feedback
        const milestoneNames = {
            ms_profile_complete: 'Perfil Completo',
            ms_first_quote_received: 'Primera Cotizacion Recibida',
            ms_whatsapp_shared: 'Enlace WhatsApp Compartido',
            ms_profile_shared: 'Perfil Compartido',
            ms_first_quote_completed: 'Primera Cotizacion Completada'
        };
        
        showStatusMessage(`Hito desbloqueado: ${milestoneNames[milestoneField]}!`, 'success');
        
        console.log(`Milestone unlocked: ${milestoneField}`);
        
    } catch (error) {
        console.error('Error tracking milestone:', error);
    }
}

async function shareProfile() {
    const shareBtn = document.getElementById('share-profile-btn');
    const username = artistData?.username || 'artista';
    
    // Generate profile URL pointing to the public profile page
    const baseUrl = window.location.origin;
    const profileUrl = `${baseUrl}/artist/profile?artist=${encodeURIComponent(username)}`;
    const shareText = `Mira mi perfil de artista en We Otzi: ${profileUrl}`;
    
    // Try native share API first (mobile)
    if (navigator.share) {
        try {
            await navigator.share({
                title: `${username} - We Otzi`,
                text: `Conoce mi trabajo como tatuador en We Otzi`,
                url: profileUrl
            });
            
            // Track milestone
            trackMilestone('ms_profile_shared');
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
        showStatusMessage('Enlace de perfil copiado al portapapeles.', 'success');
        
        // Track milestone
        trackMilestone('ms_profile_shared');
        
        setTimeout(() => shareBtn.classList.remove('shared'), 2000);
    } catch (err) {
        console.error('Error sharing profile:', err);
        showStatusMessage('Error al compartir el perfil.', 'error');
    }
}

// Check for quote-based milestones
async function checkQuoteMilestones(stats) {
    if (!currentUser || !artistData) return;
    
    // Check if received at least 1 quote
    if (stats.total > 0 && !artistData.ms_first_quote_received) {
        await trackMilestone('ms_first_quote_received');
    }
    
    // Check if completed at least 1 quote (status 'responded' or 'completed')
    if (stats.answered > 0 && !artistData.ms_first_quote_completed) {
        await trackMilestone('ms_first_quote_completed');
    }
}

// ============================================
// PREVIEW PUBLIC PROFILE
// ============================================

function previewPublicProfile() {
    if (!artistData || !artistData.username) {
        showStatusMessage('No se puede mostrar el perfil. Completa tu perfil primero.', 'error');
        return;
    }
    
    const username = artistData.username;
    const baseUrl = window.location.origin;
    const profileUrl = `${baseUrl}/artist/profile?artist=${encodeURIComponent(username)}`;
    
    // Open in new tab
    window.open(profileUrl, '_blank');
}

// ============================================
// GALLERY EDIT MODE FUNCTIONS
// ============================================

function renderGalleryEditPreview() {
    const previewContainer = document.getElementById('gallery-edit-preview');
    const countEl = document.getElementById('gallery-edit-count');
    const images = artistData?.gallery_images || [];

    if (!previewContainer) return;

    // Update count
    if (countEl) {
        countEl.textContent = `${images.length}/${MAX_GALLERY_IMAGES} imagenes`;
    }

    if (images.length === 0) {
        previewContainer.innerHTML = '<div class="gallery-edit-empty">Sin imagenes. Sube fotos de tus trabajos.</div>';
        return;
    }

    previewContainer.innerHTML = images.map((url, index) => `
        <div class="gallery-edit-thumb" data-index="${index}">
            <img src="${url}" alt="Trabajo ${index + 1}" loading="lazy">
            <button class="gallery-edit-thumb-delete" onclick="deleteGalleryEditImage(${index})" aria-label="Eliminar imagen">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `).join('');
}

async function handleGalleryEditUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentImages = artistData?.gallery_images || [];
    const remainingSlots = MAX_GALLERY_IMAGES - currentImages.length;

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} imagenes mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    // Validate file types and sizes
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            showStatusMessage('Solo se permiten archivos de imagen.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 5MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    // Show loading state
    const uploadBtn = document.querySelector('.gallery-edit-upload-btn span');
    const originalText = uploadBtn?.textContent;
    if (uploadBtn) uploadBtn.textContent = 'Subiendo...';

    try {
        const uploadedUrls = [];

        for (const file of files) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { data: uploadData, error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                continue;
            }

            const { data: urlData } = _supabase.storage
                .from('artist-gallery')
                .getPublicUrl(filePath);

            uploadedUrls.push(urlData.publicUrl);
        }

        if (uploadedUrls.length > 0) {
            const newGalleryImages = [...currentImages, ...uploadedUrls];

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ gallery_images: newGalleryImages })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            artistData.gallery_images = newGalleryImages;
            renderGalleryEditPreview();
            renderGalleryAdmin();
            showStatusMessage(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`, 'success');
        }

    } catch (error) {
        console.error('Error uploading gallery images:', error);
        showStatusMessage('Error al subir las imagenes.', 'error');
    } finally {
        if (uploadBtn) uploadBtn.textContent = originalText || 'Subir Imagenes';
        e.target.value = '';
    }
}

async function deleteGalleryEditImage(index) {
    const images = artistData?.gallery_images || [];
    const imageUrl = images[index];

    if (!imageUrl) return;

    if (!confirm('Estas seguro de eliminar esta imagen?')) return;

    try {
        // Extract file path from URL
        const urlParts = imageUrl.split('/artist-gallery/');
        if (urlParts.length > 1) {
            const filePath = urlParts[1];
            
            await _supabase.storage
                .from('artist-gallery')
                .remove([filePath]);
        }

        // Update database
        const newImages = images.filter((_, i) => i !== index);

        const { error } = await _supabase
            .from('artists_db')
            .update({ gallery_images: newImages })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        artistData.gallery_images = newImages;
        renderGalleryEditPreview();
        renderGalleryAdmin();
        showStatusMessage('Imagen eliminada correctamente.', 'success');

    } catch (error) {
        console.error('Error deleting gallery image:', error);
        showStatusMessage('Error al eliminar la imagen.', 'error');
    }
}
