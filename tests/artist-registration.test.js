const test = require('node:test');
const assert = require('node:assert/strict');

const registration = require('../lib/artist-registration');

test('draft payload stays incomplete and does not invent an auth user id', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'Artist@Example.com',
        registration_source: 'email'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        source: 'email',
        status: registration.REGISTRATION_STATUS_INCOMPLETE,
        allowEmailUsernameFallback: false,
        started: true,
        now: '2026-05-13T00:00:00.000Z'
    });

    assert.equal(payload.email, 'artist@example.com');
    assert.equal(payload.registration_status, 'incompleto');
    assert.equal(payload.registration_draft_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(payload.username, null);
    assert.equal(payload.subscribed_newsletter, null);
    assert.equal(Object.hasOwn(payload, 'user_id'), false);
});

test('final payload defaults newsletter to false only at submission time', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'Artist@Example.com',
        artistic_name: 'Black Ink'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        status: registration.REGISTRATION_STATUS_PENDING_VALIDATION,
        submitted: true,
        now: '2026-05-13T00:00:00.000Z'
    });

    assert.equal(payload.subscribed_newsletter, false);
});

test('final payload links auth user and marks pending validation', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'Artist@Example.com',
        artistic_name: 'Black Ink',
        full_name: 'ana perez',
        styles: ['Tradicional', 'Blackwork'],
        session_price: '100',
        session_currency: 'USD',
        work_type: 'independent'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        source: 'email',
        status: registration.REGISTRATION_STATUS_PENDING_VALIDATION,
        submitted: true,
        now: '2026-05-13T00:00:00.000Z'
    });

    assert.equal(payload.user_id, '22222222-2222-4222-8222-222222222222');
    assert.equal(payload.registration_status, 'pendiente de validacion');
    assert.equal(payload.username, 'blackink.wo');
    assert.equal(payload.name, 'Ana Perez');
    assert.equal(payload.session_price, '100 USD');
    assert.equal(payload.session_price_amount, 100);
    assert.equal(payload.session_price_currency, 'USD');
    assert.equal(payload.estudios, 'Sin estudio/Independiente');
    assert.equal(payload.registration_submitted_at, '2026-05-13T00:00:00.000Z');
});

test('public artist draft exposes session price amount and currency for review hydration', () => {
    const draft = registration.publicArtistDraft({
        registration_draft_id: '11111111-1111-4111-8111-111111111111',
        email: 'artist@example.com',
        session_price: '500 USD',
        session_price_amount: 500,
        session_price_currency: 'USD'
    });

    assert.equal(draft.session_price, '500 USD');
    assert.equal(draft.session_price_amount, 500);
    assert.equal(draft.session_price_currency, 'USD');
});

test('artist username joins spaced words and removes accents consistently', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'artist@example.com',
        artistic_name: 'José Tattoo Studio',
        full_name: 'maría del sol'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        now: '2026-05-13T00:00:00.000Z'
    });

    assert.equal(payload.username, 'josetattoostudio.wo');
    assert.equal(payload.name, 'María Del Sol');
});

test('password is omitted when neither formData.signup_password nor options.password is provided', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'a@b.com'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        now: '2026-05-13T00:00:00.000Z'
    });
    assert.equal(Object.hasOwn(payload, 'password'), false);
});

test('password is NEVER mirrored into the payload (plaintext mirror removed)', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'a@b.com',
        signup_password: 'fromWizard1!'
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        password: 'fromOptions1!',
        now: '2026-05-13T00:00:00.000Z'
    });
    assert.equal(Object.hasOwn(payload, 'password'), false);
});

