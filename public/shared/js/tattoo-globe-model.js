/* Page-local presentation model. Figma examples are confined to isolated preview.
 * There is no client passport repository yet: never fabricate a real history. */
(function (root) {
    'use strict';
    const catalog = [
        { id: 'madrid', city: 'Madrid', country: 'España', artists: 38, studios: 9 },
        { id: 'paris', city: 'París', country: 'Francia', artists: 51, studios: 14 },
        { id: 'tokyo', city: 'Tokio', country: 'Japón', artists: 29, studios: 8 },
        { id: 'barcelona', city: 'Barcelona', country: 'España', artists: 33, studios: 10 },
        { id: 'mexico', city: 'Ciudad de México', country: 'México', artists: 36, studios: 11 },
        { id: 'sao-paulo', city: 'São Paulo', country: 'Brasil', artists: 47, studios: 15 }
    ];
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    function matchesCity(artist, city) {
        return !city || normalize(artist.city) === normalize(city);
    }
    function buildScreen({ preview = false, artists = [] } = {}) {
        return {
            destinations: catalog.map(destination => {
                if (preview) return { ...destination };
                const rows = artists.filter(artist => matchesCity(artist, destination.city));
                return { ...destination, artists: rows.length,
                    studios: new Set(rows.map(artist => artist.studio_id).filter(Boolean)).size };
            }),
            stamps: preview ? [
                { city: 'Buenos Aires', country: 'Argentina', tattoos: 3, artists: 2, year: 2025 },
                { city: 'São Paulo', country: 'Brasil', tattoos: 1, artists: 1, year: 2024 },
                { city: 'Bogotá', country: 'Colombia', tattoos: 2, artists: 2, year: 2023 }
            ] : [],
            journey: preview ? [3, 3, 6, 5, '4,180'] : null,
            savedIds: preview ? ['madrid', 'paris', 'barcelona'] : []
        };
    }
    function readSaved(raw, fallback) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return [...new Set(parsed.filter(id => catalog.some(row => row.id === id)))];
        } catch (_) { /* Corrupt/unavailable browser storage is non-fatal. */ }
        return fallback.slice();
    }
    root.TattooGlobeModel = { buildScreen, matchesCity, readSaved };
}(window));
