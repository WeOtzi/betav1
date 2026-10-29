const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page() {
    const nodes = new Map();
    function element() {
        const classes = new Set();
        const attrs = new Map();
        const handlers = new Map();
        return {
            innerHTML: '', textContent: '', hidden: false,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
                contains: name => classes.has(name)
            },
            setAttribute: (name, value) => attrs.set(name, value),
            getAttribute: name => attrs.get(name),
            addEventListener: (name, handler) => handlers.set(name, handler),
            dispatch: (name, event) => handlers.get(name)?.(event),
            contains() { return false; }, focus() {},
            querySelector() { return null; },
            appendChild(child) {
                if (child.textNode != null) {
                    this.innerHTML += String(child.textNode).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return;
                }
                this.innerHTML += child.innerHTML;
                for (const match of child.innerHTML.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], element());
            }
        };
    }
    for (const id of ['jbrq-view', 'jbrq-stepper', 'jbrq-back', 'jbrq-gallery', 'jbrq-client-nav', 'jbrq-inspiration-nav']) nodes.set(id, element());
    const document = {
        body: element(), getElementById: id => nodes.get(id) || null,
        createElement: element, createTextNode: textNode => ({ textNode }),
        addEventListener() {}, querySelector() { return null; }
    };
    const events = new Map();
    document.addEventListener = (name, handler) => events.set(name, handler);
    document.dispatch = (name, event) => events.get(name)?.(event);
    const context = vm.createContext({ document, window: { scrollTo() {} }, console, setTimeout, URL, localStorage: { setItem() {}, getItem() { return null; } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shared/js/job-board-request.js'), 'utf8'), context);
    return { nodes, document, context, run: source => vm.runInContext(source, context) };
}

test('inspiration mounts its filter buttons and gallery after attaching the view', () => {
    const p = page();
    p.run('galleryLoaded = true; renderView();');
    const chips = p.nodes.get('jbrq-gallery-chips').innerHTML;
    assert.equal((chips.match(/data-style=/g) || []).length, 10);
    assert.match(chips, /aria-pressed="true"[^>]*>Todos/);
    assert.match(p.nodes.get('jbrq-gallery').innerHTML, /Tatuaje blackwork/);
    assert.equal(p.document.body.classList.contains('jbrq-is-inspiration'), true);
});

test('the isolated mobile navigation opens on click and closes with Escape', () => {
    const p = page();
    const toggle = p.document.createElement('button');
    const menu = p.document.createElement('nav');
    menu.hidden = true;
    p.nodes.set('jbrq-inspiration-menu-toggle', toggle);
    p.nodes.set('jbrq-inspiration-menu', menu);
    p.run('setupInspirationMenu();');
    toggle.dispatch('click', { stopPropagation() {} });
    assert.equal(menu.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    p.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('an empty source shows the 15 Figma upload slots, which filter and search without creating fake URLs', () => {
    const p = page();
    p.run('galleryLoaded = true; galleryItems = []; renderGallery();');
    let html = p.nodes.get('jbrq-gallery').innerHTML;
    assert.equal((html.match(/class="jbrq-upload-slot/g) || []).length, 15);
    assert.match(html, /browse files/);
    assert.doesNotMatch(html, /data-url=/);
    p.run("galleryFilter = 'Blackwork'; renderGallery();");
    html = p.nodes.get('jbrq-gallery').innerHTML;
    assert.equal((html.match(/class="jbrq-upload-slot/g) || []).length, 5);
    assert.doesNotMatch(html, /Tatuaje japonés/);
    p.run("gallerySearch = 'sin coincidencias'; renderGallery();");
    assert.match(p.nodes.get('jbrq-gallery').innerHTML, /Sin referencias para mostrar/);
});

test('real gallery entries remain selectable and are never replaced with placeholder content', () => {
    const p = page();
    p.run("galleryLoaded = true; galleryItems = [{url:'https://example.invalid/tattoo.webp', style:'Fine line', styles:['Fine line'], artist:'Artista de prueba'}]; renderGallery();");
    const html = p.nodes.get('jbrq-gallery').innerHTML;
    assert.match(html, /src="https:\/\/example.invalid\/tattoo.webp"/);
    assert.match(html, /toggleGalleryRef/);
    assert.doesNotMatch(html, /browse files/);
});

test('leaving inspiration restores the original client navigation and removes the isolated visual scope', () => {
    const p = page();
    p.run('galleryLoaded = true; renderView();');
    assert.equal(p.nodes.get('jbrq-client-nav').hidden, true);
    assert.equal(p.nodes.get('jbrq-inspiration-nav').hidden, false);
    p.run("view = 'unknown'; renderView();");
    assert.equal(p.document.body.classList.contains('jbrq-is-inspiration'), false);
    assert.equal(p.nodes.get('jbrq-client-nav').hidden, false);
    assert.equal(p.nodes.get('jbrq-inspiration-nav').hidden, true);
});
