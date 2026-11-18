# Sprints: identidad, suplantación y plagio (fases 1 y 2)

Plan de producto: [2026-11-18-kyc-antisuplantacion.md](2026-11-18-kyc-antisuplantacion.md).
Mapas del Sprint 0 (lectura del código): resumidos en este documento; los detalles
con file:line quedaron en el scratchpad de la sesión.

Entrega: **2.7.0**, un solo PR desde `feature/kyc-antisuplantacion`.

## Scrum

| Sprint | Meta | Equipos (agentes en paralelo) | Review |
|---|---|---|---|
| 0 | Mapa del código y contratos entre equipos | 6 exploradores, solo lectura | Contratos de este documento |
| 1 | Fase 1: denuncias abiertas, Términos, sanciones, insignia con Instagram | T1 Denuncias · T2 Términos y reingreso · T3 Sanciones · T4 Insignia e Instagram · T5 Contenido legal y `/seguridad` | Revisión cruzada por equipo + suite + migraciones validadas con rollback |
| 2 | Fase 2: huellas de imágenes, alertas a soporte, buscador `/buscar-diseno` | T6 Motor de huellas y job · T7 Buscador y alertas en soporte | Ídem |
| 3 | Documentación y marketing | Soporte · Artistas · Estudios · Tutoriales y guiones | Revisión de tono (tuteo, español neutro) y exactitud contra el código |

**Definición de terminado (todas las historias):**
- tests nuevos y existentes de su área en verde (`node --test tests/<archivo>`);
- migración nueva con su reversa en `supabase/rollbacks/`, validada con `execute_sql` dentro de `begin … rollback` en el proyecto vivo (nunca aplicada);
- textos en español neutro con tuteo; «anticipo», nunca «seña»;
- acceso a datos por la capa unificada (`lib/postgrest.js` + `lib/repos/*` en el servidor; `window.WeotziData` en el navegador);
- nada de secretos en el repo; nada de datos personales en logs.

## Reglas de trabajo en paralelo

- Cada archivo tiene **un solo equipo dueño** (tabla de abajo). Un equipo no edita archivos de otro; si necesita algo de otro equipo, usa el contrato.
- `server.js`: lo edita **solo T2** (flujos de registro). Las líneas `require('./lib/routes/…').register(app)` de las rutas nuevas y la guarda de la creación legada de cotizaciones las agrega la integración al cierre del sprint.
- `lib/email-render/fixtures.js`: dueño T3; T1 puede **agregar** entradas (solo añadir, releer antes de editar).
- Nada de `git commit`, `git stash`, `git checkout` ni `npm install`: el commit lo hace la integración.

## Propiedad de archivos (Sprint 1)

**T1 Denuncias**
- `lib/denuncias.js`, `lib/routes/denuncias.js`, `lib/repos/denuncias.js`, `services/email-events/denuncias.js`
- `public/shared/js/wo-report.js`, `public/shared/css/wo-report.css`
- `public/shared/js/artist-profile.js`, `public/shared/css/artist-profile-r2.css`, `public/artist/profile/index.html`
- `public/shared/js/studio-profile.js` (+ su CSS), `public/studio/profile/index.html`
- `public/shared/js/support-dashboard-reports.js`, `public/shared/css/support-dashboard-reports.css`, `public/shared/js/data/support-reports-repo.js`
- `public/shared/js/quotation-detail-info.js`, `public/my-quotations/detail/index.html` (solo `?v=`), `public/shared/js/client-panel-ui.js` (comentario)
- `supabase/migrations/20261118110000_denuncias_abiertas.sql` (+ reversa)
- tests: `tests/r2-denuncias.test.js`, `tests/r2-denuncias-front.test.js`, `tests/r2-perfil.test.js`, nuevo `tests/kyc-denuncias.test.js`

**T2 Términos y reingreso**
- `lib/terms-acceptance.js`, nuevos `lib/terms-gate.js`, `lib/repos/terminos.js`, `lib/routes/terminos.js`
- nuevo `public/shared/js/wo-terms-gate.js` (+ CSS si hace falta) y su carga en las páginas con sesión de artista, cliente y estudio
- `public/shared/js/artist-auth.js`, `client-auth.js`, `studio-auth.js`, `studio-register.js`, `lib/registration-catalogs.js`
- `server.js` (registro de artista: draft, finalize, check-uniqueness), `services/account-modes.js`, `lib/acceso.js`, `lib/repos/acceso.js`, `lib/routes/acceso.js`
- `supabase/migrations/20261118120000_terminos_reaceptacion.sql` (+ reversa)
- tests: `tests/acceso.test.js`, `tests/studio-register-revision.test.js`, nuevo `tests/terms-gate.test.js`

