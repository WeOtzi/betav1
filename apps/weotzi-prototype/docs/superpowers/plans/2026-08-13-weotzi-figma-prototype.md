# WeÖtzi Figma Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a faithful, locally runnable and persisted mobile web prototype based on the accepted WeÖtzi Figma flow.

**Architecture:** A self-contained React/Vite client and Express/SQLite server live under `apps/weotzi-prototype`. Shared Zod contracts define all network boundaries; the root monolith is never imported or modified.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Framer Motion, Express, Zod, better-sqlite3, Vitest, React Testing Library, Supertest, Playwright CLI.

## Global Constraints

- Work only inside `C:\dev\weotzi-unified\apps\weotzi-prototype`.
- Preserve the accepted `393 × 852` Figma composition and exact visible copy.
- Use downloaded Figma assets; do not hotlink temporary URLs or redraw available icons.
- Store mutable state in SQLite, never Supabase or root app data.
- Respect `prefers-reduced-motion`.
- Do not stage, commit or alter unrelated dirty-worktree files.

---

### Task 1: Autonomous package, contracts and SQLite API

**Files:**
- Create: `package.json`, `package-lock.json`, `.gitignore`, `.nvmrc`, `.env.example`, `tsconfig*.json`, `vite.config.ts`
- Create: `shared/contracts.ts`
- Create: `server/db.ts`, `server/seed.ts`, `server/app.ts`, `server/index.ts`
- Test: `tests/api.test.ts`

**Interfaces:**
- Produces `createDatabase(path: string): Database.Database`.
- Produces `createApp(db: Database.Database): Express`.
- Produces Zod types `ProfilePatch`, `BookingInput` and `MessageInput`.

- [ ] **Step 1: Write API tests before server code**

