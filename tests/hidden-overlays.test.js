const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Regresión (27 ago 2026): el panel de notificaciones quedaba visible de forma
// permanente aunque el JS lo marcara con `hidden`. Causa: el atributo hidden
// aplica display:none desde la hoja del user-agent y CUALQUIER `display` de
// autor (el flex del panel) le gana. Estos tests fijan las dos guardas.

const root = path.resolve(__dirname, '..');
const readPublic = (...p) => fs.readFileSync(path.resolve(root, 'public', ...p), 'utf8');

const componentsCss = readPublic('shared', 'css', 'ds', 'components.css');
const artistMenuJs = readPublic('shared', 'js', 'wo-artist-menu.js');

test('el DS cierra [hidden] globalmente (gana sobre cualquier display de autor)', () => {
    assert.match(componentsCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('los overlays del menú de artista traen su propia guarda [hidden]', () => {
    // El componente inyecta su CSS, así que no depende del orden de carga del DS.
    assert.match(artistMenuJs, /\.wo-oam-drop\[hidden\][^']*display:none !important/);
    assert.match(artistMenuJs, /\.wo-oam-panel\[hidden\]/);
    assert.match(artistMenuJs, /\.wo-oam-scrim\[hidden\]/);
});

test('ningún CSS del proyecto muestra un elemento que tenga [hidden]', () => {
    // `:not([hidden]){display:flex}` es el patrón correcto y queda excluido;
    // lo que se prohíbe es `.algo[hidden]{display:flex}` (contradice el atributo).
    const cssDir = path.resolve(root, 'public', 'shared', 'css');
    const files = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.css')) files.push(full);
        }
    })(cssDir);

    const offenders = [];
    for (const file of files) {
        // Sin comentarios: los que mencionan [hidden] en prosa no son selectores.
        const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const re = /([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(css)) !== null) {
            const selector = m[1];
            const body = m[2];
            if (selector.includes(':not([hidden])')) continue;
            if (/display\s*:\s*(flex|grid|block|inline|inline-flex|inline-block)/.test(body)) {
                offenders.push(path.relative(root, file) + ' → ' + selector.trim());
            }
        }
    }
    assert.deepEqual(offenders, [], 'Selectores que muestran elementos con [hidden]:\n' + offenders.join('\n'));
});
