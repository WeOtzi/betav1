#!/usr/bin/env node
'use strict';

require('dotenv').config();

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR = process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-profile-scraper';
const RESULTS_LIMIT = Number(process.env.APIFY_RESULTS_LIMIT || 12);

const DEFAULT_HANDLES = [
    'nationalgeographic',
    'natgeo',
    'instagram'
];

const args = process.argv.slice(2);
const handles = args.length ? args : DEFAULT_HANDLES;

if (!APIFY_TOKEN) {
    console.error('ERROR: APIFY_TOKEN not set in environment.');
    console.error('  Add APIFY_TOKEN=<your token> to .env, then re-run.');
    console.error('  Get a free token at https://console.apify.com/settings/integrations');
    process.exit(1);
}

const actorPath = ACTOR.replace('/', '~');
const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;

const LOCATION_REGEX = /[\u{1F4CD}\u{1F30E}\u{1F30D}\u{1F5FA}\u{FE0F}]\s*([^|\n,]+)/u;

function describeBio(bio) {
    if (!bio) return '(empty)';
    const oneLine = bio.replace(/\s+/g, ' ').trim();
    return oneLine.length > 120 ? oneLine.slice(0, 117) + '...' : oneLine;
}

function guessLocationFromBio(bio) {
    if (!bio) return null;
    const m = bio.match(LOCATION_REGEX);
    return m ? m[1].trim() : null;
}

