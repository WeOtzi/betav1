# Artist Signup Flow

Flujo completo de registro de artista en We Otzi, desde el primer click en `/registerclosedbeta` hasta la creacion del `auth.users` vinculado.

> Diseño: el wizard es **pre-auth**. Mientras el artista llena pasos, la fila vive en `artists_db` con `registration_status='incompleto'` y `user_id IS NULL`. El usuario Auth se crea solo al confirmar el resumen final, momento en que se setea `user_id` y `registration_status='pendiente de validacion'`. El admin/soporte aprueba la cuenta despues.

## 1. Capas involucradas

| Capa | Archivos clave |
|------|----------------|
| Frontend landing | `public/registerclosedbeta/index.html` + `public/shared/js/main.js` |
| Wizard | `public/register-artist/index.html` + `public/shared/js/register.js` |
| Helpers compartidos | `public/shared/js/artist-auth.js`, `public/shared/js/artist-registration-progress.js` |
| Endpoints servidor | `server.js` (`/api/register/artist-draft`, `/api/register/artist-finalize`, `/api/register/check-uniqueness`) |
| Logica de payload | `lib/artist-registration.js` |
| Migraciones DB | `supabase/migrations/20260513000000_artist_registration_drafts.sql` |
| Pruebas | `tests/artist-registration.test.js` |

## 2. Estados en `artists_db`

Columnas relevantes (todas agregadas o ajustadas por la migracion `20260513000000_artist_registration_drafts.sql`):

| Columna | Tipo | Notas |
|---------|------|-------|
| `user_id` | `uuid NULL` | Nullable; se setea al finalizar. Antes era `NOT NULL DEFAULT gen_random_uuid()`. |
| `registration_draft_id` | `uuid` | UUID generado server-side. Indice UNIQUE parcial (`WHERE registration_draft_id IS NOT NULL`). Identifica el borrador entre llamadas. |
| `registration_status` | `text NOT NULL DEFAULT 'pendiente de validacion'` | CHECK `IN ('incompleto', 'pendiente de validacion')`. Drafts viven como `incompleto`; al finalizar pasa a `pendiente de validacion`. |
| `registration_source` | `text` | `'email'`, `'instagram'`, `'google'`, `'apple'` o `'manual'`. |
| `registration_step` | `int` | CHECK `BETWEEN 0 AND 12`. Ultimo paso del wizard guardado. |
| `registration_started_at` | `timestamptz` | Primera escritura del draft. |
| `registration_last_saved_at` | `timestamptz` | Ultima escritura (cada autosave/step). |
| `registration_submitted_at` | `timestamptz` | Solo se setea al finalizar. |

**Transicion**: `(no row) -> incompleto -> pendiente de validacion -> aprobado` (la aprobacion se hace desde el backoffice; no esta cubierta por este flujo).

## 3. RLS

La migracion redefine las dos policies de SELECT publicas/autenticadas para excluir drafts incompletos:

```sql
CREATE POLICY "Public can view artists for marketplace"
  ON public.artists_db FOR SELECT
  USING (registration_status IS DISTINCT FROM 'incompleto');
```

Resultado: drafts incompletos no aparecen en marketplace, perfiles publicos ni busquedas autenticadas normales. Solo el service role (backend) puede leerlos.

## 4. Endpoints servidor

Los tres endpoints usan service role Supabase (`SUPABASE_SERVICE_ROLE_KEY`) via `_supabaseFetch()` en `server.js`. No usan la sesion del browser.

### Rate limits

| Endpoint | Limiter | Cuota | Justificacion |
|---|---|---|---|
| `POST /api/register/artist-draft` | `apiLimiter` (solo) | 300 / 15 min | Autosave de alta frecuencia (~30-60 calls por wizard). NO se aplica `authLimiter` porque no es auth-sensitive. |
| `POST /api/register/artist-finalize` | `apiLimiter` + `authLimiter` | 300 + 10 / 15 min | Crea `auth.users`. Brute-force protection legitima. 10 calls/15 min cubre reintentos razonables. |
| `POST /api/register/check-uniqueness` | `apiLimiter` (solo) | 300 / 15 min | Lookup read-only. |

`express-rate-limit` usa `MemoryStore` por defecto, asi que los contadores viven en memoria del proceso Node y se resetean en cada `npm start`. Para escalar horizontalmente hay que migrar a `RedisStore`.

### `POST /api/register/artist-draft`

Crea o actualiza un draft. Idempotente por `draft_id` o `email`.

**Body**:
```json
{
  "email": "user@example.com",         // opcional al inicio (Instagram flow puede no tenerlo aun)
  "source": "email",                   // email | instagram | google | apple | manual
  "step": 3,                           // 0-12
  "draft_id": "<uuid>",                // opcional; si viene se actualiza esa fila
  "data": { ... formData del wizard ... }
}
```

**Respuesta (200)**:
```json
{
  "success": true,
  "draft_id": "<uuid>",
  "artist": { ... campos publicos via publicArtistDraft() ... }
}
```

**Respuesta (409 `ALREADY_REGISTERED`)**: si el email ya existe en `artists_db` con `user_id IS NOT NULL` o `registration_status='pendiente de validacion'`. El cliente muestra "inicia sesion".

**Logica clave (`server.js` ~4329-4396)**:

