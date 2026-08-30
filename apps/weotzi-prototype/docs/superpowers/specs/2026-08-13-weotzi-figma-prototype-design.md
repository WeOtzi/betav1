# WeÖtzi Figma Prototype — Design Specification

## Status and source of truth

- Status: approved for autonomous implementation by the user on 2026-08-13.
- Source design: Figma file `oRrqTTEZIQm6SCgRn9QUz8`, page `3981:5804` (`✨ Prototype`).
- Primary reference nodes: Landing `3981:6881`, Onboarding `3981:7644`, Inspiración `3981:5862`, Negocio `3981:5841`, Perfil público `3981:7153`, Comprar Flash `3981:7844`, Diseño personalizado `3981:8159`.
- The user explicitly delegated all implementation decisions and requested no approval pauses. The Figma file is therefore the accepted concept.

## Product outcome

Build a mobile-first local web app that demonstrates the most coherent end-to-end WeÖtzi journey: a visitor joins, verifies an email, completes a compact artist setup, browses inspiration and an artist profile, requests either a Flash or custom tattoo, sees that request in the artist/business view, and exchanges persisted messages.

The prototype is functional rather than a collection of static screenshots. Inputs, selections, favorites, bookings and messages update real local state and persist in SQLite.

## Scope decision

The Figma page contains 363 top-level elements, 704 prototype connections and ten flow starting points. Implementing every historical variant would reproduce duplicated and orphaned iterations rather than a coherent product. This build implements 24 meaningful screens/states using reusable components:

1. Landing / waitlist.
2. Email verification.
3. Three onboarding slides.
4. Objectives setup.
5. Personal profile setup.
6. Location setup.
7. Style setup.
8. Portfolio/profile-photo setup.
9. Inspiration home, expanded header.
10. Inspiration home, compact-on-scroll header.
11. Business home.
12. Public profile — Trabajos.
13. Public profile — Tienda.
14. Public profile — Sobre mí.
15. Public profile — Reseñas.
16. Inbox.
17. Chat.
18. Flash booking — contact.
19. Flash booking — placement.
20. Flash booking — medical conditions.
21. Flash booking — availability/review.
22. Custom booking — contact/placement/medical.
23. Custom booking — references/review.
24. Persisted success state.

The implementation intentionally omits duplicated legacy experiments, detailed payment-provider screens, map-provider integration, authentication security, real uploads and real-time transport. Those are product integrations, not necessary to prove the local Figma flow.

## Architecture

Create an autonomous package at `apps/weotzi-prototype/`. Do not modify or import runtime code from the root monolith (`server.js`, `public/`, `supabase/`, root `package.json` or root lockfile).

- Frontend: React 19, Vite, TypeScript, React Router, Framer Motion, vanilla CSS with custom properties.
- Server: Express in TypeScript, run by `tsx`.
- Data: `better-sqlite3`, stored at `data/weotzi-prototype.sqlite`.
- Contracts: Zod schemas shared by client and server.
- Tests: Vitest, React Testing Library and Supertest. Browser verification uses the in-app browser first and Playwright CLI only if needed.
- Development ports: frontend `5174`, API `4546`, both strict and configurable by environment.
- Production: the Express process serves `dist/` and `/api` from one origin.

SQLite is selected because this is a local single-process prototype: no external service, credentials or migrations server is required. WAL, foreign keys and a busy timeout are enabled. PostgreSQL would only become preferable for multiple server replicas or production concurrency.

## Visual system

### Canvas and layout

- Design viewport: `393 × 852 px`.
- Main horizontal gutter: `24 px`.
- Main content width: `345–346 px`.
- Gallery columns: `167 px + 12 px + 167 px`.
- Status bar: `47 px`; app header: `50 px` below it; bottom navigation: `72 px`; wizard footer: `88 px`.
- On desktop, the app is shown in a centered `393 × 852` device surface. On small screens it becomes full viewport.
- Content scrolls beneath fixed headers/footers. The landing, gallery and profile must not be artificially clipped.

### Color tokens

```css
--ink-950: #111112;
--ink-900: #292d32;
--ink-600: #72757a;
--ink-400: #a7a7a7;
--line-300: #c2c4c6;
--line-100: #e8e8e9;
--paper-50: #f9f9f9;
--paper: #ffffff;
--mist: #f1f4f4;
--success: #42be65;
--warm-card: #f2ebdf;
--cool-card: #e1f2f4;
```

### Typography

Use a bundled Inter variable font as the distributable fallback, with `"SF Pro Display"` and system UI first so Apple devices render the intended family when available. Preserve these metrics:

- Landing hero: `48/54`, 700.
- Large statement: `24/30`, 700.
- App brand: `20/35`, 700.
- Headings, tabs and primary CTA: `17/23`, 700.
- Body and form labels: `15/21`, 400–500.
- Navigation and metadata: `13/18`, 400–500.

### Geometry and depth

- Inputs and gallery cards: `6 px` radius.
- Large CTAs and selected cards: `12 px` radius.
- Availability chip: `29 px` radius.
- Avatars and progress dots: circular.
- No decorative box shadows. Depth comes from photo gradients, white fades and background blur.
- Bottom navigation uses `backdrop-filter: blur(16px)` over white.

### Exact visible structure

