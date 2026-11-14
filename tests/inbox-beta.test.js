'use strict';

// Beta cerrada · frente Inbox (INB-01, 02, 04-08, 10-14).
// Lógica pura de inbox-chat-model.js + contratos de HTML/JS/SQL por lectura.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const Model = require(path.join(root, 'public', 'shared', 'js', 'inbox-chat-model.js'));

const MIGRATION_CHAT = 'supabase/migrations/20261115170000_chat_messages_hardening_adjuntos.sql';
const MIGRATION_CLIENT = 'supabase/migrations/20261115170100_client_inbox_sessions.sql';

/* ------------------------------ modelo puro ------------------------------ */

test('adjuntos: ruta <quote>/<user>/<ts>-<nombre> sin traversal y validación de formato/tamaño', () => {
    assert.equal(Model.chatAttachmentPath('Q-1', 'u-9', 'Mi dragón final.PNG', 1700000000000), 'Q-1/u-9/1700000000000-Mi_dragon_final.PNG');
    assert.equal(Model.safeFileName('../../etc/passwd'), 'etc_passwd');
    assert.ok(!Model.chatAttachmentPath('Q', 'u', '../x', 1).includes('..'));
    assert.equal(Model.safeFileName(''), 'archivo');
    assert.equal(Model.validateAttachment({ type: 'image/png', size: 1024 }).ok, true);
    assert.equal(Model.validateAttachment({ type: 'application/pdf', size: 15 * 1024 * 1024 }).ok, true);
    assert.equal(Model.validateAttachment({ type: 'image/png', size: 15 * 1024 * 1024 + 1 }).ok, false);
    assert.equal(Model.validateAttachment({ type: 'text/html', size: 10 }).ok, false);
    assert.equal(Model.validateAttachment(null).ok, false);
    assert.equal(Model.messageKind('image/webp'), 'image');
    assert.equal(Model.messageKind('application/pdf'), 'file');
    assert.equal(Model.messageKind(null), 'text');
});

test('INB-04: addUnique descarta el eco realtime del mismo id', () => {
    const list = [];
    assert.equal(Model.addUnique(list, { id: 'a', body: 'hola' }), true);
    assert.equal(Model.addUnique(list, { id: 'a', body: 'hola' }), false);
    // Dos mensajes con el mismo texto y distinto id son dos mensajes.
    assert.equal(Model.addUnique(list, { id: 'b', body: 'hola' }), true);
    assert.equal(list.length, 2);
    assert.deepEqual(Model.firstRow([{ id: 'x' }]), { id: 'x' });
    assert.equal(Model.firstRow([]), null);
});

test('INB-07: tarjeta de cotización solo con precio enviado', () => {
    assert.equal(Model.quoteCard({ quote_status: 'pending', final_budget_amount: '450' }), null);
    assert.equal(Model.quoteCard({ quote_status: 'responded', final_budget_amount: '' }), null);
    const card = Model.quoteCard({
        quote_id: 'Q-7', quote_status: 'responded', final_budget_amount: '450', final_budget_currency: 'usd',
        tattoo_style: { style_name: 'Japonés' }, tattoo_body_part: 'Espalda', final_sessions: '3', artist_session_minutes: 270,
        artist_responded_at: '2026-11-10T10:00:00Z',
    });
    assert.equal(card.price, '$450 USD');
    assert.equal(card.title, 'Tatuaje japonés en espalda');
    assert.equal(card.duration, '3 sesiones · 4,5 horas por sesión');
    assert.equal(card.quoteId, 'Q-7');
    assert.equal(card.at, '2026-11-10T10:00:00Z');
    // Sin precio final usa el del artista.
    assert.equal(Model.quoteCard({ quote_status: 'client_approved', artist_budget_amount: '1200', artist_budget_currency: 'ARS' }).price, '$1.200 ARS');
});

test('INB-13: con la cotización aceptada el chat pasa a la categoría Clientes', () => {
    assert.equal(Model.artistCategoryForQuote('pending'), 'quotations');
    assert.equal(Model.artistCategoryForQuote('responded'), 'quotations');
    for (const status of ['client_approved', 'in_progress', 'artist_completed', 'completed']) {
        assert.equal(Model.artistCategoryForQuote(status), 'clients', status);
    }
});