1. Valida formato de email si esta presente.
2. `findArtistDraft({ draftId, email })` busca por draft_id o, en su defecto, por email + `registration_status='incompleto'`.
3. Si existe y `isFinalizedArtist(existing)` → 409.
4. `artistRegistration.buildArtistRegistrationPayload(formData, options)` construye el patch normalizado. Importante: `delete patch.user_id` para asegurar que el draft NUNCA inventa un user_id.
5. Si existia fila: PATCH; si no: POST. Ambos via REST con `Prefer: return=representation`.

### `POST /api/register/artist-finalize`

Crea el `auth.users` y vincula con la fila de `artists_db`.

**Body**:
```json
{
  "draft_id": "<uuid>",          // requerido
  "email": "user@example.com",
  "password": "<>=6 chars>",
  "source": "email",
  "data": { ... formData completo ... }
}
```

**Respuesta (200)**:
```json
{
  "success": true,
  "user_id": "<auth.users.id>",
  "draft_id": "<uuid>",
  "registration_status": "pendiente de validacion",
  "artist": { ... },
  "dashboard_url": "...",
  "login_url": "...",
  "profile_url": "..."
}
```

**Respuestas de error**:
- 400: draft_id falta, email invalido, password < 6 chars.
- 404: draft no encontrado.
- 409: draft ya finalizado o email/username/instagram en conflicto.

**Logica clave (`server.js` ~4398-4479)**:

1. Valida draft_id, email, password.
2. Carga el draft. Si ya esta finalizado → 409.
3. `getRegistrationConflicts({ email, username, instagram, draftId })` verifica unicidad excluyendo el propio draft.
4. `resolveRegistrationStudio(formData)` resuelve estudio (independiente o vinculado a un studio existente).
5. `createArtistAuthUser({ email, password, fullName, username, draftId, source })` crea el usuario Auth via service role.
6. Construye el patch final con `user_id`, `step=12`, `registration_status='pendiente de validacion'`, `registration_submitted_at=now`.
7. PATCH a la fila de `artists_db` por `registration_draft_id`.

### `POST /api/register/check-uniqueness`

Pre-flight para que el wizard pueda mostrar errores de "username ya tomado" o "instagram en uso" antes de intentar finalizar.

## 5. Trigger `handle_new_user`

Si un `auth.users` se crea por una ruta distinta a `artist-finalize` (por ejemplo OAuth Google directo, o `createUser` admin), el trigger en `auth.users INSERT` ejecuta `public.handle_new_user()` y:

1. Excluye superadmin (`isai@weotzi.com` o role `superadmin` en `raw_user_meta_data`/`raw_app_meta_data`) — no crea fila de artista.
2. Busca una fila de `artists_db` con `email` igual y `user_id IS NULL` y `registration_status='incompleto'`. Si existe, la vincula al nuevo `auth.users.id` y la marca como `pendiente de validacion`.
3. Si no existe draft previo, INSERT nuevo con `name`/`username` derivados de los metadata o del email.

Esto cubre el caso de Google/Apple OAuth donde el usuario no pasa por el wizard pre-auth; aun asi queda registrado como artista pendiente.

## 6. Flujo end-to-end (camino email)

1. Usuario abre `/registerclosedbeta`.
2. Llena email, pulsa "REGISTRARSE" → `handleRegistration()` en `main.js:458`.
3. `createOrResumeArtistDraft({ email, source: 'email' })` → POST `/api/register/artist-draft`.
4. Backend devuelve `{ draft_id, artist }`. Frontend redirige a `/register-artist?draft=<id>&source=email&email=...`.
5. Wizard `register.js` carga el draft, presenta los 12 pasos del formulario. Cada paso/autosave hace POST `/api/register/artist-draft` con el `draft_id` y el `formData` actualizado.
6. Antes del paso final, frontend llama `/api/register/check-uniqueness` para verificar email/username/instagram.
7. Usuario confirma resumen y elige password → POST `/api/register/artist-finalize`.
8. Backend crea `auth.users`, vincula `artists_db`, devuelve dashboard/login urls.
9. Frontend redirige a `/registerclosedbeta` (login form) o `/artist/dashboard` (auto-login si esta activado).

## 7. Casos especiales

- **Re-entrada sin draft_id**: si el usuario vuelve a `/registerclosedbeta` con el mismo email, el backend reutiliza el draft incompleto existente (`findArtistDraft` por email). No crea una fila nueva.
- **Google/Apple OAuth**: el usuario hace login directo y el trigger `handle_new_user` crea o vincula la fila de `artists_db`. Luego el wizard puede completar los campos faltantes.
- **Instagram**: el flujo arranca igual via `createOrResumeArtistDraft({ source: 'instagram' })` (sin email aun). El wizard captura el email mas adelante.

## 8. Pruebas

`tests/artist-registration.test.js` cubre:

- `buildArtistRegistrationPayload` no inventa `user_id` para drafts.
- El payload de finalize incluye `user_id` y `registration_status='pendiente de validacion'`.
- Validacion de email, username slugification, password length.

Ejecutar con `npm test`.

## 9. Convenciones de frontend relevantes

Ver `docs/TECHNICAL.md` seccion 6 para:

- Patron singleton `window._supabase` (todo script frontend reusa una instancia).
- Activacion opt-in de Microsoft Clarity via `window.CLARITY_PROJECT_ID`.
