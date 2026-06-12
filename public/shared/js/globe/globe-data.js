/**
 * GLOBE DATA — capa de datos del globo (/explore/globe)
 *
 * Portada de la capa de datos del explore-globe.js original:
 *   - fetchArtists(): roster con coordenadas (vista artists_with_location,
 *     fallback a artists_db).
 *   - fetchStudios(): estudios activos con TODAS sus sedes (studio_locations).
 *   - fetchArtistItinerary(userId): paradas current/upcoming ordenadas con
 *     coordenadas resueltas (studio_locations primario → geocoder).
 *   - buildSearchIndex(): índice para el typeahead (artistas, estudios,
 *     ciudades, estilos).
 */

export function waitForConfigManager(maxWait = 6000) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        (function check() {
            if (window.ConfigManager && window.ConfigManager.getSupabaseClient
                && window.ConfigManager.getSupabaseClient()) return resolve(true);
            if (Date.now() - t0 > maxWait) return resolve(false);
            setTimeout(check, 120);
        })();
    });
}

function sb() {
    return window.ConfigManager && window.ConfigManager.getSupabaseClient
        ? window.ConfigManager.getSupabaseClient()
        : null;
}

const itineraryCache = new Map();

export async function fetchArtists() {
    const supabase = sb();
    if (!supabase) return [];
    const cols = [
        'user_id', 'username', 'name', 'profile_picture', 'styles_array',
        'session_price', 'years_experience', 'languages', 'bio_description',
        'is_recommended', 'work_type', 'studio_id', 'studio_name',
        'country', 'country_code', 'state_province', 'city', 'locality',
        'formatted_address', 'latitude', 'longitude'
    ].join(',');

    let resp = await supabase.from('artists_with_location').select(cols);
    if (resp.error) {
        console.warn('[globe-data] artists_with_location no disponible, fallback:', resp.error.message);
        resp = await supabase.from('artists_db').select(
            'user_id,username,name,profile_picture,styles_array,city,country,session_price,' +
            'years_experience,languages,bio_description,is_recommended,latitude,longitude,' +
            'formatted_address,work_type,studio_id,studio_name'
        );
    }
    if (resp.error) {
        console.error('[globe-data] error cargando artistas:', resp.error.message);
        return [];
    }
    return (resp.data || [])
        .filter(a => Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude)))
        .map(a => ({
            ...a,
            latitude: Number(a.latitude),
            longitude: Number(a.longitude),
            styles: Array.isArray(a.styles_array) ? a.styles_array : [],
            languages: a.languages || ['Español'],
            country: a.country || ''
        }));
}

export async function fetchStudios() {
    const supabase = sb();
    if (!supabase) return [];
    const [stResp, locResp] = await Promise.all([
        supabase.from('studios')
            .select('id, name, slug, tagline, logo_image, cover_image, city, country, instagram, website, is_verified, is_seeking_artists')
            .eq('is_active', true),
        supabase.from('studio_locations')
            .select('id, studio_id, label, city, country, formatted_address, latitude, longitude, is_primary, is_active, is_seeking_artists')
            .eq('is_active', true)
    ]);
    if (stResp.error) {
        console.error('[globe-data] error cargando estudios:', stResp.error.message);
        return [];
    }
    const locsByStudio = new Map();
    (locResp.data || []).forEach(l => {
        if (!Number.isFinite(Number(l.latitude)) || !Number.isFinite(Number(l.longitude))) return;
        const arr = locsByStudio.get(l.studio_id) || [];
        arr.push({ ...l, latitude: Number(l.latitude), longitude: Number(l.longitude) });
        locsByStudio.set(l.studio_id, arr);
    });
    return (stResp.data || [])
        .map(s => {
            const locations = (locsByStudio.get(s.id) || [])
                .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
            return { ...s, locations };
        })
        .filter(s => s.locations.length > 0);
}

