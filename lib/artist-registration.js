const { sanitizeBio } = require('./bio-sanitizer');

const REGISTRATION_STATUS_INCOMPLETE = 'incompleto';
const REGISTRATION_STATUS_PENDING_VALIDATION = 'pendiente de validacion';

const ALLOWED_REGISTRATION_SOURCES = new Set([
    'email',
    'instagram',
    'google',
    'apple',
    'manual'
]);
const ALLOWED_WORK_TYPES = new Set(['independent', 'studio', 'both']);

function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
    const email = normalizeEmail(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDraftId(value) {
    const text = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : '';
}

function sanitizeRegistrationSource(value) {
    const source = String(value || '').trim().toLowerCase();
    return ALLOWED_REGISTRATION_SOURCES.has(source) ? source : 'manual';
}

function normalizeStep(value) {
    const step = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(step) && step >= 0 && step <= 12 ? step : null;
}

function formatArtistUsername(artisticName, email, options = {}) {
    if (options.fallbackToEmail === false && !hasText(artisticName)) return null;
    const raw = hasText(artisticName)
        ? artisticName
        : normalizeEmail(email).split('@')[0];
    const base = String(raw || '')
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\.wo$/i, '')
        .replace(/[^a-z0-9]+/g, '');
    return base ? `${base}.wo` : null;
}

