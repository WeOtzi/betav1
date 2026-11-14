'use strict';

// ===========================================================================
// Meta del perfil público del artista renderizados del lado del servidor
// (auditoría perfil-publico PP-01).
// ---------------------------------------------------------------------------
// WhatsApp, Instagram, Facebook, X, Telegram y LinkedIn no ejecutan JS: leen
// el HTML tal como sale del servidor. Este módulo puro arma los meta OG /
// Twitter / canonical / robots de un artista y los inyecta en el HTML de
// public/artist/profile/index.html (lib/routes/perfil.js lo usa).
//
// Todo valor que viene de la base se escapa. Las imágenes tienen que ser
// URLs absolutas http(s) y raster: las rutas relativas (/shared/assets/demo/*.svg),
// los SVG y los videos se descartan y se usa la imagen por defecto.
// ===========================================================================

const { bioHtmlToPlainText } = require('./bio-sanitizer');

const SITE_NAME = 'We Ötzi';
const DESCRIPTION_MAX = 160;
const DEFAULT_IMAGE_PATH = '/shared/img/og-default.jpg';
const DEFAULT_IMAGE_SIZE = { width: 1200, height: 630 };
const DEFAULT_TITLE = 'Perfil del artista · We Ötzi';
const DEFAULT_DESCRIPTION = 'Conocé el trabajo de este artista tatuador en We Ötzi y pedile una cotización.';

function escapeAttr(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

function truncate(text, max = DESCRIPTION_MAX) {
    const clean = collapse(text);
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:·-]+$/, '') + '…';
}

function parseList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
    } catch (_) {
        return [value];
    }
}

const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;
const SVG_RE = /\.svg$/i;

/** URL absoluta http(s) de una imagen raster, o '' si no sirve para OG. */
function absoluteImageUrl(value) {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        const pathname = url.pathname || '';
        if (VIDEO_RE.test(pathname) || SVG_RE.test(pathname)) return '';
        return url.href;
    } catch (_) {
        return '';
    }
}

/**
 * Imagen para la vista previa: foto de perfil → primer trabajo de la galería
 * (gallery_images ya viene filtrada por la validación de Instagram en SQL) →
 * imagen por defecto de la marca.
 */
function pickImage(artist, defaultImage) {
    const picture = absoluteImageUrl(artist && artist.profile_picture);
    if (picture) return { url: picture, isDefault: false };
    for (const entry of parseList(artist && artist.gallery_images)) {
        const candidate = typeof entry === 'string' ? entry : entry && entry.url;
        if (entry && typeof entry === 'object' && entry.kind === 'video') continue;
        const url = absoluteImageUrl(candidate);
        if (url) return { url, isDefault: false };
    }
    return { url: defaultImage || '', isDefault: true };
}

function displayName(artist, prefs) {
    const profile = (prefs && prefs.profile) || {};
    const handle = String((artist && artist.username) || '').replace(/^@/, '').replace(/\.wo$/i, '');
    return collapse((artist && artist.name) || profile.full_name || handle || 'Artista');
}

function describe(artist, prefs, name) {
    const bio = truncate(bioHtmlToPlainText((artist && artist.bio_description) || ''));
    if (bio) return bio;
    const privacy = (prefs && prefs.privacy) || {};
    const styles = parseList(artist && artist.styles_array).map(collapse).filter(Boolean).slice(0, 3);
    const city = privacy.show_city === false ? '' : collapse(artist && artist.city);
    const parts = [];
    if (styles.length) parts.push(styles.join(', '));
    if (city) parts.push(city);
    const lead = parts.length ? `${parts.join(' · ')}. ` : '';
    return truncate(`${lead}Mirá el portafolio de ${name} y pedile una cotización en We Ötzi.`);
}

/**
 * @param {object} input
 * @param {object} input.artist        fila pública de artists_db
 * @param {object} [input.prefs]       get_artist_public_profile_preferences
 * @param {string} input.canonicalUrl  URL absoluta canónica del perfil
 * @param {string} input.defaultImage  URL absoluta de la imagen por defecto
 */
function buildArtistMeta({ artist, prefs, canonicalUrl, defaultImage }) {
    const name = displayName(artist, prefs);
    const image = pickImage(artist, defaultImage);
    const allowIndex = !!(prefs && prefs.privacy && prefs.privacy.allow_search_indexing === true);
    const username = String((artist && artist.username) || '').replace(/^@/, '');
    return {
        title: `${name} · Tatuador en We Ötzi`,
        description: describe(artist, prefs, name),
        image: image.url,
        imageAlt: image.isDefault ? 'We Ötzi, la plataforma del tatuaje' : `Foto de ${name}`,
        imageSize: image.isDefault ? DEFAULT_IMAGE_SIZE : null,
        url: canonicalUrl || '',
        robots: allowIndex ? 'index,follow' : 'noindex,nofollow',
        username
    };
}

