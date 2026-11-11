const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadPageActions() {
    const elements = {
        'social-access-notice': { hidden: true },
        'social-access-message': { textContent: '' },
        'login-email': { focus() { this.focused = true; } }
    };
    const context = vm.createContext({ document: { getElementById: id => elements[id] } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/client-login.js'), 'utf8'), context);
    return { context, elements };
}

for (const provider of ['Instagram', 'Facebook']) {
    test(`${provider} shows an honest unavailable notice without authenticating`, () => {
        const { context, elements } = loadPageActions();
        context.handleClientSocialUnavailable(provider);
        assert.equal(elements['social-access-notice'].hidden, false);
        assert.match(elements['social-access-message'].textContent, new RegExp(provider));
        assert.match(elements['social-access-message'].textContent, /todavía no está disponible/);
    });
}

test('Email closes the social notice and focuses the existing login field', () => {
    const { context, elements } = loadPageActions();
    context.handleClientSocialUnavailable('Instagram');
    context.focusClientEmailLogin();
    assert.equal(elements['social-access-notice'].hidden, true);
    assert.equal(elements['login-email'].focused, true);
});
