'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function target() {
    const listeners = new Map();
    const attributes = new Map();
    return {
        listeners, hidden: true, focusCount: 0,
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        getAttribute(name) { return attributes.get(name) || null; },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        hasAttribute(name) { return attributes.has(name); },
        focus() { this.focusCount++; },
        dispatch(type, properties = {}) {
            const event = { target: this, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...properties };
            for (const fn of listeners.get(type) || []) fn(event);
            return event;
        }
    };
}
function load() {
    const registry = new Map();
    const document = target();
    class HTMLElement {
        constructor() { Object.assign(this, target()); }
    }
    const window = { customElements: { get: name => registry.get(name), define: (name, ctor) => registry.set(name, ctor) } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/ds/organisms.js'), 'utf8'), { window, document, HTMLElement });
    return { registry, document };
}

test('studio product navigation exposes only real studio tabs on desktop and all twelve on mobile', () => {
    const { registry } = load();
    const nav = new (registry.get('weotzi-product-nav'))();
    nav.setAttribute('context', 'studio');
    const html = nav.template();
    const desktop = /<div class="wo-org-product-nav__links">([\s\S]*?)<\/div>/.exec(html)[1];
    const mobile = /<nav id="studio-mobile-menu"[\s\S]*?<\/nav>/.exec(html)[0];
    const destinations = fragment => Array.from(fragment.matchAll(/data-tab="([^"]+)"/g), match => match[1]);
    assert.deepEqual(destinations(desktop), ['resumen', 'spots', 'ops', 'inventory', 'analytics']);
    assert.deepEqual(destinations(mobile), ['resumen', 'perfil', 'sedes', 'roster', 'spots', 'travel', 'ops', 'inventory', 'suppliers', 'sponsors', 'analytics', 'cuenta']);
    assert.match(html, /id="logout-btn"/);
    assert.match(html, /href="#cuenta" data-tab="cuenta"/);
    assert.match(desktop, /data-tab="resumen" aria-current="page"/);
    assert.match(mobile, />EQUIPO<\/a>/);
    assert.match(mobile, />VISITAS<\/a>/);
    assert.doesNotMatch(html, /\/artist\/|INBOX|FINAN/);
    nav.setAttribute('active', 'cuenta');
    assert.match(nav.template(), /href="#cuenta" data-tab="cuenta" aria-label="Centro de la cuenta del estudio" aria-current="page"/);
});

test('studio menu supports toggle, ArrowDown, Escape, outside click and anchor navigation without rerendering', () => {
    const { registry, document } = load();
    const nav = new (registry.get('weotzi-product-nav'))();
    nav.setAttribute('context', 'studio');
    const toggle = target(), menu = target(), anchor = target();
    toggle.setAttribute('aria-expanded', 'false');
    menu.querySelector = () => anchor;
    nav.querySelector = selector => selector === '.wo-org-product-nav__menu' ? toggle : menu;
    nav.contains = candidate => [nav, toggle, menu, anchor].includes(candidate);
    nav.bind();
    nav.bind();
    assert.equal(document.listeners.get('keydown').size, 1, 'rebinding cleans up the earlier menu listeners');
    assert.equal(document.listeners.get('click').size, 1);
    assert.equal(toggle.dispatch('click').stopped, true);
    assert.equal(menu.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.dispatch('keydown', { key: 'ArrowDown' }).prevented, true);
    assert.equal(anchor.focusCount, 1);
    assert.equal(document.dispatch('keydown', { key: 'Escape' }).prevented, true);
    assert.equal(menu.hidden, true);
    assert.equal(toggle.focusCount, 1);
    toggle.dispatch('click');
    document.dispatch('click', { target: {} });
    assert.equal(menu.hidden, true);
    toggle.dispatch('click');
    const event = menu.dispatch('click', { target: { closest: () => anchor } });
    assert.equal(menu.hidden, true);
    assert.equal(event.prevented, false, 'studio dashboard delegated navigation still receives the anchor action');
    nav.disconnectedCallback();
    assert.equal(document.listeners.get('keydown').size, 0);
    assert.equal(document.listeners.get('click').size, 0);
});

test('studio footer uses public help destinations and states that unavailable legal documents are unavailable', () => {
    const { registry } = load();
    const footer = new (registry.get('weotzi-product-footer'))();
    footer.setAttribute('context', 'studio');
    const html = footer.template();
    assert.match(html, /href="https:\/\/weotzi\.com\/faqs\/"/);
    assert.match(html, /data-studio-document="Privacidad"/);
    assert.match(html, /Este documento todavía no está disponible/);
    assert.doesNotMatch(html, /mailto:|href="\/(?:faqs|terminos|privacidad)"/);
});