**T3 Sanciones**
- nuevos `lib/ban-identifiers.js`, `lib/sanciones.js`, `lib/sanciones-service.js`, `lib/repos/sanciones.js`, `lib/repos/banned-identifiers.js`, `lib/auth/supabase-admin.js`, `lib/artist-visibility.js`, `lib/routes/sanciones.js`
- aplicar `lib/artist-visibility.js` en `lib/routes/cot-form.js`, `lib/repos/cot-form.js`, `lib/repos/flash.js`, `lib/flash.js`, `lib/repos/booking.js`
- `lib/negociacion.js` (etiqueta de cierre por soporte)
- `services/email-events/sanciones.js`, `lib/email-render/fixtures.js`, `lib/push-dispatch.js`
- nuevos `public/shared/js/data/support-sanctions-repo.js`, `public/shared/js/support-dashboard-sanctions.js`, `public/shared/css/support-dashboard-sanctions.css`
- `public/support/dashboard/index.html` (pestaña nueva y todos los `?v=` de esa página, incluido el de T1)
- nueva página pública `public/apelacion/index.html` (+ `public/shared/js/apelacion.js`)
- `.env.example`, `deployments/DEPLOY.md`
- `supabase/migrations/20261118130000_account_sanctions.sql` (+ reversa)
- tests nuevos: `tests/sanciones.test.js`, `tests/sanciones-front.test.js`, `tests/ban-identifiers.test.js`

**T4 Insignia e Instagram**
- `supabase/migrations/20261118100000_insignia_instagram.sql` (+ reversa)
- nuevo `public/shared/js/verified-badge.js`
- `lib/verificacion-artista.js`, `lib/repos/artist-verification.js`, `lib/routes/verif-estudio.js`, `services/instagram-verification.js`, `services/studio-verification.js`
- `lib/artist-matching.js`, `lib/cot-detalle.js`, `lib/repos/cot-detalle.js`, `lib/repos/artists-public.js`
- `public/shared/js/marketplace.js`, `marketplace-core.js`, `data/marketplace-repo.js`, `explore-map.js`, `data/studios-repo.js`, `studio-spots-directory.js`, `artist-account.js`, `backoffice-studio-verifications.js`, `support-dashboard-verification.js`, `quote-share-model.js`
- las etiquetas `<script>` de `verified-badge.js` en las páginas que usan esos archivos (excepto perfil de artista y de estudio: T1)
- tests: `tests/verif-artista.test.js`, `tests/verif-estudio.test.js`, `tests/instagram-verification-migration.test.js`, nuevo `tests/verified-badge.test.js`

**T5 Contenido legal y página de seguridad**
- `public/legal/terms/index.html`, `public/legal/privacy/index.html`
- nueva `public/seguridad/index.html` (+ `public/shared/css/seguridad.css`)
- test nuevo `tests/seguridad-page.test.js`

## Contratos entre equipos

### Versión legal
`TERMS_VERSION = '2026-11-18'` (Términos v1.1 y Privacidad v1.2, ambos del 18 nov 2026). La usan T2 (código y migración) y T5 (textos).

### Columnas y tablas nuevas (migración de T3)
- `artists_db.sanction_state text not null default 'none'` con CHECK `('none','suspended','banned')`, `artists_db.sanction_id uuid null`.
- `studios.sanction_state` (mismo CHECK), `studios.sanction_id`.
- `quotations_db.support_closed_reason text null` (CHECK de largo ≤ 300).
- `account_sanctions(id, user_id, kind ('warning'|'suspension'|'ban'), reason_code, summary, ticket_id, proposed_by, confirmed_by, starts_at, ends_at, status ('proposed'|'active'|'appealed'|'lifted'|'rejected'), appeal_text, appeal_submitted_at, appeal_decided_by, appeal_decided_at, appeal_outcome, side_effects jsonb, created_at, updated_at)`. CHECKs: `kind <> 'ban' or confirmed_by is null or confirmed_by <> proposed_by`; `appeal_decided_by` distinto de `proposed_by` y de `confirmed_by`.
- `banned_identifiers(id, sanction_id, kind ('email'|'phone'|'instagram'|'document'|'face'), value_hmac, created_at)`, único `(kind, value_hmac)`.
- `security_alerts(id, kind ('reentry_blocked'|'image_duplicate'|'refund_needed'), status ('open'|'handled'|'dismissed'), subject_user_id uuid null, related_user_id uuid null, payload jsonb, resolution text, handled_by uuid, handled_at, created_at)`. La fase 2 inserta `image_duplicate`.
- `public.artist_is_public(registration_status text, sanction_state text) returns boolean` (immutable).
- Todas las escrituras: solo `service_role`. Lectura: soporte (`is_support_user()`); el usuario ve sus propias sanciones activas.

