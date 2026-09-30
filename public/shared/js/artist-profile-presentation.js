(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ArtistProfilePresentation = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function filterKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function buildPortfolioFilterOptions(items, categoryLabels) {
        const safeItems = Array.isArray(items) ? items : [];
        const options = [{ value: 'todos', label: 'Todos' }];
        const seen = new Set(['todos']);
        const styleOptions = [];

        for (const item of safeItems) {
            for (const style of Array.isArray(item?.styles) ? item.styles : []) {
                const key = filterKey(style);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                styleOptions.push({ value: key, label: String(style).trim() });
            }
        }
        if (styleOptions.length) return options.concat(styleOptions);

        for (const item of safeItems) {
            const category = String(item?.category || '').trim().toLowerCase();
            if (!category || seen.has(category)) continue;
            seen.add(category);
            options.push({ value: category, label: categoryLabels?.[category] || category });
        }
        return options;
    }

    function buildSpecialtyRows(styles, items, descriptions) {
        const safeItems = Array.isArray(items) ? items : [];
        return (Array.isArray(styles) ? styles : []).filter(Boolean).map((style) => {
            const key = filterKey(style);
            const media = safeItems.find((item) => (
                Array.isArray(item?.styles)
                && item.styles.some((itemStyle) => filterKey(itemStyle) === key)
            ));
            return {
                name: String(style),
                key,
                description: String(descriptions?.[key] || ''),
                mediaUrl: String(media?.url || ''),
                mediaKind: media?.kind === 'video' ? 'video' : 'image'
            };
        });
    }

    function setDisclosureState(toggle, menu, open) {
        if (!toggle || !menu) return;
        toggle.setAttribute('aria-expanded', String(Boolean(open)));
        menu.hidden = !open;
    }

    return {
        filterKey,
        buildPortfolioFilterOptions,
        buildSpecialtyRows,
        setDisclosureState
    };
});
