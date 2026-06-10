const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EXPANDED_TATTOO_STYLES } = require('../lib/expanded-tattoo-styles');

const root = path.join(__dirname, '..');

const expandedStyleLabels = EXPANDED_TATTOO_STYLES.map((style) => style.label);

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function missingLabels(source) {
    return expandedStyleLabels.filter((label) => !source.includes(`label: '${label}'`));
}

[
    'public/shared/js/quotation-shared.js',
    'public/shared/js/script.js',
    'public/shared/js/marketplace.js',
    'public/shared/js/job-board-feed.js',
    'public/shared/js/explore-map.js',
    'public/shared/js/explore-globe.js'
].forEach((relativePath) => {
    test(`${relativePath} includes the expanded tattoo style catalog`, () => {
        assert.deepEqual(missingLabels(read(relativePath)), []);
    });
});
