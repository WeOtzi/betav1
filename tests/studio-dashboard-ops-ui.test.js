'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('saving a sponsor while the spot editor is open keeps their controls and mutations separate', async () => {
    const nodes = new Map();
    const calls = [];
    function node(id, value = '') {
        const element = { id, value, checked: false, disabled: false, listeners: {}, dataset: {},
            addEventListener(event, listener) { (this.listeners[event] ||= []).push(listener); },
            closest: () => ({ dataset: { panel: 'sponsors' } }) };
        nodes.set(id, element);
        return element;
    }
    const spotSave = node('sp-save');
    const spotName = node('sp-title', 'Guest spot sin modificar');
    spotSave.addEventListener('click', () => calls.push(['spot-save']));
    const host = node('sponsor-editor');
    Object.defineProperty(host, 'innerHTML', {
        get() { return this.html || ''; },
        set(html) {
            this.html = html;
            for (const match of html.matchAll(/<(?:input|select|button|div)[^>]*\bid="([^"]+)"[^>]*>/g)) {
                const created = node(match[1], /\bvalue="([^"]*)"/.exec(match[0])?.[1] || '');
                created.checked = /\bchecked\b/.test(match[0]);
            }
        }
    });
    node('sponsors-status');
    node('sponsors-list').querySelectorAll = () => [];
    const selectedArtists = [{ value: 'artist-a' }];
    const document = {
        getElementById: id => nodes.get(id) || null,
        querySelectorAll(selector) {
            assert.equal(selector, 'input[name="sponsor-artist"]:checked');
            return selectedArtists;
        }
    };
    const data = {
        StudioMemberships: { listActiveArtists: async () => ({ data: [{ artist_user_id: 'artist-a', artists_db: { name: 'Artista de prueba' } }] }) },
        StudioOps: {
            createSponsor: async payload => { calls.push(['sponsor-save', payload]); return { data: { ...payload, id: 'sponsor-a' } }; },
            replaceSponsorArtists: async (id, artists) => { calls.push(['artists', id, artists]); return {}; },
            listSponsors: async () => ({ data: [] })
        }
    };
    const source = fs.readFileSync(path.join(__dirname, '../public/shared/js/studio-dashboard-ops.js'), 'utf8')
        .replace(/\}\)\(\);\s*$/, 'globalThis.openSponsorEditor = openSponsorEditor; })();');
    const context = { window: {}, document, WeotziData: data, setTimeout() {}, Date, Intl, URL, console };
    vm.runInNewContext(source, context);
    await context.openSponsorEditor({}, { id: 'studio-a' }, null);
    const sponsorSave = nodes.get('sponsor-save');
    assert.ok(sponsorSave, 'sponsor control is present beside the existing spot control');
    assert.equal(spotSave.listeners.click.length, 1, 'sponsor editor must not attach its save handler to a spot');
    assert.equal(sponsorSave.listeners.click.length, 1);
    nodes.get('sponsor-name').value = 'Sponsor de prueba';
    nodes.get('sponsor-tier').value = 'gold';
    await sponsorSave.listeners.click[0]({ currentTarget: sponsorSave });
    assert.equal(calls[0][0], 'sponsor-save');
    assert.equal(calls[0][1].studio_id, 'studio-a');
    assert.equal(calls[0][1].name, 'Sponsor de prueba');
    assert.equal(calls[0][1].tier, 'gold');
    assert.equal(calls[1][0], 'artists');
    assert.equal(calls[1][1], 'sponsor-a');
    assert.equal(Array.from(calls[1][2]).join(','), 'artist-a');
    assert.equal(spotName.value, 'Guest spot sin modificar');
    assert.equal(calls.some(call => call[0] === 'spot-save'), false);
    assert.equal(sponsorSave.disabled, false);
});