test('server sanitizes rich mobile bio HTML before writing the artist payload', () => {
    const mobileRichBio = `
        <p onclick="alert('bad')">
            🎨🖤 <span style="font-weight: 700; font-style: italic; color: rgb(229, 57, 53); position: fixed;">Bio movil</span><br>
            <font color="#1A4B8E">Linea con color heredado</font>
            <a href="javascript:alert('x')" onclick="alert('x')">link inseguro</a>
            <a href="https://example.com/profile" onclick="alert('x')">portfolio</a>
        </p>
        <img src=x onerror="alert('x')">
        <script>alert('x')</script>
    `;

    const payload = registration.buildArtistRegistrationPayload({
        email: 'mobile-bio@example.com',
        artistic_name: 'Mobile Bio',
        full_name: 'mobile bio',
        work_type: 'independent',
        bio: mobileRichBio
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        now: '2026-05-26T00:00:00.000Z'
    });

    assert.match(payload.bio_description, /🎨🖤/u);
    assert.match(payload.bio_description, /font-weight: 700/);
    assert.match(payload.bio_description, /font-style: italic/);
    assert.match(payload.bio_description, /color: rgb\(229, 57, 53\)/);
    assert.match(payload.bio_description, /<br>/);
    assert.match(payload.bio_description, /<span style="color: #1A4B8E">Linea con color heredado<\/span>/);
    assert.match(payload.bio_description, /<a href="https:\/\/example\.com\/profile" target="_blank" rel="noopener noreferrer">portfolio<\/a>/);
    assert.doesNotMatch(payload.bio_description, /onclick|onerror|javascript:|<script|<img|position:/i);
    assert.ok(payload.bio_description.length <= 12000);
});

test('studio artist city is derived from the registered studio location', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'resident@example.com',
        artistic_name: 'Resident Ink',
        full_name: 'resident ink',
        work_type: 'studio',
        studio_name: 'Claroscuro',
        city: 'Rosario, Santa Fe, Argentina',
        address: {
            city: 'Buenos Aires',
            locality: 'Palermo',
            country: 'Argentina',
            formatted_address: 'Honduras 5000, Palermo, Buenos Aires, Argentina'
        }
    }, {
        studioId: '33333333-3333-4333-8333-333333333333',
        estudiosValue: 'CLAROSCURO',
        now: '2026-06-01T00:00:00.000Z'
    });

    assert.equal(payload.city, 'Buenos Aires');
    assert.equal(payload.country, 'Argentina');
    assert.equal(payload.ubicacion, 'Buenos Aires');
});

test('studio registration location payload keeps the complete selected sede address', () => {
    const payload = registration.buildStudioLocationPayload({
        studioId: '33333333-3333-4333-8333-333333333333',
        label: 'Sede Palermo',
        isPrimary: true,
        sortOrder: 0,
        address: {
            country: 'Argentina',
            country_code: 'AR',
            state_province: 'CABA',
            city: 'Buenos Aires',
            locality: 'Palermo',
            street: 'Honduras',
            street_number: '5000',
            unit: 'PB',
            postal_code: 'C1414',
            formatted_address: 'Honduras 5000, Palermo, Buenos Aires, Argentina',
            latitude: -34.5889,
            longitude: -58.4306,
            google_place_id: 'place-palermo'
        },
        now: '2026-05-31T00:00:00.000Z'
    });

    assert.deepEqual(payload, {
        studio_id: '33333333-3333-4333-8333-333333333333',
        label: 'Sede Palermo',
        is_primary: true,
        is_active: true,
        sort_order: 0,
        country: 'Argentina',
        country_code: 'AR',
        state_province: 'CABA',
        city: 'Buenos Aires',
        locality: 'Palermo',
        street: 'Honduras',
        street_number: '5000',
        unit: 'PB',
        postal_code: 'C1414',
        formatted_address: 'Honduras 5000, Palermo, Buenos Aires, Argentina',
        latitude: -34.5889,
        longitude: -58.4306,
        google_place_id: 'place-palermo',
        geocoded_at: '2026-05-31T00:00:00.000Z'
    });
});

test('studio registration membership payload links artist, studio and selected location', () => {
    const payload = registration.buildStudioMembershipPayload({
        artistUserId: '22222222-2222-4222-8222-222222222222',
        studioId: '33333333-3333-4333-8333-333333333333',
        locationId: '44444444-4444-4444-8444-444444444444',
        workType: 'both',
        now: '2026-05-31T00:00:00.000Z'
    });

    assert.deepEqual(payload, {
        artist_user_id: '22222222-2222-4222-8222-222222222222',
        studio_id: '33333333-3333-4333-8333-333333333333',
        location_id: '44444444-4444-4444-8444-444444444444',
        role: 'resident',
        status: 'active',
        started_at: '2026-05-31T00:00:00.000Z'
    });
});
