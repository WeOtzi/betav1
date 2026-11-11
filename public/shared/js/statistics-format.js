/**
 * WE OTZI · Formatos puros de Estadísticas (Figma final 801:543, oct 2026).
 * Sin DOM: `window.StatisticsFormat` en el navegador y `require` en Node (tests).
 *
 *   formatKpiMoney(1240, 'USD')        → "US$1.240"   · (3150000, 'ARS') → "$3,15M"
 *   formatActivityTime(iso, now)       → "Hace 1 hora" · "Ayer, 18:40" · "Hace 2 días"
 *   formatVisitorTime(iso, now)        → "Hace 1 día"  · "Hace 3 horas"
 *   visitOrdinal(3)                    → "3ª"
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StatisticsFormat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const SYMBOLS = { ARS: '$', USD: 'US$', EUR: '€', MXN: 'MX$', CLP: 'CLP$', UYU: '$U', BRL: 'R$' };

    function currencySymbol(currency) {
        const code = String(currency || 'USD').toUpperCase();
        return SYMBOLS[code] || `${code} `;
    }

    // Figma: "$3,15M" (millones con 2 decimales) y números europeos "4.820".
    function formatKpiMoney(total, currency) {
        const amount = Math.max(0, Number(total) || 0);
        const symbol = currencySymbol(currency);
        if (amount >= 1000000) {
            return `${symbol}${(amount / 1000000).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
        }
        return `${symbol}${Math.round(amount).toLocaleString('es-AR')}`;
    }

    // KPI "Ingresos generados" a 40px como el resto (Figma 122:10769 "$3,15M"):
    // los montos largos se compactan en vez de achicar la tipografía.
    //   4890 USD → "US$4,9K" · 310000 ARS → "$310K" · 3150000 ARS → "$3,15M" · 820 → "US$820"
    function formatKpiMoneyCompact(total, currency) {
        const amount = Math.max(0, Number(total) || 0);
        const symbol = currencySymbol(currency);
        const millions = () => `${symbol}${(amount / 1000000).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
        if (amount >= 1000000) return millions();
        if (amount >= 1000) {
            const thousands = Math.round(amount / 100) / 10;
            if (thousands >= 1000) return millions();
            return `${symbol}${thousands.toLocaleString('es-AR', { maximumFractionDigits: 1 })}K`;
        }
        return `${symbol}${Math.round(amount).toLocaleString('es-AR')}`;
    }

    // Tasa entre dos etapas del embudo. Cada etapa sale de una fuente propia
    // (visitas diarias, cotizaciones), así que una etapa puede superar a la
    // anterior (solicitudes que no pasaron por el portfolio): la tasa se topa
    // en 100% en lugar de mostrar conversiones imposibles.
    function funnelRate(current, next) {
        const from = Number(current) || 0;
        const to = Math.max(0, Number(next) || 0);
        if (from <= 0) return null;
        return Math.min(100, Math.round((to / from) * 100));
    }

    function toDate(value) {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (value == null || value === '') return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function startOfDay(date) {
        const d = new Date(date.getTime());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function calendarDaysBetween(from, to) {
        return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
    }

    function plural(n, one, many) {
        return `${n} ${n === 1 ? one : many}`;
    }

    // Actividad reciente: "Hace 1 hora", "Hace 3 horas", "Ayer, 18:40", "Hace 2 días".
    function formatActivityTime(value, now) {
        const date = toDate(value);
        const ref = toDate(now) || new Date();
        if (!date) return '—';
        const minutes = Math.max(0, Math.floor((ref - date) / 60000));
        if (minutes < 1) return 'Ahora';
        const days = calendarDaysBetween(date, ref);
        if (days <= 0) {
            if (minutes < 60) return `Hace ${minutes} min`;
            return `Hace ${plural(Math.floor(minutes / 60), 'hora', 'horas')}`;
        }
        if (days === 1) {
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            return `Ayer, ${hh}:${mm}`;
        }
        return `Hace ${plural(days, 'día', 'días')}`;
    }

    // Tabla de visitantes: granularidad de días ("Hace 1 día"); el mismo día en horas.
    function formatVisitorTime(value, now) {
        const date = toDate(value);
        const ref = toDate(now) || new Date();
        if (!date) return '—';
        const minutes = Math.max(0, Math.floor((ref - date) / 60000));
        const days = calendarDaysBetween(date, ref);
        if (days <= 0) {
            if (minutes < 60) return minutes < 1 ? 'Ahora' : `Hace ${minutes} min`;
            return `Hace ${plural(Math.floor(minutes / 60), 'hora', 'horas')}`;
        }
        return `Hace ${plural(days, 'día', 'días')}`;
    }

    function visitOrdinal(n) {
        const value = Math.max(1, Math.floor(Number(n) || 1));
        return `${value}ª`;
    }

    // "12 de agosto" a partir de una fecha YYYY-MM-DD (sin corrimiento de zona).
    function formatDayMonth(value) {
        const raw = String(value || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
        const date = new Date(`${raw}T12:00:00`);
        if (Number.isNaN(date.getTime())) return '';
        return `${date.getDate()} de ${date.toLocaleDateString('es-AR', { month: 'long' })}`;
    }

    function initialsOf(name) {
        return String(name || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')
            .toUpperCase() || 'WO';
    }

    return {
        currencySymbol,
        formatKpiMoney,
        formatKpiMoneyCompact,
        funnelRate,
        formatActivityTime,
        formatVisitorTime,
        visitOrdinal,
        formatDayMonth,
        initialsOf
    };
});
