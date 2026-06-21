const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('public reviews render latest 10 with rating filters and pagination', () => {
    const reviewsJs = read('public', 'shared', 'js', 'reviews.js');

    assert.match(reviewsJs, /const REVIEW_PAGE_SIZE = 10/);
    assert.match(reviewsJs, /data-review-rating/);
    assert.match(reviewsJs, /data-review-page/);
    assert.match(reviewsJs, /\.order\('created_at', \{ ascending: false \}\)/);
    assert.match(reviewsJs, /\.range\(from, to\)/);
    assert.match(reviewsJs, /public_review_tag_counts/);
    assert.match(reviewsJs, /openReviewResponseModal/);
    assert.match(reviewsJs, /data-review-response/);
});

test('artist, studio, and client public profiles mount approved reviews', () => {
    const artistHtml = read('public', 'artist', 'profile', 'index.html');
    const studioHtml = read('public', 'studio', 'profile', 'index.html');
    const clientHtml = read('public', 'client', 'profile', 'index.html');
    const artistJs = read('public', 'shared', 'js', 'artist-profile.js');
    const studioJs = read('public', 'shared', 'js', 'studio-profile.js');
    const clientJs = read('public', 'shared', 'js', 'client-profile.js');

    assert.match(artistHtml, /shared\/js\/reviews\.js/);
    assert.match(artistHtml, /id="artist-reviews"/);
    assert.match(artistJs, /revieweeType: 'artist'/);

    assert.match(studioHtml, /shared\/js\/reviews\.js/);
    assert.match(studioHtml, /id="studio-reviews"/);
    assert.match(studioJs, /revieweeType: 'studio'/);

    assert.match(clientHtml, /shared\/js\/reviews\.js/);
    assert.match(clientHtml, /id="client-reviews"/);
    assert.match(clientJs, /revieweeType: 'client'/);
});

test('client dashboard completes artist_completed quotation before review', () => {
    const dashboardJs = read('public', 'shared', 'js', 'client-dashboard.js');
    const serverJs = read('server.js');

    assert.match(dashboardJs, /quote_status === 'artist_completed'/);
    // El POST a /complete vive ahora en la capa PostgREST unificada
    // (WeotziData.Api.confirmCompletionByClient); el dashboard la invoca.
    assert.match(dashboardJs, /Api\.confirmCompletionByClient/);
    const quotationsRepoFront = read('public', 'shared', 'js', 'data', 'quotations-repo.js');
    assert.match(quotationsRepoFront, /\/api\/client\/quotations\/\$\{encodeURIComponent\(quoteId\)\}\/complete/);
    assert.match(dashboardJs, /openQuotationArtistReview/);
    assert.match(dashboardJs, /contextType: 'quotation'/);

    assert.match(serverJs, /POST \/api\/client\/quotations\/:quoteId\/complete/);
    assert.match(serverJs, /quotation\.quote_status !== 'artist_completed'/);
    // El seteo de estado vive ahora en la capa PostgREST unificada
    // (QuotationsRepo.markCompletedByClient), no inline en server.js.
    assert.match(serverJs, /QuotationsRepo\.markCompletedByClient/);
    const quotationsRepo = read('lib', 'repos', 'quotations.js');
    assert.match(quotationsRepo, /quote_status: 'completed'/);
});

test('support dashboard exposes review moderation queue', () => {
    const supportHtml = read('public', 'support', 'dashboard', 'index.html');
    const supportJs = read('public', 'shared', 'js', 'support-dashboard.js');

    assert.match(supportHtml, /data-tab="reviews"/);
    assert.match(supportJs, /verified_reviews/);
    assert.match(supportJs, /renderReviewRow/);
    assert.match(supportJs, /updateReviewModeration/);
    assert.match(supportJs, /moderation_status/);
});
