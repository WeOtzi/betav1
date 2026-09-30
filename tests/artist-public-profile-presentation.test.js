const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPortfolioFilterOptions,
    buildSpecialtyRows,
    setDisclosureState
} = require('../public/shared/js/artist-profile-presentation');

test('portfolio filters use artwork styles and keep one canonical Todos option', () => {
    const options = buildPortfolioFilterOptions([
        { styles: ['Fine line', 'Botánico'], category: 'realizados' },
        { styles: ['fine line', 'Blackwork'], category: 'flash' }
    ], {
        realizados: 'Realizados',
        flash: 'Flash'
    });

    assert.deepEqual(options, [
        { value: 'todos', label: 'Todos' },
        { value: 'fine-line', label: 'Fine line' },
        { value: 'botanico', label: 'Botánico' },
        { value: 'blackwork', label: 'Blackwork' }
    ]);
});

test('portfolio filters fall back to real artwork categories when styles are absent', () => {
    const options = buildPortfolioFilterOptions([
        { styles: [], category: 'realizados' },
        { styles: [], category: 'flash' },
        { styles: [], category: 'flash' }
    ], {
        realizados: 'Realizados',
        flash: 'Flash'
    });

    assert.deepEqual(options, [
        { value: 'todos', label: 'Todos' },
        { value: 'realizados', label: 'Realizados' },
        { value: 'flash', label: 'Flash' }
    ]);
});

test('specialty rows connect descriptions and the first matching artwork without inventing either', () => {
    const rows = buildSpecialtyRows(
        ['Fine line', 'Blackwork', 'Geométrico'],
        [
            { url: 'https://cdn.example/blackwork.jpg', kind: 'image', styles: ['Blackwork'] },
            { url: 'https://cdn.example/fine-line.mp4', kind: 'video', styles: ['Fine line'] }
        ],
        {
            'fine-line': 'Trazo continuo de una sola aguja.',
            blackwork: 'Negros sólidos y alto contraste.'
        }
    );

    assert.deepEqual(rows, [
        {
            name: 'Fine line',
            key: 'fine-line',
            description: 'Trazo continuo de una sola aguja.',
            mediaUrl: 'https://cdn.example/fine-line.mp4',
            mediaKind: 'video'
        },
        {
            name: 'Blackwork',
            key: 'blackwork',
            description: 'Negros sólidos y alto contraste.',
            mediaUrl: 'https://cdn.example/blackwork.jpg',
            mediaKind: 'image'
        },
        {
            name: 'Geométrico',
            key: 'geometrico',
            description: '',
            mediaUrl: '',
            mediaKind: 'image'
        }
    ]);
});

test('mobile product navigation keeps aria-expanded and hidden in sync', () => {
    const attributes = {};
    const toggle = {
        setAttribute(name, value) {
            attributes[name] = value;
        }
    };
    const menu = { hidden: true };

    setDisclosureState(toggle, menu, true);
    assert.equal(attributes['aria-expanded'], 'true');
    assert.equal(menu.hidden, false);

    setDisclosureState(toggle, menu, false);
    assert.equal(attributes['aria-expanded'], 'false');
    assert.equal(menu.hidden, true);
});
