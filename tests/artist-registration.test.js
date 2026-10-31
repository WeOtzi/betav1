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

test('studio registration membership payload is an artist request the studio approves', () => {
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
        status: 'requested',
        initiated_by: 'artist',
        invited_at: '2026-05-31T00:00:00.000Z'
    });
    assert.equal(Object.hasOwn(payload, 'started_at'), false, 'a pending request has not started yet');
});

test('legacy membership payload (migration not applied) keeps the historic active shape without initiated_by', () => {
    const payload = registration.buildStudioMembershipPayload({
        artistUserId: '22222222-2222-4222-8222-222222222222',
        studioId: '33333333-3333-4333-8333-333333333333',
        locationId: null,
        workType: 'studio',
        legacy: true,
        now: '2026-05-31T00:00:00.000Z'
    });

    assert.deepEqual(payload, {
        artist_user_id: '22222222-2222-4222-8222-222222222222',
        studio_id: '33333333-3333-4333-8333-333333333333',
        location_id: null,
        role: 'resident',
        status: 'active',
        started_at: '2026-05-31T00:00:00.000Z'
    });
});

test('independent artists never get a studio membership payload', () => {
    assert.equal(registration.buildStudioMembershipPayload({
        artistUserId: '22222222-2222-4222-8222-222222222222',
        studioId: '33333333-3333-4333-8333-333333333333',
        workType: 'independent'
    }), null);
});

test('membership request details keep only http(s) portfolios and the artist styles', () => {
    const details = registration.buildStudioMembershipRequestDetails({
        membershipId: '55555555-5555-4555-8555-555555555555',
        formData: {
            portfolio_url: 'javascript:alert(1)',
            styles: ['Blackwork', '', '  Fineline  ']
        }
    });

    assert.equal(details.membership_id, '55555555-5555-4555-8555-555555555555');
    assert.equal(details.portfolio_url, null);
    assert.deepEqual(details.styles, ['Blackwork', 'Fineline']);
    assert.equal(details.proposed_start_date, null);
    assert.ok(details.message.length > 0 && details.message.length <= 1000);

    const withPortfolio = registration.buildStudioMembershipRequestDetails({
        membershipId: '55555555-5555-4555-8555-555555555555',
        formData: { portfolio_url: 'https://example.com/me' }
    });
    assert.equal(withPortfolio.portfolio_url, 'https://example.com/me');
    assert.equal(registration.buildStudioMembershipRequestDetails({ formData: {} }), null);
});

test('submitted registration never writes artists_db.studio_id; the draft keeps it to resume the wizard', () => {
    const formData = {
        email: 'resident@example.com',
        artistic_name: 'Resident Ink',
        work_type: 'studio',
        studio_name: 'Claroscuro',
        studio_id: '33333333-3333-4333-8333-333333333333'
    };

    const finalPayload = registration.buildArtistRegistrationPayload(formData, {
        draftId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        studioId: '33333333-3333-4333-8333-333333333333',
        estudiosValue: null,
        status: registration.REGISTRATION_STATUS_PENDING_VALIDATION,
        submitted: true,
        now: '2026-10-30T00:00:00.000Z'
    });
    assert.equal(finalPayload.studio_id, null);
    assert.equal(finalPayload.estudios, null, 'the studio label waits for the studio approval');

    const draftPayload = registration.buildArtistRegistrationPayload(formData, {
        draftId: '11111111-1111-4111-8111-111111111111',
        status: registration.REGISTRATION_STATUS_INCOMPLETE,
        now: '2026-10-30T00:00:00.000Z'
    });
    assert.equal(draftPayload.studio_id, '33333333-3333-4333-8333-333333333333');
});

test('studio artists stay on the map with the chosen sede coordinates while the request is pending', () => {
    const payload = registration.buildArtistRegistrationPayload({
        email: 'resident@example.com',
        artistic_name: 'Resident Ink',
        work_type: 'studio',
        studio_name: 'Claroscuro',
        address: { city: 'Rosario', country: 'Argentina' }
    }, {
        draftId: '11111111-1111-4111-8111-111111111111',
        submitted: true,
        estudiosValue: null,
        studioLocation: {
            city: 'Buenos Aires',
            locality: 'Palermo',
            country: 'Argentina',
            country_code: 'AR',
            formatted_address: 'Honduras 5000, Palermo, Buenos Aires, Argentina',
            latitude: -34.5889,
            longitude: -58.4306,
            google_place_id: 'place-palermo'
        },
        now: '2026-10-30T00:00:00.000Z'
    });

    assert.equal(payload.city, 'Buenos Aires');
    assert.equal(payload.latitude, -34.5889);
    assert.equal(payload.longitude, -58.4306);
    assert.equal(payload.formatted_address, 'Honduras 5000, Palermo, Buenos Aires, Argentina');
    assert.equal(payload.google_place_id, 'place-palermo');
    assert.equal(payload.geocoded_at, '2026-10-30T00:00:00.000Z');
});

