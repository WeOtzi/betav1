const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the code step tells the recipient where the six-digit code was sent', () => {
    const html = fs.readFileSync('public/recover/index.html', 'utf8');
    const view = html.match(/<section id="rc-view-code"[\s\S]*?<\/section>/)?.[0];
    assert.ok(view, 'code view exists');
    assert.match(view, /Te enviamos un código de 6 dígitos a la <strong id="rc-code-email"><\/strong>\./);
    assert.match(view, /id="rc-resend-timer"/);
    assert.match(view, /id="rc-resend-btn"/);
    assert.match(view, /id="rc-code-error"[^>]*role="alert"/);
});
