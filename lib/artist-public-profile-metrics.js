'use strict';

const COMPLETED_STATUSES = new Set(['artist_completed', 'completed']);

function responseDurationMinutes(row) {
    if (!row?.sent_to_artist_at || !row?.artist_responded_at) return null;
    const sentAt = new Date(row.sent_to_artist_at).getTime();
    const respondedAt = new Date(row.artist_responded_at).getTime();
    if (!Number.isFinite(sentAt) || !Number.isFinite(respondedAt) || respondedAt <= sentAt) return null;
    return Math.round((respondedAt - sentAt) / 60000);
}

function responseTimeLabel(minutes) {
    if (!Number.isFinite(minutes)) return '—';
    if (minutes < 60) return 'Menos de 1 h';
    if (minutes < 24 * 60) return 'Menos de 24 h';
    const days = Math.max(1, Math.round(minutes / (24 * 60)));
    return `Aprox. ${days} ${days === 1 ? 'día' : 'días'}`;
}

function summarizeArtistPublicProfileMetrics(rows) {
    const sentRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.sent_to_artist_at);
    if (!sentRows.length) {
        return {
            tattooCount: null,
            tattooCountLabel: '—',
            responseRate: null,
            responseRateLabel: '—',
            avgResponseMinutes: null,
            responseTimeLabel: '—'
        };
    }

    const responseMinutes = sentRows
        .map(responseDurationMinutes)
        .filter(Number.isFinite);
    const tattooCount = sentRows.filter((row) => COMPLETED_STATUSES.has(row?.quote_status)).length;
    const responseRate = Math.round((responseMinutes.length / sentRows.length) * 100);
    const avgResponseMinutes = responseMinutes.length
        ? Math.round(responseMinutes.reduce((sum, minutes) => sum + minutes, 0) / responseMinutes.length)
        : null;

    return {
        tattooCount,
        tattooCountLabel: `${tattooCount}+`,
        responseRate,
        responseRateLabel: `${responseRate}%`,
        avgResponseMinutes,
        responseTimeLabel: responseTimeLabel(avgResponseMinutes)
    };
}

module.exports = {
    summarizeArtistPublicProfileMetrics
};
