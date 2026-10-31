const test = require('node:test');
const assert = require('node:assert/strict');

const igImport = require('../lib/instagram-import');

test('instagram transform reads media from alternate Apify reel/post arrays', () => {
    const payload = igImport._internal.transformProfile([
        {
            username: 'ink_test',
            fullName: 'Ink Test',
            biography: 'Bio ok',
            latestPosts: [
                {
                    id: 'photo-1',
                    type: 'Image',
                    displayUrl: 'https://cdn.example.com/photo.jpg',
                    url: 'https://instagram.com/p/photo-1/'
                }
            ],
            latestReels: [
                {
                    id: 'reel-1',
                    productType: 'clips',
                    type: 'Video',
                    videoUrl: 'https://cdn.example.com/reel.mp4',
                    displayUrl: 'https://cdn.example.com/reel-thumb.jpg',
                    url: 'https://instagram.com/reel/reel-1/'
                }
            ]
        }
    ], 'ink_test');

    assert.equal(payload.photos.length, 1);
    assert.equal(payload.reels.length, 1);
    assert.equal(payload.reels[0].cdn_url, 'https://cdn.example.com/reel.mp4');
    assert.equal(payload.reels[0].thumbnail_url, 'https://cdn.example.com/reel-thumb.jpg');
});

test('instagram transform falls back to dataset media rows when profile arrays are empty', () => {
    const payload = igImport._internal.transformProfile([
        {
            username: 'ink_test',
            biography: 'Bio ok',
            latestPosts: []
        },
        {
            id: 'photo-2',
            type: 'Image',
            imageUrl: 'https://cdn.example.com/photo-2.jpg',
            permalink: 'https://instagram.com/p/photo-2/'
        }
    ], 'ink_test');

    assert.equal(payload.photos.length, 1);
    assert.equal(payload.photos[0].cdn_url, 'https://cdn.example.com/photo-2.jpg');
});

test('instagram preview summary lists each post so the dialog can pick them one by one', () => {
    const payload = igImport._internal.transformProfile([
        {
            username: 'ink_test',
            latestPosts: [
                { id: 'p1', type: 'Image', displayUrl: 'https://cdn.example.com/p1.jpg', url: 'https://instagram.com/p/p1/' },
                { id: 'r1', productType: 'clips', type: 'Video', videoUrl: 'https://cdn.example.com/r1.mp4', displayUrl: 'https://cdn.example.com/r1.jpg', videoDuration: 14.6, url: 'https://instagram.com/reel/r1/' }
            ]
        }
    ], 'ink_test');
    const summary = igImport._internal.summarizePayload(payload);
    assert.equal(summary.media.length, 2);
    assert.deepEqual(summary.media.map(m => m.permalink), ['https://instagram.com/p/p1/', 'https://instagram.com/reel/r1/']);
    assert.equal(summary.media[1].kind, 'reel');
    assert.equal(summary.media[1].video_duration, 15);
    // El resumen no expone las URLs de descarga del CDN, solo metadatos para elegir.
    assert.ok(summary.media.every(m => !('cdn_url' in m)));
});

test('imported feed items record the Instagram source, handle and import time', () => {
    const { buildFeedItem } = igImport._internal;
    const importedAt = '2026-10-30T12:00:00.000Z';
    const photo = buildFeedItem(
        { category: 'instagram', kind: 'image', timestamp: '2026-01-01T10:00:00.000Z', caption: 'Hola', permalink: 'https://instagram.com/p/p1/' },
        'https://x.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/u1/abc.jpg',
        { igHandle: '@Ink_Test', importedAt }
    );
    assert.deepEqual(photo, {
        url: 'https://x.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/u1/abc.jpg',
        category: 'instagram',
        kind: 'image',
        created_at: '2026-01-01T10:00:00.000Z',
        caption: 'Hola',
        permalink: 'https://instagram.com/p/p1/',
        source: 'instagram',
        ig_handle: 'ink_test',
        imported_at: importedAt
    });

    const reel = buildFeedItem({ category: 'instagram-reel', kind: 'reel', cdn_url: 'https://cdn.example.com/r1.mp4' }, 'https://cdn.test/r1.mp4', { igHandle: 'ink_test', importedAt });
    assert.equal(reel.kind, 'video');
    assert.equal(reel.created_at, importedAt, 'without a timestamp the item uses the import time');
    assert.equal(reel.caption, null);
    assert.equal(reel.permalink, null);
    assert.equal(reel.source, 'instagram');

    assert.equal(buildFeedItem({ category: 'instagram', kind: 'image' }, 'u', {}).ig_handle, null);
    assert.match(buildFeedItem({ category: 'instagram', kind: 'image' }, 'u').imported_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('imported items follow the gallery visibility rule of the validated account', () => {
    const visibility = require('../public/shared/js/gallery-visibility.js');
    const item = igImport._internal.buildFeedItem({ category: 'instagram', kind: 'image' }, 'https://cdn.test/instagram-import/u/a.jpg', { igHandle: 'ink_test' });
    assert.equal(visibility.isInstagramItem(item), true);
    assert.equal(visibility.isPubliclyVisible(item, { enforced: true, verified: false, handle: null }), false);
    assert.equal(visibility.isPubliclyVisible(item, { enforced: true, verified: true, handle: 'ink_test' }), true);
    assert.equal(visibility.isPubliclyVisible(item, { enforced: true, verified: true, handle: 'otra.cuenta' }), false);
    assert.equal(visibility.isPubliclyVisible(item, { enforced: false, verified: false, handle: null }), true);
});

test('commit builds every new feed item with the imported profile username', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'instagram-import.js'), 'utf8');
    assert.match(source, /newItems\.push\(buildFeedItem\(media, uploaded\.public_url, \{ igHandle: payload\.username, importedAt \}\)\);/);
    assert.match(source, /const importedAt = new Date\(\)\.toISOString\(\);/);
});
