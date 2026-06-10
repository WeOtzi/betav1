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