test('INB-06: hilo sintético y cotizaciones para iniciar conversación', () => {
    const quote = { id: 31, quote_id: 'Q-31', artist_id: 'a', client_user_id: 'c', quote_status: 'responded', updated_at: '2026-11-01T00:00:00Z' };
    const thread = Model.syntheticQuoteThread(quote);
    assert.equal(thread.quote_id, 'Q-31');
    assert.equal(thread.quotation_id_int, 31);
    assert.equal(thread.synthetic, true);
    assert.equal(thread.unread_for_client, 0);
    assert.equal(thread.last_message, null);
    assert.equal(Model.syntheticQuoteThread(null), null);

    const quotes = [
        quote,
        { quote_id: 'Q-2', artist_id: 'a', client_user_id: 'c', quote_status: 'pending' },
        { quote_id: 'Q-3', artist_id: 'a', client_user_id: 'c', quote_status: 'completed' },
        { quote_id: 'Q-4', artist_id: 'a', client_user_id: 'c', quote_status: 'in_progress' },
        { quote_id: 'Q-5', artist_id: 'a', client_user_id: null, quote_status: 'pending' },
        { quote_id: 'Q-6', artist_id: 'a', client_user_id: 'c', quote_status: 'pending', client_deleted_at: '2026-01-01' },
    ];
    const startable = Model.startableQuotes(quotes, [{ quote_id: 'Q-2' }]).map((q) => q.quote_id);
    assert.deepEqual(startable, ['Q-31']);
    // Revisión: in_progress con respuesta del artista es trabajo en curso (se
    // puede escribir); sin respuesta ni precio es el borrador del cotizador.
    const working = { quote_id: 'Q-8', artist_id: 'a', client_user_id: 'c', quote_status: 'in_progress', artist_responded_at: '2026-11-01T10:00:00Z' };
    assert.deepEqual(Model.startableQuotes([working, quotes[3]], []).map((q) => q.quote_id), ['Q-8']);
    assert.equal(Model.isDraftQuote(quotes[3]), true);
    assert.equal(Model.isDraftQuote({ final_budget_amount: '300' }), false);
});

test('INB-11: fila para iniciar soporte sin conversación o con la última cerrada', () => {
    assert.equal(Model.needsSupportStarter([], null), true);
    assert.equal(Model.needsSupportStarter([], { id: 's', status: 'closed' }), true);
    assert.equal(Model.needsSupportStarter([], { id: 's', status: 'bot' }), false);
    assert.equal(Model.needsSupportStarter([{ category: 'support' }], null), false);
});

test('referencias: miniatura de Drive solo para http(s)', () => {
    assert.equal(Model.referenceThumb('https://drive.google.com/file/d/AbC_12-x/view'), 'https://drive.google.com/thumbnail?id=AbC_12-x&sz=w400');
    assert.equal(Model.referenceThumb('javascript:alert(1)'), '');
    assert.equal(Model.referenceThumb('data:image/png;base64,xx'), '');
    assert.equal(Model.referenceThumb('https://cdn.example.com/ref.jpg'), 'https://cdn.example.com/ref.jpg');
    assert.equal(Model.initials('Sofía Rossi'), 'SR');
    assert.equal(Model.initials(''), '·');
});

/* ------------------------------ INB-01 XSS ------------------------------ */

test('INB-01: el chat del dashboard del cliente no interpola mensajes en innerHTML', () => {
    const js = read('public/shared/js/client-dashboard.js');
    assert.doesNotMatch(js, /\$\{\s*(msg|message)\.message\s*\}/);
    assert.match(js, /function buildChatMessageEl\(msg\)/);
    assert.match(js, /document\.createTextNode\(text\)/);
    assert.match(js, /time\.textContent = formatTime\(msg\.created_at\)/);
    // Dedupe del eco realtime por id.
    assert.match(js, /data-message-id/);
});

test('INB-01: /client/chats arma el DOM con textContent (sin innerHTML)', () => {
    const js = read('public/shared/js/client-chats.js');
    assert.doesNotMatch(js, /\.innerHTML\s*=/);
    assert.match(js, /node\.textContent = String\(text\)/);
});

/* ------------------------------ INB-02 / 07 SQL ------------------------------ */

