'use strict';
// ===========================================================================
// Mini DOM para tests (sin dependencias).
// ---------------------------------------------------------------------------
// Lo justo para ejercitar en node:test los controladores vanilla del front que
// arman HTML con innerHTML y delegan eventos: elementos, atributos, classList,
// innerHTML (parser de etiquetas simples), selectores compuestos
// (tag, #id, .clase, [attr], [attr="valor"], listas con coma), closest/matches,
// y eventos con fases de captura y burbujeo. No es un navegador: no hay layout,
// CSS ni scripts inline.
//
//   const { createDocument } = require('./helpers/mini-dom');
//   const document = createDocument();
//   const host = document.createElement('div');
//   document.body.appendChild(host);
//   host.innerHTML = '<button class="x" data-id="1">Hola</button>';
//   host.querySelector('.x[data-id="1"]').click();
// ===========================================================================

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text) => String(text).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);
const encode = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encodeAttr = (text) => encode(text).replace(/"/g, '&quot;');
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);

class TextNode {
    constructor(text) { this.nodeType = 3; this.data = text; this.parentNode = null; }
    get textContent() { return this.data; }
}

// "div.a.b#id[x="1"][y]" → { tag, id, classes, attrs }
function parseCompound(selector) {
    const out = { tag: null, id: null, classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/gy;
    let pos = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(selector))) {
        if (m[1] && pos === 0) out.tag = m[1].toLowerCase();
        else if (m[1]) throw new Error('selector no soportado: ' + selector);
        else if (m[2]) out.id = m[2];
        else if (m[3]) out.classes.push(m[3]);
        else if (m[4]) out.attrs.push([m[4], m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7]]);
        pos = re.lastIndex;
    }
    if (pos !== selector.length) throw new Error('selector no soportado: ' + selector);
    return out;
}

const selectorCache = new Map();
function compile(selector) {
    if (!selectorCache.has(selector)) {
        selectorCache.set(selector, String(selector).split(',').map((part) => parseCompound(part.trim())));
    }
    return selectorCache.get(selector);
}

class Element {
    constructor(tagName, ownerDocument) {
        this.nodeType = 1;
        this.localName = String(tagName).toLowerCase();
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.childNodes = [];
        this.style = {};
        this._attrs = new Map();
        this._listeners = [];
    }

    // Como en el navegador: HTML en mayúsculas, SVG en minúsculas.
    get tagName() { return this.localName === 'svg' || this.ownerSVGElement ? this.localName : this.localName.toUpperCase(); }

    // ---- atributos ----
    getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
    setAttribute(name, value) { this._attrs.set(name, String(value)); }
    hasAttribute(name) { return this._attrs.has(name); }
    removeAttribute(name) { this._attrs.delete(name); }
    get id() { return this.getAttribute('id') || ''; }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get value() { return this._value !== undefined ? this._value : (this.getAttribute('value') || ''); }
    set value(value) { this._value = String(value); }
    get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
    set checked(value) {
        this._checked = !!value;
        // Un radio marcado desmarca a los de su mismo nombre.
        if (value && this.getAttribute('type') === 'radio') {
            const name = this.getAttribute('name');
            let top = this;
            while (top.parentNode) top = top.parentNode;
            top.querySelectorAll('input').forEach((other) => {
                if (other !== this && other.getAttribute('type') === 'radio' && other.getAttribute('name') === name) other._checked = false;
            });
        }
    }

    get classList() {
        const el = this;
        const list = () => el.className.split(/\s+/).filter(Boolean);
        return {
            contains: (name) => list().includes(name),
            add: (...names) => { el.className = [...new Set(list().concat(names))].join(' '); },
            remove: (...names) => { el.className = list().filter((n) => !names.includes(n)).join(' '); },
            toggle: (name, force) => {
                const has = list().includes(name);
                const want = force === undefined ? !has : !!force;
                if (want && !has) el.className = list().concat([name]).join(' ');
                if (!want && has) el.className = list().filter((n) => n !== name).join(' ');
                return want;
            }
        };
    }

    get dataset() {
        const el = this;
        const attr = (prop) => 'data-' + String(prop).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        return new Proxy({}, {
            get: (_, prop) => (typeof prop === 'string' && el.hasAttribute(attr(prop)) ? el.getAttribute(attr(prop)) : undefined),
            set: (_, prop, value) => { el.setAttribute(attr(prop), value); return true; }
        });
    }