function mostFrequentGeotag(posts) {
    const tally = new Map();
    for (const p of posts || []) {
        const loc = p && p.locationName;
        if (!loc) continue;
        tally.set(loc, (tally.get(loc) || 0) + 1);
    }
    if (!tally.size) return null;
    const [name, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    return { name, count };
}

function classifyMedia(post) {
    const type = String(post.type || '').toLowerCase();
    const productType = String(post.productType || '').toLowerCase();
    if (productType.includes('reel') || type === 'video') return 'reel';
    return 'image';
}

async function fetchProfile(username) {
    const t0 = Date.now();
    const body = {
        usernames: [username],
        resultsLimit: RESULTS_LIMIT
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const elapsedMs = Date.now() - t0;

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Apify ${res.status} ${res.statusText} :: ${text.slice(0, 300)}`);
    }

    const items = await res.json();
    return { items, elapsedMs };
}

function summarize(username, items) {
    const profile = Array.isArray(items) && items.length ? items[0] : null;
    if (!profile) {
        return { username, ok: false, reason: 'empty_dataset' };
    }

    if (profile.error || profile.errorDescription) {
        return { username, ok: false, reason: profile.error || profile.errorDescription };
    }

    if (profile.private === true || profile.isPrivate === true) {
        return { username, ok: false, reason: 'private', profile };
    }

    const posts = profile.latestPosts || profile.posts || [];
    const photos = [];
    const reels = [];
    for (const p of posts) {
        if (classifyMedia(p) === 'reel') reels.push(p);
        else photos.push(p);
    }

    const bio = profile.biography || profile.bio || '';
    const externalUrl = profile.externalUrl || profile.website || profile.bioLink || null;
    const profilePic = profile.profilePicUrl || profile.profilePicture || null;
    const fullName = profile.fullName || profile.name || null;

    return {
        username,
        ok: true,
        fields: {
            username: profile.username || username,
            fullName,
            bio: describeBio(bio),
            biographyRaw: bio,
            externalUrl,
            profilePic: profilePic ? profilePic.slice(0, 80) + '...' : null,
            followersCount: profile.followersCount || profile.followers || null,
            postsCount: profile.postsCount || profile.posts_count || null
        },
        media: {
            totalReturned: posts.length,
            photos: photos.length,
            reels: reels.length,
            firstCaption: posts.length ? describeBio(posts[0].caption || '') : null,
            firstPermalink: posts.length ? posts[0].url || posts[0].permalink || null : null,
            firstDimensions: posts.length ? {
                w: posts[0].dimensionsWidth || posts[0].width || null,
                h: posts[0].dimensionsHeight || posts[0].height || null
            } : null
        },
        location: {
            fromBio: guessLocationFromBio(bio),
            mostFrequentGeotag: mostFrequentGeotag(posts)
        }
    };
}

function divider(title) {
    console.log('\n' + '='.repeat(70));
    console.log(' ' + title);
    console.log('='.repeat(70));
}

(async function main() {
    console.log(`\nInstagram Import Spike — Phase A`);
    console.log(`Actor:   ${ACTOR}`);
    console.log(`Limit:   ${RESULTS_LIMIT} media per profile`);
    console.log(`Handles: ${handles.join(', ')}\n`);

    const results = [];

    for (const handle of handles) {
        divider(`@${handle}`);
        try {
            const { items, elapsedMs } = await fetchProfile(handle);
            const summary = summarize(handle, items);
            summary.elapsedMs = elapsedMs;

            if (!summary.ok) {
                console.log(`STATUS: NOT OK (${summary.reason})`);
                console.log(`Latency: ${elapsedMs} ms`);
                if (summary.profile) {
                    console.log(`Raw flags: private=${summary.profile.private}, isPrivate=${summary.profile.isPrivate}`);
                }
            } else {
                console.log(`STATUS:  OK`);
                console.log(`Latency: ${elapsedMs} ms (target: <15000)`);
                console.log(`\nProfile fields:`);
                console.log(`  username:      ${summary.fields.username}`);
                console.log(`  fullName:      ${summary.fields.fullName}`);
                console.log(`  bio:           ${summary.fields.bio}`);
                console.log(`  externalUrl:   ${summary.fields.externalUrl}`);
                console.log(`  profilePic:    ${summary.fields.profilePic}`);
                console.log(`  followers:     ${summary.fields.followersCount}`);
                console.log(`  posts (total): ${summary.fields.postsCount}`);

                console.log(`\nMedia returned (limit=${RESULTS_LIMIT}):`);
                console.log(`  total:         ${summary.media.totalReturned}`);
                console.log(`  photos:        ${summary.media.photos}`);
                console.log(`  reels:         ${summary.media.reels}`);
                console.log(`  firstCaption:  ${summary.media.firstCaption}`);
                console.log(`  firstPermalink:${summary.media.firstPermalink}`);
                console.log(`  firstDims:     ${JSON.stringify(summary.media.firstDimensions)}`);

                console.log(`\nLocation guesses:`);
                console.log(`  fromBio:       ${summary.location.fromBio || '(none)'}`);
                console.log(`  topGeotag:     ${summary.location.mostFrequentGeotag ? `${summary.location.mostFrequentGeotag.name} (x${summary.location.mostFrequentGeotag.count})` : '(none)'}`);
            }
            results.push(summary);
        } catch (err) {
            console.log(`STATUS:  ERROR`);
            console.log(`Reason:  ${err.message}`);
            results.push({ username: handle, ok: false, reason: 'exception', error: err.message });
        }
    }

    divider('Verdict');
    const ok = results.filter(r => r.ok).length;
    const slow = results.filter(r => r.ok && r.elapsedMs > 15000).length;
    const missingBio = results.filter(r => r.ok && !r.fields.biographyRaw).length;
    const missingLink = results.filter(r => r.ok && !r.fields.externalUrl).length;
    const missingMedia = results.filter(r => r.ok && r.media.totalReturned === 0).length;

    console.log(`Profiles OK:               ${ok}/${results.length}`);
    console.log(`Profiles slow (>15s):      ${slow}`);
    console.log(`Profiles missing bio:      ${missingBio}`);
    console.log(`Profiles missing link:     ${missingLink}`);
    console.log(`Profiles missing media:    ${missingMedia}`);

    const passed = ok > 0 && slow === 0 && missingMedia === 0;
    console.log(`\nResult: ${passed ? 'PASS — proceed to Phase B' : 'INVESTIGATE — adjust transform or change Actor before Phase B'}`);
    process.exit(passed ? 0 : 1);
})();
