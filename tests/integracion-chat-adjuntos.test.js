'use strict';

// Mensajes de chat que son solo un adjunto (message = '' desde 20261115170000):
// el correo y las vistas del artista muestran qué se adjuntó (CHAT-01/02/03).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveEmailContext, chatPreviewText } = require('../services/email-request-context');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('CHAT-01: chatPreviewText usa el texto, o el adjunto si el mensaje está vacío', () => {
    assert.equal(chatPreviewText({ message: '  hola  ' }), 'hola');
    assert.equal(chatPreviewText({ message: '', attachment_path: 'q/1.png', message_kind: 'image', attachment_name: 'boceto.png' }), 'Imagen adjunta: boceto.png');
    assert.equal(chatPreviewText({ message: '', attachment_path: 'q/1.pdf', message_kind: 'file' }), 'Adjunto');
    assert.equal(chatPreviewText({ message: '' }), '');
    assert.equal(chatPreviewText(null), '');
});

test('CHAT-01: el aviso por email de un adjunto no sale con el extracto vacío', async () => {
    const quote = { id: 1, quote_id: 'WO-100', artist_id: 'artist-id', client_user_id: 'client-id',
        artist_email: 'artist@example.com', client_email: 'client@example.com', client_full_name: 'Client',
        created_at: new Date().toISOString(), quote_status: 'pending' };
    const deps = {
        resolveUser: async () => ({ id: 'artist-id', email: quote.artist_email }),
        read: async (table) => (table === 'quotations_db' ? quote : null),
        verifyAdmin: async () => ({ ok: false, status: 403 }),
        latestMessage: async () => ({ id: 7, message: '', attachment_path: 'WO-100/a.jpg', message_kind: 'image', attachment_name: 'ref.jpg' })
    };
    const result = await resolveEmailContext({ headers: { host: 'weotzi.com' } }, 'chat_message_to_client', { quote_id: quote.quote_id }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.payload.message_preview, 'Imagen adjunta: ref.jpg');
});

test('CHAT-02: el detalle del artista muestra el adjunto en vez de una burbuja vacía', () => {
    const js = read('public/shared/js/quotation-detail-figma.js');
    assert.match(js, /function messageBodyHtml\(message\)/);
    assert.match(js, /\$\{messageBodyHtml\(message\)\}/);
    assert.doesNotMatch(js, /<p>\$\{esc\(message\.message \|\| ''\)\}<\/p>/);
    assert.match(js, /esc\(`\$\{attachmentLabel\(message\)\} · ver en Inbox`\)/);
});

test('CHAT-03: el resumen de cotizaciones muestra el adjunto', () => {
    const js = read('public/shared/js/quotations-summary.js');
    assert.match(js, /<p class="qs-msg-bubble">\$\{esc\(messageText\(m\)\)\}<\/p>/);
    assert.match(js, /'Imagen adjunta' : 'Archivo adjunto'/);
});
