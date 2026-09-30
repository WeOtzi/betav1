const test = require('node:test');
const assert = require('node:assert/strict');

const {
    summarizeArtistPublicProfileMetrics
} = require('../lib/artist-public-profile-metrics');

test('public profile metrics expose no invented values when the artist has no sent quotations', () => {
    assert.deepEqual(summarizeArtistPublicProfileMetrics([
        {
            quote_status: 'in_progress',
            sent_to_artist_at: null,
            artist_responded_at: null
        }
    ]), {
        tattooCount: null,
        tattooCountLabel: '—',
        responseRate: null,
        responseRateLabel: '—',
        avgResponseMinutes: null,
        responseTimeLabel: '—'
    });
});

test('public profile metrics aggregate only sent work and never expose quotation rows', () => {
    const metrics = summarizeArtistPublicProfileMetrics([
        {
            quote_status: 'in_progress',
            sent_to_artist_at: null,
            artist_responded_at: null
        },
        {
            quote_status: 'pending',
            sent_to_artist_at: '2026-08-01T10:00:00.000Z',
            artist_responded_at: null
        },
        {
            quote_status: 'responded',
            sent_to_artist_at: '2026-08-02T10:00:00.000Z',
            artist_responded_at: '2026-08-02T12:00:00.000Z'
        },
        {
            quote_status: 'completed',
            sent_to_artist_at: '2026-08-03T10:00:00.000Z',
            artist_responded_at: '2026-08-03T14:00:00.000Z'
        },
        {
            quote_status: 'artist_completed',
            sent_to_artist_at: '2026-08-04T10:00:00.000Z',
            artist_responded_at: '2026-08-04T11:00:00.000Z'
        },
        {
            quote_status: 'cancelled',
            sent_to_artist_at: '2026-08-05T10:00:00.000Z',
            artist_responded_at: null
        },
        {
            quote_status: 'responded',
            sent_to_artist_at: '2026-08-06T12:00:00.000Z',
            artist_responded_at: '2026-08-06T11:00:00.000Z'
        }
    ]);

    assert.deepEqual(metrics, {
        tattooCount: 2,
        tattooCountLabel: '2+',
        responseRate: 50,
        responseRateLabel: '50%',
        avgResponseMinutes: 140,
        responseTimeLabel: 'Menos de 24 h'
    });
    assert.deepEqual(Object.keys(metrics).sort(), [
        'avgResponseMinutes',
        'responseRate',
        'responseRateLabel',
        'responseTimeLabel',
        'tattooCount',
        'tattooCountLabel'
    ]);
});

test('public profile response time uses honest hour and day buckets', () => {
    const oneHour = summarizeArtistPublicProfileMetrics([{
        quote_status: 'responded',
        sent_to_artist_at: '2026-08-01T10:00:00.000Z',
        artist_responded_at: '2026-08-01T10:35:00.000Z'
    }]);
    const twoDays = summarizeArtistPublicProfileMetrics([{
        quote_status: 'responded',
        sent_to_artist_at: '2026-08-01T10:00:00.000Z',
        artist_responded_at: '2026-08-03T16:00:00.000Z'
    }]);

    assert.equal(oneHour.responseTimeLabel, 'Menos de 1 h');
    assert.equal(twoDays.responseTimeLabel, 'Aprox. 2 días');
});