```ts
it('creates a booking and a linked conversation transactionally', async () => {
  const response = await request(app).post('/api/bookings').send(validBooking);
  expect(response.status).toBe(201);
  expect(response.body.booking.status).toBe('requested');
  expect(response.body.conversation.bookingId).toBe(response.body.booking.id);
});

it('rejects a blank message without writing a row', async () => {
  const response = await request(app)
    .post('/api/conversations/demo/messages')
    .send({ body: '   ' });
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run the targeted suite and verify expected RED failures**

Run: `npm test -- tests/api.test.ts`

Expected: imports or routes are missing; no test may pass accidentally.

- [ ] **Step 3: Implement schema, deterministic seed and API routes**

Use transactions for booking + conversation creation, prepared statements for all SQL, and Zod `safeParse` for request bodies.

- [ ] **Step 4: Run API tests to GREEN**

Run: `npm test -- tests/api.test.ts`

Expected: waitlist, profile, favorites, booking and messaging behaviors pass against a temporary SQLite file.

### Task 2: Design system, assets and mobile shell

**Files:**
- Create: `public/assets/figma/*`, `public/assets/fonts/*`
- Create: `src/styles/tokens.css`, `src/styles/global.css`
- Create: `src/components/DeviceShell.tsx`, `StatusBar.tsx`, `AppHeader.tsx`, `BottomNav.tsx`, `WizardFooter.tsx`, `FormField.tsx`, `PhotoCard.tsx`
- Test: `tests/components.test.tsx`

**Interfaces:**
- Produces `DeviceShell`, `BottomNav`, `WizardFooter`, `FormField` and `PhotoCard`.
- Components accept semantic props and never own API state.

- [ ] **Step 1: Write failing component behavior tests**

```tsx
it('marks only the current bottom destination as active', () => {
  render(<MemoryRouter initialEntries={['/app/business']}><BottomNav /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Negocio' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
});

it('blocks wizard progress while required fields are invalid', () => {
  render(<WizardFooter step={0} steps={3} canContinue={false} onBack={() => {}} onNext={() => {}} />);
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
});
```

- [ ] **Step 2: Verify RED, then implement primitives and exact tokens**

Run: `npm test -- tests/components.test.tsx`

- [ ] **Step 3: Copy exact exported Figma bytes into local assets**

Copy only files used by the implementation. Name them by semantic role and retain a source manifest with the Figma node/asset UUID.

- [ ] **Step 4: Run component tests and typecheck to GREEN**

Run: `npm test -- tests/components.test.tsx && npm run typecheck`

### Task 3: Landing, verification and onboarding/setup

**Files:**
- Create: `src/features/entry/EntryFlow.tsx`, `LandingScreen.tsx`, `VerifyScreen.tsx`
- Create: `src/features/onboarding/OnboardingScreen.tsx`, `SetupWizard.tsx`, `setup-state.ts`
- Test: `tests/entry-flow.test.tsx`, `tests/setup-state.test.ts`

**Interfaces:**
- Consumes `POST /api/waitlist`, `POST /api/verify`, `PATCH /api/profile`.
- Produces a completed profile and routes to `/app/inspiration`.

- [ ] **Step 1: Write failing flow and reducer tests**

```ts
it('preserves setup answers while moving backward and forward', () => {
  const withCity = reduceSetup(initialSetup, { type: 'set-city', city: 'CDMX' });
  const moved = reduceSetup(withCity, { type: 'go-to', step: 1 });
  expect(moved.city).toBe('CDMX');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/entry-flow.test.tsx tests/setup-state.test.ts`

- [ ] **Step 3: Implement exact landing and onboarding compositions**

Render the Safari mock on Landing, exact hero/image crops, waitlist feedback, code inputs, three onboarding states and compact setup forms.

- [ ] **Step 4: Run tests and verify both desktop and 393 × 852 manually**

Run: `npm test -- tests/entry-flow.test.tsx tests/setup-state.test.ts && npm run typecheck`

### Task 4: Discovery, business, profile and messaging surfaces

**Files:**
- Create: `src/features/discovery/InspirationScreen.tsx`
- Create: `src/features/business/BusinessScreen.tsx`
- Create: `src/features/profile/PublicProfileScreen.tsx`
- Create: `src/features/messages/InboxScreen.tsx`, `ChatScreen.tsx`
- Test: `tests/app-surfaces.test.tsx`

**Interfaces:**
- Consumes `GET /api/bootstrap`, favorite toggle and message endpoints.
- Public-profile CTA routes to `/book/custom`.

- [ ] **Step 1: Write failing tests for profile tabs, favorite persistence and message submission**

```tsx
it('opens the custom booking flow from the fixed public-profile CTA', async () => {
  renderApp('/app/profile/artist-demo');
  await user.click(screen.getByRole('link', { name: 'Quiero un diseño personalizado' }));
  expect(screen.getByRole('heading', { name: 'Diseño personalizado' })).toBeVisible();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/app-surfaces.test.tsx`

- [ ] **Step 3: Implement masonry, compact header, four profile tabs, business lists, inbox and chat**

All controls must update UI state; no inert navigation, favorite or messaging button is allowed.

- [ ] **Step 4: Run surface tests to GREEN**

Run: `npm test -- tests/app-surfaces.test.tsx && npm run typecheck`

### Task 5: Flash and custom booking wizards

**Files:**
- Create: `src/features/bookings/BookingWizard.tsx`, `booking-state.ts`, `BookingSuccess.tsx`
- Test: `tests/booking-state.test.ts`, `tests/booking-flow.test.tsx`

**Interfaces:**
- `createInitialBooking(kind: 'flash' | 'custom'): BookingDraft`.
- `validateBookingStep(draft, step): Record<string, string>`.
- Consumes `POST /api/bookings`; returns booking and conversation IDs.

- [ ] **Step 1: Write failing validation and flow tests**

```ts
it('requires references only for a custom booking', () => {
  expect(validateBookingStep(customWithoutReferences, 3)).toEqual({ references: 'Agrega al menos una referencia' });
  expect(validateBookingStep(flashWithoutReferences, 3)).toEqual({});
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/booking-state.test.ts tests/booking-flow.test.tsx`

- [ ] **Step 3: Implement shared wizard, two variants, review and animated success**

Preserve the Figma form rhythm and progress controls. Persist only after explicit review submission.

- [ ] **Step 4: Run booking tests to GREEN**

Run: `npm test -- tests/booking-state.test.ts tests/booking-flow.test.tsx && npm run typecheck`

### Task 6: Integration, browser fidelity and delivery documentation

**Files:**
- Create: `src/App.tsx`, `src/main.tsx`, `README.md`, `FIGMA-FIDELITY.md`
- Create: `output/playwright/*` only during QA; remove temporary artifacts before handoff.

**Interfaces:**
- Composes all routes and provides one local start command.
- Documents Figma reference paths, intentional deviations and verification results.

- [ ] **Step 1: Run the complete automated gate**

Run: `npm run check`

Expected: lint, typecheck, Vitest and Vite build all exit zero.

- [ ] **Step 2: Start the production-equivalent app and verify health**

Run: `npm run start`

Verify: `GET http://127.0.0.1:4546/api/health` returns status 200 and SQLite identity.

- [ ] **Step 3: Use the browser for the core workflow**

Verify landing → verification → onboarding → inspiration → public profile → custom booking → success → chat, then refresh and confirm persisted state.

- [ ] **Step 4: Capture desktop and native mobile screenshots and inspect both references with `view_image`**

Compare copy, layout, typography, palette, crops, spacing, icons, fixed navigation and motion. Record at least five concrete comparison points in `FIGMA-FIDELITY.md`.

- [ ] **Step 5: Run a separate read-only regression check for the root app if practical**

Run: `node --test "tests/*.test.js"` from the repository root. Do not modify root test fixtures or data.

- [ ] **Step 6: Re-run `npm run check` after all visual fixes**

Expected: zero failures. Only then report completion.
