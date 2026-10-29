const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// DOM boundary double: IDs become discoverable only after the pane is mounted.
function formPage() {
    const nodes = new Map();
    const storage = new Map();
    function element() {
        const classes = new Set();
        const handlers = new Map();
        return {
            innerHTML: '', textContent: '', value: '', hidden: false,
            classList: {
                add: name => classes.add(name), remove: name => classes.delete(name),
                contains: name => classes.has(name),
                toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
            },
            setAttribute() {}, querySelector() { return null; },
            addEventListener: (name, handler) => handlers.set(name, handler),
            dispatch: (name, event) => handlers.get(name)?.(event), focus() {}, scrollIntoView() {},
            appendChild(child) {
                if (child.textNode != null) {
                    this.innerHTML += String(child.textNode).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return;
                }
                this.innerHTML = child.innerHTML;
                for (const match of child.innerHTML.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], element());
            }
        };
    }
    for (const id of ['jbrq-view', 'jbrq-stepper', 'jbrq-back', 'jbrq-client-nav', 'jbrq-inspiration-nav']) nodes.set(id, element());
    const document = {
        body: element(), getElementById: id => nodes.get(id) || null,
        createElement: element, createTextNode: textNode => ({ textNode }),
        addEventListener() {}, querySelectorAll() { return []; }
    };
    const context = vm.createContext({
        document, window: { scrollTo() {} }, console, setTimeout, URL,
        localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) || null }
    });
    vm.runInContext(fs.readFileSync('public/shared/js/job-board-request.js', 'utf8'), context);
    const run = source => vm.runInContext(source, context);
    return { nodes, document, run, storage };
}

test('entering the form mounts the calendar and three upload slots on the first render', () => {
    const p = formPage();
    p.run("view = 'form'; renderView();");
    assert.equal((p.nodes.get('jbrq-calendar').innerHTML.match(/data-date=/g) || []).length, 42);
    assert.equal((p.nodes.get('jbrq-refs').innerHTML.match(/class="(?:wo-dropzone )?jbrq-refslot/g) || []).length, 3);
    assert.equal(p.document.body.classList.contains('jbrq-is-form'), true);
    assert.equal(p.nodes.get('jbrq-inspiration-nav').hidden, false);
});

test('form fields bind after mounting and preserve currency, flags and size in the draft', () => {
    const p = formPage();
    p.run("view = 'form'; renderView();");
    const size = p.nodes.get('jbrq-size');
    size.value = 'mediano';
    size.dispatch('change');
    const currency = p.nodes.get('jbrq-currency');
    currency.value = 'EUR';
    currency.dispatch('change');
    const first = p.nodes.get('jbrq-first-tattoo');
    first.checked = true;
    first.dispatch('change');
    assert.equal(p.run('formData.tattoo_size'), 'mediano');
    const draft = JSON.parse(p.storage.get('weotzi_job_board_draft'));
    assert.equal(draft.formData.budget_currency, 'EUR');
    assert.equal(draft.formData.is_first_tattoo, true);
});

test('leaving the form removes its isolated visual scope and restores the review navigation', () => {
    const p = formPage();
    p.run("view = 'form'; renderView();");
    assert.equal(p.document.body.classList.contains('jbrq-is-form'), true);
    p.run("view = 'unknown'; renderView();");
    assert.equal(p.document.body.classList.contains('jbrq-is-form'), false);
    assert.equal(p.nodes.get('jbrq-client-nav').hidden, false);
    assert.equal(p.nodes.get('jbrq-inspiration-nav').hidden, true);
});

test('the compact style selector reflects multiple choices without losing existing selections', () => {
    const p = formPage();
    p.run("view = 'form'; formData.tattoo_style = ['Blackwork']; renderView();");
    const summary = p.document.createElement('span');
    p.nodes.set('jbrq-style-value', summary);
    p.run(`window.toggleStyle({
        dataset: { style: 'Realismo' },
        classList: { toggle() {}, contains() { return true; } },
        setAttribute() {}
    });`);
    assert.equal(summary.textContent, 'Blackwork, Realismo');
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(formData.tattoo_style)')), ['Blackwork', 'Realismo']);
});

test('body zones without labels cannot create empty, unselectable cards', () => {
    const p = formPage();
    p.run('bodyPartsData = [{db_id:1,subparts:[]},{db_id:2,subparts:[]}];');
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(zonesList().map(zone => zone.label))')), ['Brazo', 'Pierna', 'Torso', 'Espalda', 'Cabeza']);
    p.run("bodyPartsData = [{id:'brazo',label:'Brazo'},{id:'pierna',label:'Pierna'}];");
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(zonesList().map(zone => zone.label))')), ['Brazo', 'Pierna']);
});

test('Escape closes the style picker and returns focus to its summary', () => {
    const p = formPage();
    p.run("view = 'form'; renderView();");
    const picker = p.nodes.get('jbrq-style-select');
    let focused = false;
    picker.querySelector = () => ({ focus() { focused = true; } });
    picker.open = true;
    picker.dispatch('keydown', { key: 'Escape' });
    assert.equal(picker.open, false);
    assert.equal(focused, true);
});
