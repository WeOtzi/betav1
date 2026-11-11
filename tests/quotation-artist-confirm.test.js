const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runtime() {
    const classes = new Set();
    const footer = { dataset: {} };
    const copyright = { textContent: '© 2025 We Ötzi. Todos los derechos reservados.' };
    footer.querySelector = () => copyright;
    footer.querySelectorAll = () => [];
    const context = vm.createContext({
        window: { addEventListener() {} },
        document: {
            addEventListener() {},
            body: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } },
            querySelector: () => footer
        },
        console, URLSearchParams, setTimeout, clearTimeout
    });
    vm.runInContext(fs.readFileSync('public/shared/js/script.js', 'utf8'), context);
    return { context, classes, copyright };
}

test('el chrome de confirmación se retira al pasar a otra pantalla del cotizador', () => {
    const { context, classes, copyright } = runtime();
    vm.runInContext("syncArtistConfirmationChrome({ id: 'artist' })", context);
    assert.equal(classes.has('q-artist-confirm-page'), true);
    assert.equal(copyright.textContent, '© 2026 We Ötzi. Todos los derechos reservados.');
    vm.runInContext("syncArtistConfirmationChrome({ id: 'idea' })", context);
    assert.equal(classes.has('q-artist-confirm-page'), false);
    assert.equal(copyright.textContent, '© 2025 We Ötzi. Todos los derechos reservados.');
});

test('confirmar conserva el artista y seguir sin artista lo desvincula', () => {
    const { context } = runtime();
    vm.runInContext(`
        formData = { artist_id: 'qa-artist', artist_name: 'QA', artist_data: { name: 'QA' }, quote_id: 'QA-14' };
        nextStep = () => { window.nextReached = true; };
        goToScreenById = id => { window.destination = id; };
        confirmArtist();
    `, context);
    assert.equal(vm.runInContext('window.nextReached', context), true);
    assert.equal(vm.runInContext('formData.artist_id', context), 'qa-artist');
    vm.runInContext('continueWithoutArtist()', context);
    assert.equal(vm.runInContext('formData.artist_id', context), null);
    assert.equal(vm.runInContext('formData.no_artist', context), true);
    assert.equal(vm.runInContext('window.destination', context), 'idea');
});