### `lib/ban-identifiers.js` (T3; lo usan T2 y T4)
```js
normalizeEmail(raw)            // → 'a@b.com' | null  (minúsculas, sin +etiqueta; sin puntos en gmail/googlemail)
normalizePhone(raw, countryIso2) // → '+5491122223333' | null  (E.164; AR/ES/US sin '+')
normalizeInstagram(raw)        // → 'handle' | null  (sin @, sin URL, minúsculas)
isConfigured()                 // → boolean (BAN_HMAC_KEY presente y válida: 32 bytes base64)
hmacIdentifier(kind, normalized) // → hex | null (null si no está configurada)
identifiersFor({ email, phone, instagram, country }) // → [{ kind, value_hmac }]
```

### `lib/sanciones-service.js` (T3; lo usan T2 y T4)
```js
checkReentry({ email, phone, instagram, country, flow, userId })
  // → { blocked: boolean, matches: [{ kind, sanction_id }] }
  // Falla abierta (blocked:false + console.warn) si no hay clave o falla la base.
  // Si blocked: crea security_alert 'reentry_blocked' (payload sin valores en claro) y avisa a soporte (sin esperar).
blockNewAccount({ userId, matches, flow })
  // banea en Auth la cuenta recién creada, oculta perfiles, revoca sesiones. Idempotente.
getActiveSanction(userId)       // → { id, kind, status, ends_at } | null  (suspension o ban activos)
```
Mensaje al usuario bloqueado (siempre el mismo): «No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.»

### `lib/artist-visibility.js` (T3; lo usa T4)
```js
PUBLISHED_OR      // string para .or() de pgrest con registration_status publicado
isPublicArtist(row) // registration_status !== 'incompleto' && (row.sanction_state || 'none') === 'none'
applyPublicFilter(query) // agrega el .or() de registro + .eq('sanction_state','none')
```

### Denuncias (T1; lo usan T3 y T4)
- Motivos de perfil: `suplantacion_identidad`, `plagio_diseno`, `robo_propiedad_intelectual`, `difamacion`, `estafa`.
- `lib/repos/denuncias.js` exporta `bumpClaimantReports(userId, handle)`: sube a `urgent` las denuncias abiertas del denunciante con ese Instagram reclamado y deja una nota interna. T4 la llama (en try/catch, sin esperar) después de validar un Instagram de artista o de estudio.
- El panel de denuncias llama `window.SupportSanctionsQueue && window.SupportSanctionsQueue.propose({ user_id, ticket_id, reason_code, summary })` desde el botón «Proponer sanción» del expediente. T3 implementa `SupportSanctionsQueue.propose` (abre la pestaña Sanciones con el formulario precargado).
- `report_outcome_notice` (al denunciante, «Se tomó acción» / «Sin acción», sin datos del otro) lo envía T1 desde `statusHandler` al resolver. T3 **no** envía nada al denunciante.
- `wo-report.js` acepta en `open()`: `reason`, `item: { key, image }`, `file` (un `File` precargado) y `context` (texto corto). La fase 2 lo usa desde el buscador.

### Insignia (T4; la usa T1 en los perfiles)
`window.WoVerifiedBadge` (UMD, también `require`):
```js
normalizeHandle(v), instagramMatches(row),
isBadgeVisible(artist),        // verification_state === 'Yes' && instagramMatches
isStudioBadgeVisible(studio),  // is_verified === true && instagramMatches
badgeState(row)                // 'visible' | 'hidden_ig_changed' | 'not_verified'
```
Columna generada `instagram_badge_ok boolean` en `artists_db` y `studios` (con `grant select` a anon/authenticated).

### Endpoints nuevos
| Método y ruta | Equipo |
|---|---|
| `GET /api/account/terms-status` · `POST /api/account/terms-accept` · `POST /api/register/precheck` | T2 |
| `GET/POST /api/support/sanctions…` · `GET/POST /api/support/security-alerts…` · `GET/POST /api/sanctions/appeal` | T3 |
| `POST /api/support/reports/:ticketId/claim` | T1 |

`terms-status` devuelve también `sanction: { kind, ends_at } | null` y `blocked: boolean` (con `getActiveSanction` y `checkReentry`).

## Sprint 2 · Propiedad de archivos y contratos

**T6 Motor de huellas**
- `supabase/migrations/20261118140000_image_fingerprints.sql` (+ reversa)
- nuevos `lib/image-fingerprint.js` (puro), `lib/image-decode.js`, `lib/image-sources.js`, `lib/repos/image-fingerprints.js`, `lib/image-fingerprint-job.js`, `scripts/backfill-image-fingerprints.js`
- tests nuevos: `tests/image-fingerprint.test.js`, `tests/image-fingerprint-job.test.js`, `tests/image-fingerprints-migration.test.js`

