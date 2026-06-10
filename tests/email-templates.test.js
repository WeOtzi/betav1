const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const {
    buildEmailHtml,
    manifest,
    NODE_TEMPLATE_MAP,
    SPECS
} = require('../scripts/redesign-email-templates.js');
const { EVENTS } = require('../services/email-event-mapping.js');

test('all BillionMail templates are generated with required variables', () => {
    for (const [templateName, entry] of Object.entries(manifest)) {
        assert.ok(SPECS[templateName], `missing spec for ${templateName}`);
        const billionmailPath = path.join(ROOT, entry.file);
        const rootPath = path.join(ROOT, 'templates/email', `${templateName}.html`);
        const minPath = path.join(ROOT, 'templates/email', `${templateName}.min.html`);
        for (const file of [billionmailPath, rootPath, minPath]) {
            assert.ok(fs.existsSync(file), `missing generated file: ${file}`);
        }
        const html = fs.readFileSync(billionmailPath, 'utf8');
        assert.match(html, /background:#F2EFE6/, `${templateName} should use the Bauhaus email shell`);
        assert.match(html, /WE&Ouml;TZI/, `${templateName} should include the We Otzi brand mark`);
        for (const variable of entry.variables) {
            assert.ok(
                html.includes(`{{${variable}}}`),
                `${templateName} must expose {{${variable}}}`
            );
        }
    }
});

test('email event template hints point to generated templates', () => {
    for (const [eventId, event] of Object.entries(EVENTS)) {
        assert.ok(event.templateHint, `${eventId} missing templateHint`);
        assert.ok(manifest[event.templateHint], `${eventId} points to unknown template ${event.templateHint}`);
    }
});

test('public n8n events are mapped by the backend email service', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/shared/js/app-config.json'), 'utf8'));
    for (const event of config.n8n.events) {
        assert.ok(EVENTS[event.id], `public n8n event ${event.id} is not mapped in email-event-mapping.js`);
    }
});

test('n8n workflow node templates render with expression placeholders', () => {
    for (const [workflowName, workflow] of Object.entries(NODE_TEMPLATE_MAP)) {
        assert.ok(workflow.id, `${workflowName} missing workflow id`);
        for (const [nodeName, node] of Object.entries(workflow.nodes)) {
            assert.ok(manifest[node.template], `${workflowName}/${nodeName} points to unknown template`);
            const html = buildEmailHtml(node.template, { mode: 'n8n', source: node.source });
            assert.ok(html.startsWith('=<!DOCTYPE html>'), `${workflowName}/${nodeName} must be an n8n expression HTML document`);
            const firstVar = manifest[node.template].variables[0];
            const expectedPrefix = node.source === 'body' ? `$json.body.data.${firstVar}` : `$json.${firstVar}`;
            assert.ok(html.includes(expectedPrefix), `${workflowName}/${nodeName} missing ${expectedPrefix}`);
        }
    }
});
