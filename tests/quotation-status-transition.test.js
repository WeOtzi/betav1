const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');

function latestQuotationStatusFunctionBody() {
    const files = fs.readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    let latest = '';
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const matches = sql.match(/CREATE OR REPLACE FUNCTION fn_quotation_status_change\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/g);
        if (matches) {
            latest = matches[matches.length - 1];
        }
    }

    return latest;
}

test('quotation drafts can be submitted from in_progress to pending', () => {
    const fnBody = latestQuotationStatusFunctionBody();

    assert.match(fnBody, /fn_quotation_status_change/);
    assert.match(
        fnBody,
        /"in_progress"\s*:\s*\[[^\]]*"pending"[^\]]*\]/,
        'autosaved quotation drafts must be allowed to transition to pending on final submit'
    );
});

test('quotation close-out requires artist_completed before completed', () => {
    const fnBody = latestQuotationStatusFunctionBody();

    assert.match(fnBody, /"in_progress"\s*:\s*\[[^\]]*"artist_completed"[^\]]*\]/);
    assert.match(fnBody, /"artist_completed"\s*:\s*\[[^\]]*"completed"[^\]]*\]/);
    assert.doesNotMatch(
        fnBody,
        /"in_progress"\s*:\s*\[[^\]]*"completed"[^\]]*\]/,
        'completed reviews must wait for the client acceptance step after artist_completed'
    );
});