test('location patch uses the studio address the artist typed when no sede was chosen', () => {
    const patch = registration.buildLocationPatch({
        work_type: 'both',
        address: {
            city: 'Córdoba',
            country: 'Argentina',
            formatted_address: 'San Martín 100, Córdoba, Argentina',
            latitude: -31.4167,
            longitude: -64.1833
        }
    }, { workType: 'both', now: '2026-10-30T00:00:00.000Z' });

    assert.equal(patch.city, 'Córdoba');
    assert.equal(patch.latitude, -31.4167);
    assert.equal(patch.longitude, -64.1833);

    const unknown = registration.buildLocationPatch({
        address: { city: 'Mendoza', country: 'Argentina', latitude: 1, longitude: 2 }
    }, { workType: '' });
    assert.equal(unknown.city, 'Mendoza');
    assert.equal(unknown.latitude, null, 'without a work type only city/country are stored');
});

// ---- Servidor: /api/register/artist-finalize + asociaciones de estudio ----
const fs = require('node:fs');
const path = require('node:path');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\r\n').join('\n');

function serverFunction(name) {
    const start = serverSource.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in server.js`);
    const end = serverSource.indexOf('\nasync function ', start + 10);
    return serverSource.slice(start, end === -1 ? undefined : end);
}

test('registration membership is a plain request insert (no on_conflict) with legacy fallback', () => {
    const membership = serverFunction('persistRegistrationMembership');
    assert.doesNotMatch(serverSource, /studio_artist_memberships\?on_conflict/);
    assert.match(membership, /StudiosRepo\.findOpenMembership\(studioId, artistUserId\)/);
    assert.match(membership, /StudiosRepo\.insertMembership\(requested\)/);
    assert.match(membership, /code === '23505'/, 'a concurrent duplicate counts as success');
    assert.match(membership, /legacy: true/);
    assert.match(membership, /insertMembershipRequestDetails/);
    assert.match(serverSource, /LEGACY_MEMBERSHIP_FALLBACK_CODES = new Set\(\['23514', 'PGRST204', '42703'\]\)/);
});

test('membership errors never roll back the registration', () => {
    const associations = serverFunction('persistRegistrationStudioAssociations');
    assert.match(associations, /try \{\s*membershipResult = await persistRegistrationMembership/);
    assert.match(associations, /registration kept/);
    assert.match(associations, /studio_id: null,\s*studio_name: tattooLocationLabel,/, 'tattoo location never links the studio id');
    assert.match(associations, /const tattooLocationLabel = studioNameForStorage\(/, 'studio_name is NOT NULL: keeps the name as text');
    assert.match(associations, /if \(tattooLocationLabel\) \{\s*try \{/, 'empty labels skip the write and errors never roll back');
    assert.match(associations, /tattoo location not saved \(registration kept\)/);
});

test('registration never creates or edits sedes of a studio that has an owner', () => {
    const ensure = serverFunction('ensureStudioLocationForRegistration');
    assert.match(ensure, /const studioHasOwner = Boolean\(studio\?\.user_id\)/);
    assert.match(ensure, /if \(studioHasOwner\) return \{ locationId: null \};/);
    assert.match(ensure, /!studioHasOwner && !studio\?\.primary_location_id/);
    const createIndex = ensure.indexOf('createStudioLocation(');
    const guardIndex = ensure.indexOf('if (studioHasOwner) return { locationId: null };');
    assert.ok(guardIndex > -1 && guardIndex < createIndex, 'owner guard runs before any sede is created');
});

test('artist-finalize leaves the studio label empty while pending and reports membership_pending', () => {
    const start = serverSource.indexOf("app.post('/api/register/artist-finalize'");
    const route = serverSource.slice(start, serverSource.indexOf('\n});', start));
    assert.match(route, /estudiosValue: joinsStudio \? null : estudiosValue/);
    assert.match(route, /studioLocation: selectedStudioLocation/);
    assert.match(route, /membership_pending: Boolean\(studioLink\.membershipPending\)/);
});