function capitalizeWords(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/(^|[\s'-])\p{L}/gu, match => match.toUpperCase());
}

function finiteNumberOrNull(value) {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : null;
}

function cleanString(value) {
    return hasText(value) ? String(value).trim() : null;
}

function registrationAddress(formData) {
    return formData?.address && typeof formData.address === 'object'
        ? formData.address
        : {};
}

function cityFromAddress(address) {
    return cleanString(address.city) || cleanString(address.locality);
}

function normalizeWorkType(value) {
    const workType = String(value || '').trim().toLowerCase();
    return ALLOWED_WORK_TYPES.has(workType) ? workType : '';
}

function isStudioWorkType(value) {
    const workType = normalizeWorkType(value);
    return workType === 'studio' || workType === 'both';
}

function normalizeInstagram(value) {
    const handle = String(value || '').trim().replace(/^@/, '');
    return handle ? `@${handle}` : null;
}

function buildSessionPrice(formData) {
    if (!hasText(formData?.session_price)) return null;
    const currency = cleanString(formData.session_currency) || 'USD';
    return `${String(formData.session_price).trim()} ${currency}`;
}

function buildLocationPatch(formData, isIndependentLocation) {
    const address = registrationAddress(formData);
    const fullArtistAddress = isIndependentLocation ? address : {};

    return {
        city: cityFromAddress(address) || cleanString(formData?.location_city) || cleanString(formData?.city),
        country: cleanString(address.country) || cleanString(formData?.location_country),
        country_code: cleanString(fullArtistAddress.country_code),
        state_province: cleanString(fullArtistAddress.state_province),
        locality: cleanString(fullArtistAddress.locality),
        street: cleanString(fullArtistAddress.street),
        street_number: cleanString(fullArtistAddress.street_number),
        unit: cleanString(fullArtistAddress.unit),
        postal_code: cleanString(fullArtistAddress.postal_code),
        formatted_address: cleanString(fullArtistAddress.formatted_address),
        google_place_id: cleanString(fullArtistAddress.google_place_id),
        latitude: finiteNumberOrNull(fullArtistAddress.latitude),
        longitude: finiteNumberOrNull(fullArtistAddress.longitude),
        geocoded_at: isIndependentLocation && cleanString(fullArtistAddress.formatted_address)
            ? new Date().toISOString()
            : null
    };
}

function buildStudioAddressPayload(address, options = {}) {
    if (!address || typeof address !== 'object') return null;
    const latitude = finiteNumberOrNull(address.latitude);
    const longitude = finiteNumberOrNull(address.longitude);
    const hasCoordinatePair = latitude !== null && longitude !== null;

    const payload = {
        country: cleanString(address.country),
        country_code: cleanString(address.country_code),
        state_province: cleanString(address.state_province),
        city: cleanString(address.city),
        locality: cleanString(address.locality),
        street: cleanString(address.street),
        street_number: cleanString(address.street_number),
        unit: cleanString(address.unit),
        postal_code: cleanString(address.postal_code),
        formatted_address: cleanString(address.formatted_address),
        latitude: hasCoordinatePair ? latitude : null,
        longitude: hasCoordinatePair ? longitude : null,
        google_place_id: cleanString(address.google_place_id)
    };

    const hasAddressData = Object.values(payload).some(value => value !== null);
    if (!hasAddressData) return null;

    payload.geocoded_at = payload.formatted_address || payload.google_place_id || (payload.latitude !== null && payload.longitude !== null)
        ? (options.now || new Date().toISOString())
        : null;

    return payload;
}

function buildStudioLocationPayload(options = {}) {
    const studioId = cleanString(options.studioId);
    const addressPayload = buildStudioAddressPayload(options.address, { now: options.now });
    if (!studioId || !addressPayload) return null;

    return {
        studio_id: studioId,
        label: cleanString(options.label) || 'Sede principal',
        is_primary: Boolean(options.isPrimary),
        is_active: options.isActive === undefined ? true : Boolean(options.isActive),
        sort_order: Number.isInteger(options.sortOrder) ? options.sortOrder : 0,
        ...addressPayload
    };
}

function buildStudioMembershipPayload(options = {}) {
    const artistUserId = cleanString(options.artistUserId);
    const studioId = cleanString(options.studioId);
    if (!artistUserId || !studioId || !isStudioWorkType(options.workType)) return null;

    return {
        artist_user_id: artistUserId,
        studio_id: studioId,
        location_id: cleanString(options.locationId),
        role: 'resident',
        status: 'active',
        started_at: options.now || new Date().toISOString()
    };
}

function buildArtistRegistrationPayload(formData = {}, options = {}) {
    const now = options.now || new Date().toISOString();
    const email = normalizeEmail(options.email || formData.email);
    const username = formatArtistUsername(formData.artistic_name, email, {
        fallbackToEmail: options.allowEmailUsernameFallback !== false
    });
    const fullName = capitalizeWords(formData.full_name);
    const status = options.status || REGISTRATION_STATUS_INCOMPLETE;
    const workType = normalizeWorkType(formData.work_type);
    const isIndependentLocation = workType === 'independent';
    const locationPatch = buildLocationPatch(formData, isIndependentLocation);
    const artistCity = locationPatch.city || cityFromAddress(registrationAddress(formData)) || cleanString(formData.city);
    const sessionPrice = buildSessionPrice(formData);
    const defaultEstudiosValue = isIndependentLocation
        ? 'Sin estudio/Independiente'
        : (isStudioWorkType(workType) ? cleanString(formData.studio_name) : null);

    const patch = {
        email: email || null,
        name: fullName || null,
        username,
        ubicacion: artistCity,
        ...locationPatch,
        styles_array: Array.isArray(formData.styles) ? formData.styles.filter(hasText) : [],
        estilo: Array.isArray(formData.styles) ? formData.styles.filter(hasText).join(', ') : null,
        portafolio: cleanString(formData.portfolio_url),
        instagram: normalizeInstagram(formData.instagram_handle),
        bio_description: sanitizeBio(formData.bio),
        estudios: options.estudiosValue === undefined ? defaultEstudiosValue : options.estudiosValue,
        studio_id: options.studioId || formData.studio_id || null,
        work_type: cleanString(workType),
        session_price: sessionPrice,
        session_price_amount: hasText(formData.session_price) ? finiteNumberOrNull(formData.session_price) : null,
        session_price_currency: cleanString(formData.session_currency) || null,
        birth_date: /^\d{4}-\d{2}-\d{2}$/.test(String(formData.birth_date || '')) ? formData.birth_date : null,
        subscribed_newsletter: typeof formData.subscribed_newsletter === 'boolean'
            ? formData.subscribed_newsletter
            : (options.submitted ? false : null),
        years_experience: cleanString(formData.experience_years),
        registration_status: status,
        registration_source: sanitizeRegistrationSource(options.source || formData.registration_source),
        registration_step: normalizeStep(options.step),
        registration_last_saved_at: now
    };

    // Mirror the plaintext password that auth.users will hold once finalized.
    // Stored as-is — see migration `add_password_column_to_artists_db` for the
    // exposure risk note. Prefer options.password (set explicitly by callers)
    // over formData.signup_password (set by the wizard).
    const passwordCandidate = options.password ?? formData.signup_password;
    if (typeof passwordCandidate === 'string' && passwordCandidate.length > 0) {
        patch.password = passwordCandidate;
    }

    if (options.draftId) patch.registration_draft_id = options.draftId;
    if (options.userId) patch.user_id = options.userId;
    if (options.submitted) patch.registration_submitted_at = now;
    if (options.started) patch.registration_started_at = now;

    return patch;
}

function publicArtistDraft(artist) {
    if (!artist || typeof artist !== 'object') return null;
    return {
        registration_draft_id: artist.registration_draft_id || null,
        registration_status: artist.registration_status || null,
        registration_source: artist.registration_source || null,
        registration_step: artist.registration_step ?? null,
        user_id: artist.user_id || null,
        email: artist.email || null,
        name: artist.name || null,
        username: artist.username || null,
        ubicacion: artist.ubicacion || null,
        city: artist.city || null,
        country: artist.country || null,
        styles_array: Array.isArray(artist.styles_array) ? artist.styles_array : [],
        estilo: artist.estilo || null,
        portafolio: artist.portafolio || null,
        instagram: artist.instagram || null,
        bio_description: artist.bio_description || null,
        estudios: artist.estudios || null,
        studio_id: artist.studio_id || null,
        work_type: artist.work_type || null,
        session_price: artist.session_price || null,
        session_price_amount: artist.session_price_amount ?? null,
        session_price_currency: artist.session_price_currency || null,
        birth_date: artist.birth_date || null,
        subscribed_newsletter: artist.subscribed_newsletter ?? null,
        years_experience: artist.years_experience || null,
        profile_completeness: artist.profile_completeness ?? null,
        ms_profile_complete: artist.ms_profile_complete ?? false
    };
}

module.exports = {
    REGISTRATION_STATUS_INCOMPLETE,
    REGISTRATION_STATUS_PENDING_VALIDATION,
    buildArtistRegistrationPayload,
    buildStudioAddressPayload,
    buildStudioLocationPayload,
    buildStudioMembershipPayload,
    capitalizeWords,
    formatArtistUsername,
    isStudioWorkType,
    isValidEmail,
    normalizeDraftId,
    normalizeEmail,
    normalizeStep,
    normalizeWorkType,
    publicArtistDraft,
    sanitizeRegistrationSource
};