    // ---- árbol ----
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, reference) {
        if (node.parentNode) node.parentNode.removeChild(node);
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index === -1) this.childNodes.push(node); else this.childNodes.splice(index, 0, node);
        node.parentNode = this;
        return node;
    }
    removeChild(node) {
        const index = this.childNodes.indexOf(node);
        if (index !== -1) this.childNodes.splice(index, 1);
        node.parentNode = null;
        if (this.ownerDocument && this.ownerDocument.activeElement === node) this.ownerDocument.activeElement = this.ownerDocument.body;
        return node;
    }
    contains(node) {
        for (let n = node; n; n = n.parentNode) if (n === this) return true;
        return false;
    }
    get ownerSVGElement() {
        for (let n = this.parentNode; n; n = n.parentNode) if (n.localName === 'svg') return n;
        return null;
    }

    get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
    set textContent(value) {
        this.childNodes.forEach((n) => { n.parentNode = null; });
        this.childNodes = [];
        if (value !== '' && value !== null && value !== undefined) this.appendChild(new TextNode(String(value)));
    }

    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) {
        const active = this.ownerDocument && this.ownerDocument.activeElement;
        if (active && active !== this && this.contains(active)) this.ownerDocument.activeElement = this.ownerDocument.body;
        this.childNodes.forEach((n) => { n.parentNode = null; });
        this.childNodes = [];
        parseInto(this, String(html));
    }
    get outerHTML() { return serialize(this); }

    // ---- selectores ----
    matches(selector) {
        return compile(selector).some((c) => {
            if (c.tag && c.tag !== this.localName) return false;
            if (c.id && c.id !== this.id) return false;
            if (!c.classes.every((name) => this.classList.contains(name))) return false;
            return c.attrs.every(([name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value));
        });
    }
    closest(selector) {
        for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n;
        return null;
    }
    querySelectorAll(selector) {
        const found = [];
        const walk = (node) => {
            node.childNodes.forEach((child) => {
                if (child.nodeType !== 1) return;
                if (child.matches(selector)) found.push(child);
                walk(child);
            });
        };
        walk(this);
        return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

    // ---- eventos ----
    addEventListener(type, handler, capture) { this._listeners.push({ type, handler, capture: !!capture }); }
    removeEventListener(type, handler, capture) {
        this._listeners = this._listeners.filter((l) => !(l.type === type && l.handler === handler && l.capture === !!capture));
    }
    dispatchEvent(event) { return dispatch(this, event); }
    click() { return this.dispatchEvent(createEvent('click', { bubbles: true })); }
    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
        this.dispatchEvent(createEvent('focusin', { bubbles: true }));
    }

    // ---- sin layout ----
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 400 }; }
    scrollIntoView() {}
}

function serialize(node) {
    if (node.nodeType === 3) return encode(node.data);
    const attrs = [...node._attrs].map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${encodeAttr(value)}"`)).join('');
    if (VOID.has(node.localName)) return `<${node.localName}${attrs}>`;
    return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

function parseInto(root, html) {
    const doc = root.ownerDocument;
    const token = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    const attribute = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const stack = [root];
    let m;
    while ((m = token.exec(html))) {
        const parent = stack[stack.length - 1];
        if (m[1]) {
            // Cierre: se desapila hasta la etiqueta que corresponde.
            const name = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].localName === name) { stack.length = i; break; }
            }
        } else if (m[2]) {
            const el = new Element(m[2], doc);
            let a;
            attribute.lastIndex = 0;
            while ((a = attribute.exec(m[3] || ''))) {
                el.setAttribute(a[1], decode(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : ''));
            }
            parent.appendChild(el);
            if (!m[4] && !VOID.has(el.localName)) stack.push(el);
        } else if (m[5] !== undefined) {
            parent.appendChild(new TextNode(decode(m[5])));
        }
    }
}

function createEvent(type, init) {
    const event = Object.assign({
        type, bubbles: false, target: null, currentTarget: null, defaultPrevented: false, _stopped: false,
        key: undefined, pointerType: undefined, clientX: 0, clientY: 0, relatedTarget: null
    }, init || {});
    event.preventDefault = () => { event.defaultPrevented = true; };
    event.stopPropagation = () => { event._stopped = true; };
    return event;
}

// Captura (de la raíz al destino) → destino → burbujeo (si el evento burbujea).
function dispatch(target, event) {
    event.target = target;
    const path = [];
    for (let n = target; n; n = n.parentNode) path.push(n);
    const doc = target.ownerDocument;
    if (doc && path[path.length - 1] === doc.documentElement) path.push(doc);
    const run = (node, capture) => {
        if (event._stopped) return;
        event.currentTarget = node;
        node._listeners.slice().forEach((l) => {
            if (l.type === event.type && (capture === null || l.capture === capture)) l.handler.call(node, event);
        });
    };
    for (let i = path.length - 1; i > 0; i--) run(path[i], true);
    run(target, null);
    if (event.bubbles) for (let i = 1; i < path.length; i++) run(path[i], false);
    return !event.defaultPrevented;
}

function createDocument() {
    const document = {
        nodeType: 9, _listeners: [], activeElement: null, parentNode: null,
        createElement(tag) { return new Element(tag, document); },
        createTextNode(text) { return new TextNode(String(text)); },
        addEventListener(type, handler, capture) { document._listeners.push({ type, handler, capture: !!capture }); },
        removeEventListener() {},
        getElementById(id) { return document.documentElement.querySelectorAll('[id]').find((el) => el.id === id) || null; },
        querySelector(selector) { return document.documentElement.querySelector(selector); },
        querySelectorAll(selector) { return document.documentElement.querySelectorAll(selector); }
    };
    document.documentElement = new Element('html', document);
    document.body = new Element('body', document);
    document.documentElement.appendChild(document.body);
    document.activeElement = document.body;
    return document;
}

module.exports = { createDocument, createEvent, Element, TextNode };