**T7 Buscador y alertas en soporte**
- nuevos `lib/routes/disenos.js`, `services/email-events/disenos.js`, `public/buscar-diseno/index.html`, `public/shared/js/buscar-diseno.js`, `public/shared/css/buscar-diseno.css`
- `public/shared/js/support-dashboard-sanctions.js`, `public/shared/css/support-dashboard-sanctions.css`, `public/shared/js/data/support-sanctions-repo.js`, `public/support/dashboard/index.html` (solo `?v=`)
- entradas nuevas (solo agregar) en `lib/email-render/fixtures.js`
- tests nuevos: `tests/disenos-buscar.test.js`, `tests/disenos-front.test.js`

**T8 Auditoría de dependencia** (solo lectura): informe de seguridad de `sharp` para decidir si entra en `package.json`.

### Decisión del dueño que aplica
Las coincidencias **solo avisan a soporte**: nada se oculta ni se retiene automáticamente.

### Contratos
- `lib/image-fingerprint.js` (puro, sin dependencias):
  `phash(gray)`, `dhash(gray)`, `phashMirror(gray)` → hex de 16 caracteres (64 bits); `gray = { data: Uint8Array, width, height }`;
  `hamming(hexA, hexB)` → entero; `sha256(buffer)` → hex;
  `confidenceFor(distance, sameSha)` → `'casi_segura'` (≤ 2 o sha igual) | `'posible'` (3–8) | `null` (> 8);
  `MATCH_THRESHOLD = 8`, `SEARCH_THRESHOLD = 12`.
- `lib/image-decode.js`: `isAvailable()`; `fingerprintBuffer(buffer)` → `{ sha256, phash, phash_mirror, dhash, width, height }` (usa `sharp` si está instalado; si no, `isAvailable()` es `false` y el job y el buscador se apagan con un aviso, sin romper el servidor).
- `lib/repos/image-fingerprints.js`: `searchSimilar({ phash, phashMirror, max, threshold })` → `[{ id, source_kind, artist_id, studio_id, owner_user_id, item_key, image_url, first_seen_at, distance }]` (solo públicas, no borradas, de perfiles sin sanción); `logSearch(userId, resultCount)`; `countSearchesLast24h(userId)`; `markRemoved(sourceKind, ownerId, itemKey)`.
- `lib/image-fingerprint-job.js`: `startImageFingerprintJob(opts)`, `stopImageFingerprintJob()`, `runFingerprintCycle(deps)`. Lo arranca `lib/routes/disenos.js` en `register(app, { startJob })`. Variable `IMAGE_FP_JOB=off` lo apaga.
- Tablas (migración de T6): `image_fingerprints` (columnas del plan + `status` `ok|decode_failed|skipped_external|fetch_failed`, `is_public`, `claimed_at`, `owner_user_id`; `phash`/`phash_mirror`/`dhash` como `bit(64)`; único `(source_kind, item_key)`), `image_fingerprint_queue`, `design_search_log`; RPC `search_image_fingerprints(p_phash bit(64), p_phash_mirror bit(64), p_max int, p_threshold int)` solo para service_role; índice único parcial en `security_alerts` sobre `(payload->>'pair_key')` cuando `kind = 'image_duplicate'`.
- Alerta `security_alerts` `kind = 'image_duplicate'`: `subject_user_id` = quien subió la imagen nueva, `related_user_id` = dueño de la anterior; `payload = { pair_key, distance, confidence, new: { fp_id, source_kind, item_key, image_url, owner_kind, owner_id, first_seen_at }, existing: { …igual } }`. Una sola alerta por par, aunque soporte la descarte (el job no vuelve a avisar).
- Acciones de soporte (T7): `POST /api/support/image-alerts/:id { action: 'legitimo' | 'retirar' | 'denuncia', note }`.
  - `legitimo`: descarta la alerta.
  - `retirar`: quita el ítem del portfolio del dueño con service role, marca la huella como borrada y avisa por correo a quien la subió (`portfolio_item_removed`).
  - `denuncia`: marca la alerta como atendida y abre «Proponer sanción» precargado.
- Buscador (T7): `POST /api/disenos/buscar` (sesión obligatoria; cuerpo binario JPEG/PNG/WebP de hasta 10 MB; 20 búsquedas por usuario cada 24 h, más un límite por IP). La foto se procesa en memoria y no se guarda. Responde hasta 12 resultados con `distance` ≤ 12.
