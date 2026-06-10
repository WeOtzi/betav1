'use strict';

const SIZE_SESSION_RULES = {
    pequeno: { min: 1, max: 1 },
    pequeño: { min: 1, max: 1 },
    mediano: { min: 1, max: 2 },
    grande: { min: 2, max: 3 },
    muy_grande: { min: 3, max: 5 },
    media_manga: { min: 3, max: 5 },
    manga_completa: { min: 6, max: 10 },
    espalda_completa: { min: 6, max: 10 },
    pecho_completo: { min: 4, max: 7 }
};

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseSessionPrice(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    let clean = String(value).replace(/[^\d.,]/g, '');
    if (!clean) return null;
    if (clean.includes(',') && clean.includes('.')) {
        clean = clean.lastIndexOf(',') > clean.lastIndexOf('.')
            ? clean.replace(/\./g, '').replace(',', '.')
            : clean.replace(/,/g, '');
    } else if (clean.includes(',')) {
        clean = /,\d{1,2}$/.test(clean) ? clean.replace(',', '.') : clean.replace(/,/g, '');
    } else if (clean.includes('.')) {
        const dotCount = (clean.match(/\./g) || []).length;
        if (dotCount > 1 || /^\d+\.\d{3}$/.test(clean)) clean = clean.replace(/\./g, '');
    }
    const amount = Number.parseFloat(clean);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function detectCurrency(value) {
    const raw = String(value || '').toUpperCase();
    if (/MXN|MEX/.test(raw)) return 'MXN';
    if (/COP/.test(raw)) return 'COP';
    if (/ARS/.test(raw)) return 'ARS';
    if (/CLP/.test(raw)) return 'CLP';
    if (/PEN/.test(raw)) return 'PEN';
    if (/EUR|€/.test(raw)) return 'EUR';
    if (/USD|US\$|U\$S|\$/.test(raw)) return 'USD';
    return null;
}

function parseStylesArray(styles) {
    if (!styles) return [];
    if (Array.isArray(styles)) return styles.filter(Boolean);
    if (typeof styles === 'string') {
        const trimmed = styles.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
            } catch (_) {
                return [trimmed];
            }
        }
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

function styleMatches(styles, targetStyle) {
    const target = normalizeText(targetStyle);
    if (!target) return false;
    return styles.some((style) => {
        const norm = normalizeText(style);
        return norm === target || norm.includes(target) || target.includes(norm);
    });
}

function splitLocation(value) {
    return String(value || '').split(/[,/]/).map(normalizeText).filter(Boolean);
}

function cityMatches(artist, cityToken) {
    if (!cityToken) return false;
    const tokens = [...splitLocation(artist.city), ...splitLocation(artist.ubicacion)];
    return tokens.some(token => token === cityToken || token.includes(cityToken) || cityToken.includes(token));
}

function countryMatches(artist, countryToken) {
    if (!countryToken) return false;
    const tokens = [...splitLocation(artist.country), ...splitLocation(artist.ubicacion)];
    return tokens.some(token => token === countryToken || token.includes(countryToken) || countryToken.includes(token));
}

function parseCityInput(rawCity) {
    const segments = String(rawCity || '').split(',').map(normalizeText).filter(Boolean);
    return { cityToken: segments[0] || null, countryToken: segments.length > 1 ? segments[segments.length - 1] : null };
}

function quantile(sorted, q) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function estimatePreQuote(input, artists) {
    const safeArtists = Array.isArray(artists) ? artists : [];
    const city = parseCityInput(input && input.client_city_residence);
    const tiers = [[], [], [], [], []];

    safeArtists.forEach((artist) => {
        if (!artist || artist.verification_state === 'rejected') return;
        const styles = parseStylesArray(artist.styles_array);
        const price = parseSessionPrice(artist.session_price);
        const enriched = {
            user_id: artist.user_id,
            username: artist.username,
            name: artist.name,
            instagram: artist.instagram,
            portafolio: artist.portafolio,
            profile_picture: artist.profile_picture,
            estudios: artist.estudios,
            city: artist.city,
            country: artist.country,
            ubicacion: artist.ubicacion,
            session_price: artist.session_price,
            session_price_amount: price,
            session_price_currency: detectCurrency(artist.session_price),
            styles_array: styles,
            artist_index: Number(artist.artist_index || 0)
        };
        const matchStyle = styleMatches(styles, input && input.tattoo_style);
        const matchCity = cityMatches(enriched, city.cityToken);
        const matchCountry = countryMatches(enriched, city.countryToken);
        let tier = 5;
        let reasons = [];
        if (matchStyle && matchCity) { tier = 1; reasons = ['city', 'style']; }
        else if (matchStyle && matchCountry) { tier = 2; reasons = ['country', 'style']; }
        else if (matchStyle) { tier = 3; reasons = ['style']; }
        else if (matchCity) { tier = 4; reasons = ['city']; }
        tiers[tier - 1].push({ ...enriched, match_tier: tier, match_reasons: reasons });
    });

    const fallbackTier = tiers.findIndex(t => t.length > 0) + 1 || 0;
    const sample = fallbackTier ? tiers[fallbackTier - 1] : [];
    const prices = sample.map(a => a.session_price_amount).filter(Boolean).sort((a, b) => a - b);
    const sizeKey = normalizeText(input && input.tattoo_size).replace(/\s+/g, '_');
    const sessions = SIZE_SESSION_RULES[sizeKey] || { min: 1, max: 2 };
    const p25 = quantile(prices, 0.25);
    const p75 = quantile(prices, 0.75);
    const avg = prices.length ? prices.reduce((sum, p) => sum + p, 0) / prices.length : 0;

    const suggestedArtists = tiers.flat()
        .sort((a, b) => a.match_tier - b.match_tier || b.artist_index - a.artist_index)
        .slice(0, 6);

    const confidence = tiers[0].length >= 5 ? 'alta' : (tiers[0].length + tiers[1].length >= 3 || prices.length >= 3 ? 'media' : 'baja');

    return {
        estimate: {
            minAmount: Math.round(p25 * sessions.min) || 0,
            maxAmount: Math.round(p75 * sessions.max) || 0,
            averageAmount: Math.round(avg * ((sessions.min + sessions.max) / 2)) || 0,
            currency: sample.find(a => a.session_price_currency)?.session_price_currency || 'USD',
            estimatedSessionsMin: sessions.min,
            estimatedSessionsMax: sessions.max,
            sampleSize: prices.length,
            fallbackTier,
            confidence
        },
        suggestedArtists,
        matchedArtists: tiers.flat().map(a => ({
            user_id: a.user_id,
            username: a.username,
            match_tier: a.match_tier,
            match_reasons: a.match_reasons,
            session_price_amount: a.session_price_amount
        })),
        fallbackTier
    };
}

module.exports = {
    SIZE_SESSION_RULES,
    normalizeText,
    parseSessionPrice,
    detectCurrency,
    parseStylesArray,
    estimatePreQuote
};
