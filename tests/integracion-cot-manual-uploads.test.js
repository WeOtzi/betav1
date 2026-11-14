'use strict';

// RLS-STORAGE-MIME-03: la cotización manual solo sube lo que acepta el bucket
// quotation-references (lista cerrada desde 20261115130000).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../public/shared/js/quotation-new-model.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('uploadMimeFor: tipos admitidos, inferencia por extensión y rechazos', () => {
    assert.equal(M.uploadMimeFor({ name: 'a.png', type: 'image/png' }), 'image/png');
    assert.equal(M.uploadMimeFor({ name: 'a.jpg', type: 'image/jpg' }), 'image/jpeg');
    assert.equal(M.uploadMimeFor({ name: 'brief.pdf', type: 'application/pdf' }), 'application/pdf');
    // HEIC en Chrome de Windows: file.type vacío.
    assert.equal(M.uploadMimeFor({ name: 'IMG_0001.HEIC', type: '' }), 'image/heic');
    assert.equal(M.uploadMimeFor({ name: 'foto.heif', type: 'application/octet-stream' }), 'image/heif');
    assert.equal(M.uploadMimeFor({ name: 'logo.svg', type: 'image/svg+xml' }), null);
    assert.equal(M.uploadMimeFor({ name: 'scan.tiff', type: 'image/tiff' }), null);
    assert.equal(M.uploadMimeFor({ name: 'old.bmp', type: 'image/bmp' }), null);
    assert.equal(M.uploadMimeFor({ name: 'sin-extension', type: '' }), null);
    assert.equal(M.uploadMimeFor(null), null);
});

test('la lista coincide con el bucket (sin video: esta pantalla sube imágenes y PDF)', () => {
    const sql = read('supabase/migrations/20261115130000_cot_form_rls_cierre.sql');
    for (const mime of M.UPLOAD_MIME_TYPES) assert.ok(sql.includes(`'${mime}'`), mime);
    assert.match(M.UPLOAD_ACCEPT, /\.heic,\.heif$/);
    assert.doesNotMatch(M.UPLOAD_ACCEPT, /image\/\*/);
});

test('quotation-new usa el accept cerrado y descarta los tipos no admitidos con aviso', () => {
    const js = read('public/shared/js/quotation-new.js');
    assert.match(js, /accept="\$\{esc\(M\.UPLOAD_ACCEPT\)\}"/);
    assert.doesNotMatch(js, /accept="image\/\*,application\/pdf"/);
    assert.match(js, /M\.uploadMimeFor\(f\)/);
    assert.match(js, /new File\(\[f\], f\.name, \{ type: mime/);
});
