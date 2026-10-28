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