- Landing retains the Safari/status mock, waitlist form, 283 × 275 horizontal image cards and the benefits list below the first viewport.
- Onboarding uses the exact exported first hero image and a carefully positioned crop, not a generic centered `object-fit` crop.
- Inspiration preserves the uneven two-column masonry heights and lower image gradients.
- Public profile preserves the 100 px avatar, availability chip, four tabs, masonry gallery, bottom fade and fixed CTA.
- Booking forms preserve 24 px gutters, 32 px field rhythm, binary selectors, three-step progress and circular arrow buttons.

## Motion and microinteractions

Figma motion metadata could not be retrieved after the Starter-plan MCP limit was reached. The following values are deliberate implementation inferences, not claimed Figma values:

- Route push/fade: `280 ms`, cubic-bezier `(0.22, 1, 0.36, 1)`.
- Onboarding image/content change: `420 ms` crossfade with 10 px vertical settle.
- Sheet/menu: `220 ms` opacity + translate.
- Inspiration header compaction: `300 ms`; avatar changes from `67 px` to `34 px`, gallery origin shifts by `91 px`.
- Card press: scale to `0.985`; hover on pointer devices: translate `-2 px`.
- Booking success: spinner then check reveal, total `700 ms`.
- All motion is disabled or shortened under `prefers-reduced-motion: reduce`.

## Functional flow

### Visitor and onboarding

1. Landing validates an email and stores it in `waitlist_entries`.
2. Verification accepts demo code `241041`, while displaying validation errors for incomplete codes.
3. Three onboarding slides advance with directional motion.
4. Setup saves objectives, studio/profile data, city, styles and avatar choice as a draft after each step.
5. Completion marks the local demo user as onboarded and opens Inspiration.

### Discovery and profile

1. Inspiration displays the exact extracted tattoo imagery and a fixed three-item navigation.
2. Scrolling compacts the greeting header.
3. Cards can be favorited and open the public profile.
4. Profile tabs swap code-native content. “Quiero un diseño personalizado” launches the custom wizard.

### Booking

1. Flash and custom flows share a typed wizard shell and validation.
2. Contact, placement, medical, availability and reference data are preserved between steps.
3. Review submission creates a SQLite booking with status `requested`.
4. The success screen links to the chat and to the app home.
5. Business home immediately reflects the persisted request.

### Messaging

1. Inbox shows seeded conversations and the new booking conversation.
2. Chat sends a message through the API and renders it immediately after persistence.
3. Refreshing the browser retains messages.

## Data model

```sql
CREATE TABLE waitlist_entries (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('artist','client')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  objectives_json TEXT NOT NULL DEFAULT '[]',
  styles_json TEXT NOT NULL DEFAULT '[]',
  avatar_asset TEXT NOT NULL DEFAULT '',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE portfolio_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  image_asset TEXT NOT NULL,
  height INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('work','flash','merch'))
);

CREATE TABLE favorites (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  portfolio_item_id TEXT NOT NULL REFERENCES portfolio_items(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, portfolio_item_id)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('flash','custom')),
  status TEXT NOT NULL CHECK (status IN ('requested','confirmed','cancelled','completed')),
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  first_tattoo INTEGER NOT NULL,
  placement TEXT NOT NULL,
  medical_notes TEXT NOT NULL,
  preferred_date TEXT NOT NULL,
  preferred_time TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  participant_name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sender TEXT NOT NULL CHECK (sender IN ('user','artist')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## API contract

- `GET /api/health` → `{ ok: true, database: 'sqlite' }`.
- `GET /api/bootstrap` → profile, portfolio, favorites, bookings and conversations.
- `POST /api/waitlist` validates and upserts email.
- `POST /api/verify` validates email plus demo code.
- `PATCH /api/profile` validates and persists setup fields.
- `POST /api/favorites/:portfolioItemId/toggle` returns `{ favorite: boolean }`.
- `POST /api/bookings` validates and transactionally creates booking + conversation + first artist message.
- `GET /api/conversations/:id/messages` returns ordered messages.
- `POST /api/conversations/:id/messages` rejects blank text and persists a user message.
- `POST /api/reset` recreates deterministic demo state.

## Error handling and accessibility

- Validation errors are rendered adjacent to fields and announced through an `aria-live` region.
- API errors preserve user input and offer retry.
- Buttons expose disabled state and retain at least 44 × 44 px hit targets.
- Navigation uses semantic labels and current state.
- Image alt text describes tattoos or marks decorative imagery empty.
- Focus is visible and moved to the screen heading after route changes.
- The app remains usable at 320 px width and at 200% zoom.

## Verification acceptance criteria

1. `npm run check` passes inside the autonomous package.
2. SQLite data survives a server restart.
3. The happy path landing → onboarding → inspiration → profile → custom booking → success → chat works in a real browser.
4. Flash booking also persists.
5. Desktop and `393 × 852` screenshots have no overflow, clipped primary controls or default browser typography.
6. The rendered references are compared with the saved Figma images for copy, layout, type scale, palette, image crop, spacing, icon treatment and fixed navigation.
7. No root monolith file is modified by the implementation.

## Known limitation requiring future intervention

The Figma Starter-plan tool-call ceiling prevented retrieval of the complete motion metadata and every historical screen variant. Exact trigger/easing values and any behavior hidden only in those variants require a refreshed Figma quota or a higher plan. The local app remains fully usable with the documented motion interpretation.