export async function fetchArtistItinerary(userId) {
    if (itineraryCache.has(userId)) return itineraryCache.get(userId);
    const supabase = sb();
    if (!supabase || !userId) return [];

    const resp = await supabase
        .from('artist_tattoo_locations')
        .select('id, period_type, studio_name, city, start_date, end_date, agenda_status, sort_order, studio_id')
        .eq('artist_user_id', userId);
    if (resp.error || !Array.isArray(resp.data) || !resp.data.length) {
        if (resp.error) console.warn('[globe-data] itinerario:', resp.error.message);
        itineraryCache.set(userId, []);
        return [];
    }

    const rows = resp.data.slice().sort((a, b) => {
        const ap = a.period_type === 'current' ? 0 : 1;
        const bp = b.period_type === 'current' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        if (a.period_type === 'current') return (a.sort_order || 0) - (b.sort_order || 0);
        const ad = a.start_date ? new Date(a.start_date).getTime() : 0;
        const bd = b.start_date ? new Date(b.start_date).getTime() : 0;
        return ad - bd;
    });

    // Fase 1: coordenadas vía sede primaria del estudio (un solo round-trip)
    const studioIds = [...new Set(rows.map(r => r.studio_id).filter(Boolean))];
    const studioCoords = new Map();
    if (studioIds.length) {
        const slResp = await supabase
            .from('studio_locations')
            .select('studio_id, latitude, longitude, formatted_address, city, country')
            .in('studio_id', studioIds)
            .eq('is_primary', true);
        if (!slResp.error && Array.isArray(slResp.data)) {
            slResp.data.forEach(sl => studioCoords.set(sl.studio_id, sl));
        }
    }

    // Fase 2: geocodificar las paradas que solo tienen ciudad
    const enriched = [];
    for (const r of rows) {
        const item = {
            id: r.id,
            period_type: r.period_type,
            studio_name: r.studio_name,
            studio_id: r.studio_id,
            city: r.city,
            start_date: r.start_date,
            end_date: r.end_date,
            agenda_status: r.agenda_status,
            lat: null, lng: null, formatted_address: null, source: null
        };
        if (r.studio_id && studioCoords.has(r.studio_id)) {
            const sl = studioCoords.get(r.studio_id);
            item.lat = Number(sl.latitude);
            item.lng = Number(sl.longitude);
            item.formatted_address = sl.formatted_address || [sl.city, sl.country].filter(Boolean).join(', ');
            item.source = 'studio';
        } else if (r.city && window.WeOtziGeocoder?.geocodeQuery) {
            try {
                const point = await window.WeOtziGeocoder.geocodeQuery(r.city);
                if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
                    item.lat = point.lat;
                    item.lng = point.lng;
                    item.formatted_address = point.displayName || r.city;
                    item.source = 'geocoded';
                }
            } catch { /* se omite la parada sin coordenadas */ }
        }
        if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) enriched.push(item);
    }
    itineraryCache.set(userId, enriched);
    return enriched;
}

// -------------------------------------------------------------------
// Índice de búsqueda
// -------------------------------------------------------------------
function norm(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function buildSearchIndex(artists, studios) {
    const entries = [];
    artists.forEach(a => {
        if (!a.name && !a.username) return; // perfiles stub sin identidad
        entries.push({
            type: 'artist',
            key: norm(`${a.name} ${a.username} ${a.city} ${a.country}`),
            label: a.name || a.username,
            sub: [a.city, a.country].filter(Boolean).join(', '),
            ref: a
        });
    });
    studios.forEach(s => entries.push({
        type: 'studio',
        key: norm(`${s.name} ${s.locations.map(l => l.city).join(' ')}`),
        label: s.name,
        sub: s.locations.length > 1
            ? `${s.locations.length} sedes`
            : [s.locations[0].city, s.locations[0].country].filter(Boolean).join(', '),
        ref: s
    }));

    const cityMap = new Map();
    const addCity = (city, country, lat, lng) => {
        if (!city || !Number.isFinite(lat)) return;
        const k = norm(`${city}|${country}`);
        const e = cityMap.get(k) || { city, country, lat, lng, count: 0 };
        e.count++;
        cityMap.set(k, e);
    };
    artists.forEach(a => addCity(a.city, a.country, a.latitude, a.longitude));
    studios.forEach(s => s.locations.forEach(l => addCity(l.city, l.country, l.latitude, l.longitude)));
    cityMap.forEach(c => entries.push({
        type: 'city',
        key: norm(`${c.city} ${c.country}`),
        label: c.city,
        sub: [c.country, `${c.count} en WeOtzi`].filter(Boolean).join(' · '),
        ref: c
    }));

    const styleMap = new Map();
    artists.forEach(a => a.styles.forEach(st => {
        const k = norm(st);
        const e = styleMap.get(k) || { style: st, count: 0 };
        e.count++;
        styleMap.set(k, e);
    }));
    styleMap.forEach(s => entries.push({
        type: 'style',
        key: norm(s.style),
        label: s.style,
        sub: `${s.count} artista${s.count === 1 ? '' : 's'}`,
        ref: s
    }));

    return {
        search(query, limit = 9) {
            const q = norm(query).trim();
            if (q.length < 2) return [];
            const scored = [];
            for (const e of entries) {
                const idx = e.key.indexOf(q);
                if (idx === -1) continue;
                // Prefijo de palabra puntúa mejor que coincidencia interna
                const wordStart = idx === 0 || e.key[idx - 1] === ' ';
                scored.push({ e, score: (wordStart ? 0 : 10) + idx });
            }
            scored.sort((a, b) => a.score - b.score);
            return scored.slice(0, limit).map(s => s.e);
        }
    };
}