test('INB-02/07: migración de chat_messages (grants, check, trigger, adjuntos, bucket)', () => {
    const sql = read(MIGRATION_CHAT).toLowerCase();
    assert.match(sql, /revoke all on table public\.chat_messages from anon/);
    assert.match(sql, /revoke update, delete, truncate, references, trigger on table public\.chat_messages from authenticated/);
    assert.match(sql, /grant update \(is_read\) on table public\.chat_messages to authenticated/);
    assert.match(sql, /chat_messages_content_check[\s\S]*char_length\(message\) <= 4000[\s\S]*attachment_path is not null/);
    assert.match(sql, /add column if not exists attachment_path text/);
    assert.match(sql, /add column if not exists message_kind text not null default 'text'/);
    assert.match(sql, /before insert on public\.chat_messages/);
    assert.match(sql, /new\.is_read := false/);
    assert.match(sql, /ruta de adjunto inválida/);
    assert.match(sql, /drop policy if exists users_update_read_status[\s\S]*with check \(is_read = true\)/);
    assert.match(sql, /'chat-attachments', 'chat-attachments', false, 15728640/);
    assert.match(sql, /chat_attachments_party_insert[\s\S]*\(storage\.foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text/);
    assert.match(sql, /create or replace view public\.chat_threads[\s\S]*security_invoker = on[\s\S]*imagen adjunta/);
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261115170000_chat_messages_hardening_adjuntos.down.sql')));
});

test('INB-08/10: RPC del cliente con columnas seguras y sin anon', () => {
    const sql = read(MIGRATION_CLIENT).toLowerCase();
    assert.match(sql, /create or replace function public\.list_client_quotation_sessions\(p_quotation_ids integer\[\]\)/);
    const sessions = sql.slice(sql.indexOf('create or replace function public.list_client_quotation_sessions'),
        sql.indexOf('create or replace function public.list_client_inbox_threads'));
    assert.ok(sessions.length > 100);
    assert.doesNotMatch(sessions, /\bnotes\b|photo_urls|google_event_id/);
    assert.match(sessions, /q\.client_user_id = \(select auth\.uid\(\)\)/);
    assert.match(sql, /create or replace function public\.list_client_inbox_threads\(\)/);
    assert.match(sql, /p\.participant_role = 'client'/);
    assert.match(sql, /revoke all on function public\.list_client_inbox_threads\(\) from public, anon/);
    assert.match(sql, /grant execute on function public\.list_client_quotation_sessions\(integer\[\]\) to authenticated/);
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261115170100_client_inbox_sessions.down.sql')));
});

/* ------------------------------ repos ------------------------------ */

test('repos: envío devuelve la fila guardada, adjuntos, sesiones del cliente y aviso por correo', () => {
    const repo = read('public/shared/js/data/quotations-repo.js');
    assert.match(repo, /c\.from\('chat_messages'\)\.insert\(row\)\.select\('\*'\)/);
    assert.match(repo, /storage\.from\('chat-attachments'\)\.upload/);
    assert.match(repo, /c\.rpc\('list_client_quotation_sessions'/);
    assert.match(repo, /getForArtistByQuoteId/);
    assert.match(repo, /'chat_message_to_client' : 'chat_message_to_artist'/);
    // Un fallo del correo no muestra error sobre un mensaje ya guardado.
    assert.doesNotMatch(repo, /El mensaje se guardó, pero no pudimos confirmar el correo/);
    const columns = repo.slice(repo.indexOf('const CHAT_QUOTE_COLUMNS'), repo.indexOf('Quotations.CHAT_COLUMNS'));
    assert.doesNotMatch(columns, /health|allerg|birth|whatsapp|client_email/);

    const inbox = read('public/shared/js/data/inbox-repo.js');
    assert.match(inbox, /c\.rpc\('list_client_inbox_threads'\)/);
    assert.match(inbox, /sendN8NEvent\('inbox_message_received', \{\s*thread_id: threadId, message_id: message\.id,/);

    const support = read('public/shared/js/data/support-client-repo.js');
    assert.match(support, /\/api\/support-chat\/conversation/);
    assert.match(support, /table: 'support_messages'/);
});

/* ------------------------------ artista ------------------------------ */

test('INB-04/05/06/11: inbox del artista sin duplicados, realtime de la lista, deep link y soporte', () => {
    const js = read('public/shared/js/artist-inbox.js');
    // Sin push optimista con id local después de Chat.sendMessage.
    assert.doesNotMatch(js, /await D\.Chat\.sendMessage\(\{ quoteId: row\.id, senderType: 'artist', senderId: state\.userId, message: body \}\);\s*state\.activeMessages\.push/);
    assert.match(js, /addMessage\(adaptQuoteMessage\(message/);
    assert.match(js, /subscribeNewChatFromSender\('artist-inbox-chat-' \+ state\.userId, 'client', scheduleRefresh\)/);
    assert.match(js, /async function ensureQuoteThread\(quoteId\)/);
    assert.match(js, /El chat se habilita cuando el cliente crea su cuenta/);
    assert.match(js, /key: 'support:new'/);
    assert.match(js, /D\.SupportInbox\.openConversation\('artist_inbox'\)/);
    assert.match(js, /D\.Chat\.uploadAttachment\(row\.id, state\.userId, file\)/);
    assert.match(js, /quoteCardHtml\(/);
    assert.match(js, /data-thread-info/);
    assert.match(js, /weotzi:inbox-read/);
    assert.doesNotMatch(js, /renderUnreadBadge/);
});

test('INB-11/12: HTML y CSS del inbox del artista', () => {
    const html = read('public/artist/inbox/index.html');
    assert.match(html, /id="ai-count-support">0</);
    assert.match(html, /id="ai-context-scrim"/);
    assert.ok(html.indexOf('/shared/js/inbox-chat-model.js') < html.indexOf('/shared/js/artist-inbox.js'));
    const css = read('public/shared/css/artist-inbox-ds.css');
    assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ai-row-star \{ opacity: 0; \}/);
    // Mobile-first: la hoja es la base y desde 1281px vuelve a ser columna.
    assert.match(css, /\n\.ai-shell\.is-context-open \.ai-context \{[^}]*position: fixed/);
    assert.match(css, /@media \(min-width: 1281px\) \{[\s\S]*?\.ai-shell\.is-context-open \.ai-context \{[^}]*position: relative/);
    assert.doesNotMatch(css, /@media\s*\(\s*max-width/i);
    assert.match(css, /\.ai-quote-card \{/);
    // Fuera del hover fino no queda nada escondido con opacity 0.
    const base = css.replace(/@media[^{]*hover: hover[^{]*\{[\s\S]*?\n\}/g, '');
    assert.doesNotMatch(base, /\.ai-row-star \{[^}]*opacity: 0/);
    assert.doesNotMatch(base, /\.ai-ctx-link \{[^}]*opacity: 0/);
});

test('INB-05: el tile Ö suma el inbox unificado y escucha realtime', () => {
    const js = read('public/shared/js/wo-artist-menu.js');
    assert.match(js, /\/shared\/js\/data\/inbox-repo\.js/);
    assert.match(js, /D\.Inbox\.listThreads\(\)/);
    assert.match(js, /state\.counts\.msgs \+=/);
    assert.doesNotMatch(js, /state\.counts\.msgs = unread\.reduce/);
    assert.match(js, /subscribeNewChatFromSender\('wo-menu-chat-' \+ uid, 'client', soon\)/);
    assert.match(js, /addEventListener\('weotzi:inbox-read', soon\)/);
});

/* ------------------------------ cliente ------------------------------ */

test('INB-06/07/08/10: /client/chats une cotizaciones, inbox y reservas', () => {
    const js = read('public/shared/js/client-chats.js');
    assert.match(js, /D\.Inbox\.listClientThreads\(\)/);
    assert.match(js, /D\.Sessions\.listForClient/);
    assert.match(js, /M\.startableQuotes\(quotes, chatThreads\)/);
    assert.match(js, /params\.get\('quote'\)/);
    assert.match(js, /D\.Chat\.uploadAttachment\(row\.id, uid, files\[i\]\)/);
    assert.match(js, /D\.Inbox\.sendMessage\(\{ threadId: row\.id, body: text \}\)/);
    assert.match(js, /quoteCardEl\(/);
    assert.doesNotMatch(js, /pendingOwn/);
});

test('INB-14: topbar del cliente con los labels del Figma, nav móvil y maxlength', () => {
    const html = read('public/client/chats/index.html');
    const nav = html.slice(html.indexOf('<nav class="wo-topbar-nav"'), html.indexOf('</nav>'));
    assert.match(nav, />Explorar artistas<[\s\S]*>Job board<[\s\S]*>Tattoglobe<[\s\S]*aria-current="page">Inbox</);
    assert.doesNotMatch(nav, />Chats</);
    assert.match(html, /id="cch-input"[^>]*maxlength="2000"/);
    assert.match(html, /id="cch-reference"[\s\S]*Enviar referencia/);
    assert.match(html, /id="cch-attach"[^>]*aria-label="Adjuntar archivo"/);
    assert.ok(html.indexOf('/shared/js/data/inbox-repo.js') < html.indexOf('/shared/js/client-chats.js'));
    assert.ok(html.indexOf('/shared/js/inbox-chat-model.js') < html.indexOf('/shared/js/client-chats.js'));
    const css = read('public/shared/css/client-chats-ds.css');
    assert.match(css, /@media \(max-width:1024px\)\{[\s\S]*?\.cch-topbar \.wo-topbar-nav\{display:flex;[^}]*overflow-x:auto/);
});

test('client-auth: returnTo admite volver al Inbox del cliente', () => {
    const window = { location: { pathname: '/client/login', search: '', hash: '', origin: 'https://beta.weotzi.com' } };
    const context = {
        window, console, URLSearchParams,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { addEventListener() {} },
        supabase: { createClient: () => ({ auth: {} }) },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/shared/js/client-auth.js'), 'utf8'), context);
    const n = context.normalizeReturnTo;
    assert.equal(n('/client/chats?quote=Q-1'), '/client/chats?quote=Q-1');
    assert.equal(n('/client/chats/?thread=abc'), '/client/chats/?thread=abc');
    assert.equal(n('/client/dashboard'), null);
    assert.equal(n('/client/chats/../dashboard'), null);
    assert.equal(n('/client/chatsx'), null);
});