/** Meta genéricos (artista inexistente o error): nunca indexables. */
function buildFallbackMeta({ canonicalUrl, defaultImage } = {}) {
    return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        image: defaultImage || '',
        imageAlt: 'We Ötzi, la plataforma del tatuaje',
        imageSize: defaultImage ? DEFAULT_IMAGE_SIZE : null,
        url: canonicalUrl || '',
        robots: 'noindex,nofollow',
        username: ''
    };
}

function metaTag(attr, key, id, content) {
    return `<meta ${attr}="${escapeAttr(key)}" id="${escapeAttr(id)}" content="${escapeAttr(content)}">`;
}

/** Etiquetas que se escriben, con el id que las identifica en el HTML base. */
function tagsFor(meta) {
    const tags = [
        ['profile-description', metaTag('name', 'description', 'profile-description', meta.description)],
        ['profile-robots', metaTag('name', 'robots', 'profile-robots', meta.robots)],
        ['og-type', metaTag('property', 'og:type', 'og-type', 'profile')],
        ['og-site-name', metaTag('property', 'og:site_name', 'og-site-name', SITE_NAME)],
        ['og-locale', metaTag('property', 'og:locale', 'og-locale', 'es_AR')],
        ['og-title', metaTag('property', 'og:title', 'og-title', meta.title)],
        ['og-description', metaTag('property', 'og:description', 'og-description', meta.description)],
        ['og-url', metaTag('property', 'og:url', 'og-url', meta.url)],
        ['og-image', metaTag('property', 'og:image', 'og-image', meta.image)],
        ['og-image-alt', metaTag('property', 'og:image:alt', 'og-image-alt', meta.imageAlt)],
        ['og-image-width', metaTag('property', 'og:image:width', 'og-image-width', meta.imageSize ? meta.imageSize.width : '')],
        ['og-image-height', metaTag('property', 'og:image:height', 'og-image-height', meta.imageSize ? meta.imageSize.height : '')],
        ['profile-username', metaTag('property', 'profile:username', 'profile-username', meta.username)],
        ['twitter-card', metaTag('name', 'twitter:card', 'twitter-card', 'summary_large_image')],
        ['twitter-title', metaTag('name', 'twitter:title', 'twitter-title', meta.title)],
        ['twitter-description', metaTag('name', 'twitter:description', 'twitter-description', meta.description)],
        ['twitter-image', metaTag('name', 'twitter:image', 'twitter-image', meta.image)],
        ['twitter-image-alt', metaTag('name', 'twitter:image:alt', 'twitter-image-alt', meta.imageAlt)],
        ['profile-canonical', `<link rel="canonical" id="profile-canonical" href="${escapeAttr(meta.url)}">`]
    ];
    // Sin valor no se escribe la etiqueta (un og:image vacío confunde a los bots).
    return tags.filter(([id]) => {
        if (id === 'og-image-width' || id === 'og-image-height') return !!meta.imageSize;
        if (id === 'og-url' || id === 'profile-canonical') return !!meta.url;
        if (id === 'og-image' || id === 'twitter-image' || id === 'og-image-alt' || id === 'twitter-image-alt') return !!meta.image;
        if (id === 'profile-username') return !!meta.username;
        return true;
    });
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reemplaza <title> y cada etiqueta con id conocido; las que no estén en el
 * HTML base se agregan antes de </head>. Las etiquetas con id que quedan sin
 * valor se quitan.
 */
function injectMeta(html, meta) {
    let out = String(html || '');
    // Reemplazos con función: un `$&` en el nombre del artista no es un patrón.
    out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeAttr(meta.title)}</title>`);
    const wanted = tagsFor(meta);
    const wantedIds = new Set(wanted.map(([id]) => id));
    const missing = [];
    for (const [id, tag] of wanted) {
        const re = new RegExp(`<(meta|link)\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`, 'i');
        if (re.test(out)) out = out.replace(re, () => tag);
        else missing.push(tag);
    }
    for (const id of ['og-image', 'og-image-alt', 'og-image-width', 'og-image-height', 'og-url', 'profile-canonical',
        'profile-username', 'twitter-image', 'twitter-image-alt']) {
        if (wantedIds.has(id)) continue;
        out = out.replace(new RegExp(`\\s*<(meta|link)\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`, 'i'), '');
    }
    if (missing.length) {
        out = out.replace(/<\/head>/i, (end) => `    ${missing.join('\n    ')}\n${end}`);
    }
    return out;
}

module.exports = {
    SITE_NAME,
    DEFAULT_IMAGE_PATH,
    DEFAULT_IMAGE_SIZE,
    escapeAttr,
    truncate,
    absoluteImageUrl,
    pickImage,
    buildArtistMeta,
    buildFallbackMeta,
    injectMeta
};
