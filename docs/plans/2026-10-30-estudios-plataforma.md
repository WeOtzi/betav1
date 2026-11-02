# Plataforma de Estudios + Supplies — diseño (v2)

**Fecha:** 2026-10-30 · **Estado:** en implementación · **Rama:** `feature/estudios-plataforma` (worktree `.claude/worktrees/estudios-plataforma`, base `feature/figma-final-artista`)

Este documento es el **contrato entre módulos**. Fija nombres de tablas, RPCs, repos, globals de frontend y dueños de archivos. Si un módulo necesita algo que no figura acá, se agrega acá primero. La v2 incorpora la revisión adversarial (seguridad/RLS, máquinas de estado, producto, factibilidad), verificada contra el código y la base viva `flbgmlvfiejfttlawnfu`.

## Objetivo

Que un **Estudio** administre todo desde `/studio/dashboard`:

1. **Equipo con alta en ambos sentidos.**
   - El estudio invita y el artista acepta.
   - El artista solicita y el estudio aprueba. Recién entonces el artista figura como "tatúa en …".
2. **Spots y contratos.** Spots para residentes y guest/itinerantes, con modalidad (porcentaje / fijo / mixto), qué incluye el puesto y beneficios. Aceptar una postulación genera un **contrato registrado**. Cuando el artista firma, entra al roster y al perfil público.
3. **Agenda.** Las citas de todos los artistas del estudio. Se agenda un cliente directo con un artista, con chequeo de disponibilidad contra su agenda personal, sus sesiones de cotización y otros estudios. Del resto solo se ve "ocupado".
4. **Inventario y materiales.** Stock y **entrega de materiales a artistas**, con devoluciones y balance por artista.
5. **Tienda.** Merch, aftercare y joyería, sobre el modelo `store_*` compartido con Store de artistas (otra sesión, rama `feature/store-artista`).
6. **Finanzas y reportes.** Tatuajes, merch vendido, ingresos, gastos y resultado, siempre por moneda.
7. **Reposición.** Pedidos a usuarios **Supplies** (nuevo tipo de cuenta, tiendas de insumos) con descuento We Ötzi y beneficios. Al recibir un pedido se repone el inventario y se registra el gasto.

Además:

- **Reclamo de estudio.** Los 40 estudios del catálogo no tienen dueño. Un estudio real puede reclamar su ficha y soporte lo aprueba.
- **Supplies** tiene cuenta y panel propios en `/supplies/dashboard`: perfil, catálogo, pedidos, beneficios, clientes y reportes.

## Decisiones por defecto (documentadas, reversibles)

- **Pagos.** No hay pasarela de pago. La tienda usa la capa de pagos manual de Store. Los pedidos de Supplies se pagan por fuera: la plataforma registra montos, estados y el gasto.
- **Firma de contratos.** La firma es en plataforma, sin firma electrónica certificada.
  - El **dueño del estudio** firma al emitir (nombre + usuario). Soporte no emite en nombre del estudio.
  - El artista firma escribiendo su nombre completo y aceptando los términos.
  - Al emitir se congelan `terms_snapshot` + `terms_hash` (SHA-256 con `extensions.digest`; pgcrypto está instalado). Cualquier cambio exige una nueva versión.
- **"Pago fijo" tiene sentido** (`fixed_payer`):
  - `artist_to_studio`: alquiler de puesto, lo habitual.
  - `studio_to_artist`: sueldo o stipend.
- **Visual.** Se sigue la línea del dashboard actual de estudio (`studio.css`). `studio/*` quedó fuera del rediseño DS y no hay Figma de estudio ni de Supplies. Cuando lo haya, se hace una pasada aparte.
- **Migraciones y despliegue.**
  - Las migraciones nuevas quedan **NO aplicadas**. Se validan contra la base viva dentro de `BEGIN … ROLLBACK`. Aplicarlas es decisión del usuario.
  - Todo el código debe **degradar sin romper** mientras no estén aplicadas (ver Reglas transversales §6).
- **Fuera de alcance**, como trabajo posterior:
  - Bandeja de mensajes del estudio (`inbox_threads` está centrado en el artista).
  - Invitar por email a artistas que no están en la plataforma (por ahora se ofrece "Compartí el link de registro").
  - Staff o gerentes con acceso al dashboard.
  - Firma electrónica certificada.

## Reglas transversales (aplican a todos los agentes)

### 1. Guards

Las escrituras directas de clientes **nunca** saltean una máquina de estados. Cada tabla con estados lleva un trigger BEFORE `private.guard_*` SECURITY INVOKER con el bypass estándar, copiado de `public.enforce_studio_spot_curated_fields` (`20260829064000`):

```sql
if current_user in ('postgres','supabase_admin','service_role')
   or coalesce(auth.role(),'') = 'service_role'
   or public.is_support_user() then return new; end if;
```

Dentro de una RPC SECURITY DEFINER (owner postgres) `current_user = 'postgres'`, así que las RPC pasan. Los guards no se escriben como SECURITY DEFINER.

### 2. RPCs

- Las RPC que cruzan partes son SECURITY DEFINER, con `set search_path = ''` y todo calificado (`public.`, `extensions.`).
- Validan **pertenencia cruzada** de cada id recibido: membresía, spot, postulación, sede, ítem, línea, contrato anterior. Todos deben pertenecer al mismo estudio y al mismo artista. Si no, errcode `22023` o `42501`.
- Toman `pg_advisory_xact_lock(hashtextextended('sam:'||studio_id||':'||artist_user_id, 0))` antes de chequear y escribir vínculos estudio↔artista.
- Hacen `FOR UPDATE` de las filas que van a cambiar.
- Errcodes: `42501` sin permiso, `23514` estado inválido, `22023` argumento inválido. Mensajes en español con voseo.
- Llevan `REVOKE ALL … FROM PUBLIC, anon` y `GRANT EXECUTE … TO authenticated`.

### 3. URLs de terceros

- Las columnas con URLs (`portfolio_url`, `website`, `logo_image`, `cover_image`, `image_url`, `images[]`) llevan `CHECK (col is null or col ~* '^https?://')`.
- En el frontend, todo `href`/`src` armado con datos pasa por `WeOtziStudioKit.safeUrl(u)`, que devuelve la URL solo si el protocolo es http(s); si no, null.

### 4. Destinatarios de emails

Los emails se resuelven **siempre en el servidor** a partir del email de `auth.users` del dueño o del artista:

- Nunca se usan `studios.email`, `supply_vendors.contact_email` ni `client_email`.
- Si el estudio no tiene dueño, no se envía nada.

### 5. Base de datos sin aplicar

Los selects existentes **no cambian**. Columnas y embeds nuevos solo entran en métodos nuevos o en una variante con fallback: se reintenta sin las columnas nuevas ante `42703`/`PGRST204`/`PGRST200` (patrón de `calendar-repo.js`).

- Todo método nuevo que corre al cargar una pantalla (badges, Inicio, Invitaciones) traga los errores de "migración pendiente" y deja la UI vacía.
- `initiated_by` ausente equivale a `'studio'`.
- `friendlyError`:
  - `PGRST200`/`PGRST202`/`PGRST204`/`PGRST205`/`42703`/`42883`/`42P01` → "Esta función todavía no está disponible (falta aplicar una migración)."
  - Cualquier otro código, incluido `P0001` → `error.message`.

### 6. Archivos compartidos

- **Nadie edita `studio.css`.** Las reglas nuevas van en `studio-admin-kit.css` o en la CSS del módulo.
- **Nadie toca** `package.json`, `package-lock.json` ni `docs/CHANGELOG.md`. Solo W-INTEGRATOR, al final.

### 7. Commits (`scripts/release/check-policy.cjs`)

- Formato: `<tipo>(<área>): <≥8 caracteres>`, más cuerpo con `Version: 2.3.0` y `Validación: …`.
- Commitea solo el integrador.

### 8. Copy

Español rioplatense con voseo. Estados en español, nunca el valor crudo en inglés.

## Modelo de datos

Migraciones `20261030200000`–`20261030205000`, **NO aplicadas**. Cada una tiene su rollback en `supabase/rollbacks/<ts>_<name>.down.sql`.

### Convenciones

- Status en `text` + CHECK.
- Fechas con `timezone('utc', now())` y trigger `set_*_updated_at`.
- RLS separada por comando.
- Dueño de estudio = `exists(select 1 from public.studios s where s.id = X.studio_id and s.user_id = (select auth.uid()))`. Soporte = `public.is_support_user()`.
- Cada migración termina con `NOTIFY pgrst, 'reload schema'`.
- No se referencian columnas de las migraciones `20261028*` no aplicadas. Para leerlas se usa `to_jsonb(row)->>'col'`. La única excepción es `studio_spots.benefit_tags`: M2 la crea con **la misma definición** de `20261028170000` (`text[] not null default array[]::text[]`, CHECK `studio_spots_benefit_tags_len` con `cardinality ≤ 6`), con guards idempotentes.
- Funciones existentes que se reemplazan:
  - Se parte de `pg_get_functiondef` en vivo, que puede diferir del repo, y se cambia solo lo indicado.
  - Se conservan firma, `search_path` y `SECURITY` originales, salvo que se diga otra cosa.
  - El rollback restaura la definición viva previa.

### Orden y dependencias

M1 → M2 → M3 → M4 → M5 se aplican **juntas y en ese orden**: M1 deja puentes que M2 reemplaza. La validación corre la cadena completa más los tests SQL en una sola transacción con `ROLLBACK`. M6, la tienda, viene después del `store_core` de Store.

### M1 `20261030200000_studio_affiliations.sql`: alta en dos sentidos, reclamo y guards

**`studio_artist_memberships`**

- **Columnas y estados nuevos:**
  - `+ initiated_by text not null default 'studio' check in ('studio','artist')`.
  - El CHECK de `status` suma **`requested`**: el artista pidió y decide el estudio.
  - `pending_acceptance` y `pending_invite` (legado) significan que invitó el estudio y decide el artista.
- **Unicidad:**
  - Se quita el UNIQUE `studio_artist_memberships_no_double_active` sobre (studio, artist, role, status). Bloqueaba el historial.
  - Lo reemplaza el índice parcial único `studio_memberships_one_open_per_role` sobre (studio_id, artist_user_id, role) donde `status in ('requested','pending_invite','pending_acceptance','active','paused')`.
  - Antes de crearlo, la migración verifica que no haya duplicados abiertos. En vivo hoy hay 0.
- **Puentes por la caída del UNIQUE**, en la misma migración:
  - `decide_studio_spot_application` se reemplaza con su cuerpo vivo, cambiando solo el `INSERT … ON CONFLICT (studio_id, artist_user_id, role, status)` por `INSERT … SELECT … WHERE NOT EXISTS (fila abierta mismo studio/artist/role)`. M2 la vuelve a reemplazar.
    - **Excepción deliberada a "se conserva el `SECURITY` original":** en vivo la función es **SECURITY INVOKER** con `search_path = public, pg_temp` (verificado en `pg_proc`). M1 la redefine **SECURITY DEFINER** (conserva `search_path = public, pg_temp`) y M2 la deja **SECURITY DEFINER** con `search_path = ''` y todo calificado. Es necesario para que los guards nuevos (`private.guard_studio_membership_write`, `private.guard_spot_application_write`) se salteen dentro de la RPC (`current_user = 'postgres'`); como INVOKER, el dueño quedaría bloqueado por su propio guard. La función sigue validando dueño o soporte por dentro.
    - Rollbacks: el de M2 restaura la versión de M1 (DEFINER, `public, pg_temp`); el de M1 restaura la definición viva **INVOKER** con su ACL (`REVOKE` de PUBLIC y anon, `GRANT EXECUTE` a authenticated).
  - Los seeds `supabase/seeds/20260829_*.sql` cambian a `on conflict do nothing` sin target.
  - `scripts/test-studio-identity-transactions.sql` se ajusta.
- **Guard `private.guard_studio_membership_write()`** (BEFORE INSERT OR UPDATE, bypass estándar). Para el resto:
  - **INSERT:** solo con `status in ('pending_acceptance','pending_invite')`, `initiated_by='studio'`, `current_contract_id is null` y `started_at is null`.
  - **UPDATE:**
    - Son inmutables `studio_id`, `artist_user_id`, `initiated_by` y `current_contract_id`.
    - Transiciones permitidas: `active↔paused`; `pending_*→rejected|ended` (cancelar la invitación); `requested→rejected`.
    - Entrar a `active` desde `requested`, `pending_*`, `ended` o `rejected` solo pasa por RPC.
    - Con `current_contract_id` no nulo, `role` y `revenue_split_pct` son inmutables. `location_id` y `notes` sí se pueden cambiar.
- **RLS / roster público.**
  - Se hace `DROP POLICY sam_public_select_active`, que exponía `revenue_split_pct` y `notes` a anon.
  - Se crea la vista `public.studio_public_roster` (security_invoker=false, owner postgres): `select m.id as membership_id, m.studio_id, m.artist_user_id, m.location_id, m.role, m.started_at, c.end_date as ends_on from studio_artist_memberships m left join studio_contracts c on c.id = m.current_contract_id and c.status='signed' where m.status='active'`.
    - El join a contratos se agrega en M2 con `create or replace view`. En M1 la vista se crea con `null::date as ends_on`.
  - `GRANT SELECT` a anon y authenticated.
- **`studio_membership_request_details`** (PK/FK `membership_id` on delete cascade):
  - Columnas: `message text (≤1000)`, `portfolio_url text` (CHECK http(s)), `proposed_start_date date`, `styles text[] default '{}'`, `created_at`.
  - RLS: las partes y soporte pueden hacer SELECT. No hay escritura directa.
- **RPCs (todas SECURITY DEFINER):**
  - `request_studio_membership(p_studio_id uuid, p_role text default 'resident', p_location_id uuid default null, p_message text default null, p_portfolio_url text default null, p_proposed_start_date date default null) returns jsonb` → `{membership_id, studio_has_owner}`.
    - Validaciones: el caller tiene fila en `artists_db`; el estudio está `is_active`; el rol es `resident`, `guest` o `itinerant`; la sede es del estudio.
    - Falla con `23514` si hay una fila abierta de cualquier rol para el par ("Ya tenés una solicitud o vínculo abierto con este estudio"), o si el artista ya hizo una solicitud a ese estudio en las últimas 72 h en cualquier estado ("Esperá unos días antes de volver a solicitar").
    - Inserta `status='requested'`, `initiated_by='artist'`, `invited_at=now()`, más los detalles.
  - `decide_studio_membership_request(p_membership_id uuid, p_decision text, p_role text default null, p_location_id uuid default null) returns jsonb`.
    - `p_decision` es `'accept'` o `'reject'`; cualquier otro valor da `22023`. Solo dueño o soporte. El estado debe ser `requested`.
    - `accept` pasa a `active` (`started_at`; rol y sede opcionales, la sede debe ser del estudio). `reject` pasa a `rejected` (`ended_at`).
    - Al cerrarse, cancela los contratos `draft` o `sent` de esa membresía.
    - Devuelve `{membership_id, status, artist_user_id, studio_id}`.
  - `withdraw_studio_membership_request(p_membership_id uuid) returns void`: solo el artista; de `requested` a `ended`. Cancela sus contratos `draft` o `sent`.
- **Parches** (desde la definición viva):
  - `respond_to_studio_invitation`:
    - Rechaza `initiated_by='artist'`.
    - `accept` falla con `23514` "Esta invitación tiene un contrato para firmar" si existe un contrato `sent` con `membership_id` = la fila.
    - `reject` pasa esos contratos a `declined`.
    - M2 hace este parche, porque la tabla de contratos nace en M2.
  - `inbox_from_studio_invitation`: mensajes según (`initiated_by`, status):

    | initiated_by | Estado | Mensaje |
    | --- | --- | --- |
    | artist | `requested` | "Solicitud enviada a {estudio}" |
    | artist | `requested→active` | "{estudio} aprobó tu solicitud" |
    | artist | `requested→rejected` | "{estudio} no aprobó tu solicitud" |
    | artist | `requested→ended` | "Retiraste tu solicitud" |
    | cualquiera | `active→ended` | "Tu vínculo con {estudio} terminó" |
    | cualquiera | `paused` | "Tu vínculo con {estudio} quedó en pausa" |
    | studio | invitación | Se mantienen los textos actuales |

- **Guard `private.guard_artist_studio_pointer()`** (BEFORE UPDATE en `artists_db`, bypass estándar): `studio_id` solo puede cambiar a NULL o a un estudio donde el artista tenga membresía `active`. Si no, conserva `OLD.studio_id` (sin error, para no romper los guardados del dashboard).
- **Guard `private.guard_studio_protected_columns()`** (BEFORE INSERT OR UPDATE en `studios`, bypass estándar):
  - En INSERT fuerza `is_verified=false`.
  - En UPDATE rechaza cambios de `is_verified` y `user_id` con `42501`.
  - Se hace `DROP POLICY studios_anyone_create_via_app`, porque los estudios con dueño se crean solo por la RPC de registro (SD). Antes, grep de inserts directos a `studios` con `user_id` en el frontend: no debe haber ninguno.
- **Reclamo de estudio:**
  - Tabla `studio_claim_requests`:
    - Columnas: `id`, `studio_id fk cascade`, `user_id uuid not null fk auth.users cascade`, `evidence text (≤1000)`, `contact_name text`, `contact_phone text`.
    - `status text default 'pending' check in ('pending','approved','rejected')`, más `created_at`, `decided_at`, `decided_by uuid` y `decision_note`.
    - Único parcial `(studio_id) where status='pending'` y único parcial `(user_id) where status='pending'`.
    - RLS: SELECT para el propio `user_id` y soporte. No hay escritura directa.
  - `request_studio_claim(p_studio_id uuid, p_evidence text, p_contact_name text default null, p_contact_phone text default null) returns uuid`.
    - SD. Exige email confirmado, que el caller no tenga estudio propio y que `studios.user_id is null`.
  - `decide_studio_claim(p_claim_id uuid, p_decision text, p_note text default null) returns jsonb`.
    - Solo soporte. `approve` asigna `studios.user_id` y `studios.email` (el de `auth.users`), pone `profile_complete=false` y rechaza los demás reclamos `pending` de ese estudio. `reject` solo marca el reclamo.
  - `list_unowned_studios(p_query text) returns table(id, name, slug, city, country, logo_image)`.
    - SD, para buscar en el catálogo desde el registro. Máximo 20 filas y `p_query` de al menos 2 caracteres.
  - `complete_studio_registration` (parche): si `normalized_name` coincide con un estudio **sin dueño**, falla con `23514` "Ese estudio ya está en We Ötzi: reclamalo desde el registro."

### M2 `20261030201000_studio_contracts.sql`: contratos registrados

**Tabla `studio_contracts`**

| Grupo | Columnas |
| --- | --- |
| Identidad | `id uuid pk`, `studio_id fk cascade`, `contract_number text not null`, `version int not null default 1`, `supersedes_contract_id uuid null fk self` |
| Partes | `artist_user_id uuid null fk artists_db(user_id) on delete set null`, `membership_id uuid null fk studio_artist_memberships set null` |
| Origen | `spot_id uuid null fk studio_spots set null`, `application_id uuid null fk studio_spot_applications set null`, `origin text not null check in ('spot_application','invitation','request','manual')` |
| Puesto | `role text not null check in ('resident','guest','itinerant')`, `location_id uuid null fk studio_locations set null` |
| Modalidad | `compensation_model text null check in ('percentage','fixed','mixed')`, `artist_percentage numeric(5,2) null check 0–100` (lo que **se queda el artista** de cada tatuaje) |
| Pago fijo | `fixed_amount numeric(12,2) null check ≥0`, `fixed_currency text null check ^[A-Z]{3}$`, `fixed_period text null check in ('per_session','daily','weekly','monthly','one_time')`, `fixed_payer text null check in ('artist_to_studio','studio_to_artist')` |
| Vigencia | `start_date date null`, `end_date date null`, `cancellation_notice_days int null check 0–365` |
| Términos | `includes text[] default '{}'`, `perks text[] default '{}'`, `artist_obligations text[] default '{}'`, `house_rules text (≤5000)`, `terms text (≤20000)` |
| Estado | `status text not null default 'draft' check in ('draft','sent','signed','declined','cancelled','terminated','expired')` |
| Fechas y firmas | `sent_at`, `expires_at`, `studio_signer_name`, `studio_signed_by uuid`, `studio_signed_at`, `artist_signer_name`, `artist_signed_at`, `declined_at`, `decline_reason`, `cancelled_at`, `cancel_reason`, `terminated_at`, `terminated_by uuid`, `termination_reason` |
| Integridad | `terms_snapshot jsonb`, `terms_hash text`; el snapshot incluye nombre, username y email del artista y nombre y slug del estudio |
| Auditoría | `created_by uuid`, `created_at`, `updated_at` |

- **Número de contrato:** `C-YYYY-NNNN`, asignado **al crear el borrador**. Se hace `SELECT … FROM studios WHERE id=… FOR UPDATE` y luego max+1 entre los números del año del estudio. Una nueva versión conserva el número con `version+1`.
  - `UNIQUE (studio_id, contract_number, version)`.
- **CHECKs** (solo con `status <> 'draft'`):
  - `start_date is not null` y `end_date is null or end_date >= start_date`.
  - Modalidad:
    - `percentage` exige `artist_percentage`.
    - `fixed` exige los 4 `fixed_*`.
    - `mixed` exige todo.
    - `compensation_model` no puede ser null.
- **Índices parciales únicos:**
  - un contrato `sent` por (studio_id, artist_user_id);
  - un contrato `signed` por `membership_id`;
  - un contrato `draft` o `sent` por `application_id` (cuando no es null).
- **RLS:**
  - SELECT: dueño y soporte ven todo. El artista ve los suyos con `status <> 'draft'`.
  - Sin INSERT, UPDATE ni DELETE para authenticated: solo por RPC.
- **Columnas nuevas en otras tablas:**
  - `studio_artist_memberships`: `+ current_contract_id uuid null fk studio_contracts set null`.
  - `studio_spots`: `+ benefit_tags` (ver Convenciones), `compensation_model`, `fixed_amount`, `fixed_currency`, `fixed_period`, `fixed_payer`, con los mismos CHECKs que el contrato y todos nullables.
- **Guard `private.guard_spot_application_write()`** (BEFORE UPDATE en `studio_spot_applications`, bypass estándar):
  - El artista tiene inmutables `spot_id`, `artist_user_id` y `decided_*`, y su único cambio de status posible es pasar de `pending`, `viewed` o `shortlisted` a `withdrawn`.
  - El dueño puede pasar a `viewed`, `shortlisted` o `rejected`. **`accepted` solo lo pone `sign_studio_contract`.**
- **Máquina spot → contrato (un solo punto de aceptación):**
  - `decide_studio_spot_application` (create or replace, misma firma `(uuid,text) returns studio_spot_applications`, dueño o soporte; **SECURITY DEFINER** con `search_path = ''`, a diferencia de la viva INVOKER: ver la excepción documentada en M1):
    - `accepted` pasa la postulación a **`shortlisted`** (si no está cerrada) y asegura el borrador con `prepare_contract_from_application`. No crea membresía.
    - `rejected` queda sin cambios y además cancela los contratos `draft` o `sent` de la postulación.
  - `respond_to_studio_spot_counter_offer` (parche): cuando se acepta, la postulación pasa a `shortlisted` en lugar de `accepted`.
  - `issue_studio_contract` no toca la postulación, pero falla con `23514` si está `withdrawn` o `rejected`.
  - `sign_studio_contract` pasa la postulación a `accepted`. Esto dispara los triggers existentes de trip e inbox ("aceptada").
  - Si un contrato de `origin='spot_application'` termina en `declined`, `cancelled` o `expired`, la postulación queda `shortlisted`.
  - Si el artista retira la postulación (`withdrawn`), se cancelan sus contratos `draft` o `sent`, mediante un trigger AFTER UPDATE SD en applications.
- **RPCs (SD; devuelven jsonb con el contrato o `uuid`):**
  - `save_studio_contract_draft(p_contract jsonb) returns uuid`
    - Solo dueño o soporte.
    - Lista blanca de claves editables: `studio_id` (solo al crear), `artist_user_id` (solo al crear), `membership_id`, `spot_id`, `application_id`, `origin` (solo al crear), `role`, `location_id`, `compensation_model`, `artist_percentage`, `fixed_*`, `start_date`, `end_date`, `cancellation_notice_days`, `includes`, `perks`, `artist_obligations`, `house_rules`, `terms`, `supersedes_contract_id`. El resto se ignora.
    - En UPDATE: `FOR UPDATE` del contrato, `status='draft'` y dueño del `studio_id` existente; `studio_id` y `artist_user_id` son inmutables.
    - Valida la pertenencia cruzada de todo id.
    - Arrays: hasta 20 ítems de hasta 200 caracteres, sin vacíos.
  - `prepare_contract_from_application(p_application_id uuid) returns uuid`
    - Solo dueño o soporte. Hace `FOR UPDATE` de la postulación. Si ya existe un `draft` o `sent` para esa postulación, lo devuelve.
    - Rol: `guest_spot`→`guest`, `resident`→`resident`, `itinerant`→`itinerant`.
    - Modalidad, en este orden:
      1. Si el spot tiene `compensation_model` propio, se usan sus `fixed_*`.
      2. Si no, el split sale de la contraoferta aceptada más reciente o, en su defecto, del spot.
      3. El stipend pasa a `fixed_*` con `studio_to_artist`, `fixed_currency = upper(btrim(stipend_currency))` si cumple `^[A-Z]{3}$` y `fixed_period = coalesce(stipend_frequency,'monthly')`.
      4. Con split y stipend queda `mixed`. Sin nada, `compensation_model` queda null.
    - `includes` = `studio_includes` + "Hospedaje" si `includes_housing`. `perks` = `benefit_tags`. `artist_obligations` = `artist_expectations`.
    - Fechas: las del spot o `lower/upper(requested_dates)`.
    - Nunca falla por falta de términos.
  - `prepare_contract_for_membership(p_membership_id uuid) returns uuid`
    - Solo dueño o soporte. La membresía debe estar abierta y su rol no puede ser `manager` (`22023` "Los managers no llevan contrato de spot").
    - Si ya hay un `draft` o `sent` de esa membresía, lo devuelve.
    - Toma datos de `studio_membership_invitation_details`: `benefits`→`perks`, `studio_provides`→`includes`, `artist_expectations`→`artist_obligations` y las fechas propuestas. Para porcentajes usa `revenue_split_pct`.
    - Origen: `invitation` si `initiated_by='studio'`, `request` si no.
  - `get_current_contract_for_membership(p_membership_id uuid) returns jsonb`: el contrato `sent` o `signed` de mayor versión. Las partes y soporte.
  - `issue_studio_contract(p_contract_id uuid, p_signer_name text, p_expires_at timestamptz default null) returns jsonb`
    - **Solo el dueño** (soporte recibe `42501`).
    - Pasa de `draft` a `sent` si están completos la modalidad (`22023` "Completá la modalidad de pago") y `start_date`.
    - Revalida la pertenencia y que la membresía o postulación siga abierta.
    - Arma el snapshot y el hash, registra la firma del estudio, `sent_at` y `expires_at` (por defecto, 14 días).
  - `sign_studio_contract(p_contract_id uuid, p_signer_name text, p_accept_terms boolean) returns jsonb`
    - Solo `auth.uid() = artist_user_id`, nombre de 3 caracteres o más, `p_accept_terms` en true, estado `sent` y sin vencer (si venció: pasa a `expired` y falla).
    - Orden obligatorio:
      1. `FOR UPDATE` del contrato y advisory lock del par.
      2. **Membresía destino:**
         - a) la `membership_id` del contrato, que tiene que estar abierta (`23514` "La solicitud o invitación ya fue cerrada");
         - b) si no hay, la fila abierta con el **mismo** (studio, artist, role del contrato);
         - c) si no hay, se inserta una `active` con `initiated_by='studio'`, salvo cuando `origin='request'` (`23514` "La solicitud ya no está abierta").
         - Nunca se cambia el `role` de una membresía si hay otra fila abierta con el rol destino (`23514`).
      3. Los otros contratos `signed` de esa membresía pasan a `terminated` con razón "Reemplazado por C-…".
      4. Un único UPDATE del contrato: `signed`, `membership_id`, `artist_signer_name`, `artist_signed_at`.
      5. Si el rol es `guest` o `itinerant` y `origin <> 'spot_application'`: upsert en `studio_membership_invitation_details` de `proposed_start_date` y `proposed_end_date` desde el contrato, para que el trigger existente cree el viaje.
      6. Un único UPDATE de la membresía: `status='active'`, `started_at` si faltaba, `role`, `location_id`, `revenue_split_pct = artist_percentage` cuando es `percentage` o `mixed`, y `current_contract_id`.
      7. Si `origin='spot_application'`, la postulación pasa a `accepted`.
    - Devuelve `{contract_id, membership_id}`.
  - `decline_studio_contract(p_contract_id uuid, p_reason text default null)`: el artista; de `sent` a `declined`.
  - `cancel_studio_contract(p_contract_id uuid, p_reason text default null)`: dueño o soporte; de `draft` o `sent` a `cancelled`.
  - `terminate_studio_contract(p_contract_id uuid, p_reason text, p_end_membership boolean default true)`
    - Cualquiera de las partes o soporte. Pasa de `signed` a `terminated` y deja `terminated_by`.
    - Si `p_end_membership`, la membresía pasa a `ended` y se limpia `current_contract_id`.
  - `expire_studio_contracts(p_studio_id uuid default null) returns int`
    - Toca solo los contratos del caller: los de su estudio si `p_studio_id` es suyo, los suyos si es artista, o todos si es soporte.
    - `sent` vencidos pasan a `expired`.
    - `signed` con `end_date < current_date` pasan a `terminated` ("Fin de vigencia") y su membresía a `ended`.
    - Se llama al listar contratos y al cargar el roster.
- **Parches:**
  - `end_studio_membership` (desde la definición viva): el `signed` vigente pasa a `terminated` ("Vínculo finalizado", `terminated_by`), se limpia `current_contract_id` y los `draft` o `sent` se cancelan.
  - `respond_to_studio_invitation`: lo descrito en M1.
  - `studio_public_roster`: suma `ends_on` desde el contrato firmado.
- **Trigger `inbox_from_studio_contract`** (AFTER INSERT OR UPDATE OF status, SD):
  - Destino: inbox del artista, categoría `invitations`, `context_type 'studio_contract'`, `context_id = contract.id`, deeplink `/artist/invitations?contrato=<id>`.
  - Se dispara con `sent`, `signed`, `declined`, `cancelled`, `terminated` y `expired`.
  - Copia el patrón de `inbox_from_studio_invitation`.

### M3 `20261030202000_studio_agenda_inventory.sql`: agenda e inventario

**Agenda**

- **`studio_bookings`:**
  - Columnas nuevas: `client_phone text`, `service_description text (≤500)`, `deposit_amount numeric(12,2) null check ≥0`, `created_by_role text not null default 'studio' check in ('studio','support')`, `created_by_user_id uuid default auth.uid()`.
  - El status suma `no_show`.
  - El trigger fuerza `created_by_role` según `is_support_user()` e ignora lo que mande el cliente.
- **RLS de `studio_bookings`:**
  - Nueva `studio_bookings_artist_select`: el artista lee las suyas.
  - Nueva `studio_bookings_support_all`.
- **Fuentes de "ocupado"** (idénticas en `artist_busy_conflict` y `list_studio_artist_busy_blocks`):
  - **a)** `artist_calendar_events` con `status <> 'cancelled'` y `event_type in ('confirmed_session','reservation','blocked_day','guest_spot','convention','personal')`.
    - Es el mismo conjunto que `prevent_artist_calendar_overlap` (`20260829145232`).
    - El rango se usa tal cual. Los `weekly` se expanden igual que ese trigger: se copia su `generate_series`, que es `+2 años` con tope de 103 ocurrencias sin `until`, o hasta `until + 1 día`.
  - **b)** `quotation_sessions qs join quotations_db q on q.id = qs.quotation_id`, con `q.artist_id::text = p_artist::text`, `coalesce(qs.status,'') <> 'cancelled'` y rango `[session_date, session_date + coalesce(duration_hours,1) h)`.
  - **c)** `studio_bookings` `confirmed` del mismo artista en **otros** estudios.
- **`private.artist_busy_conflict(p_studio_id uuid, p_artist uuid, p_starts timestamptz, p_ends timestamptz, p_exclude_booking uuid) returns text`**
  - SD. Devuelve null o `'agenda_personal'` | `'otro_estudio'`.
  - Valida al caller: `is_support_user()`, o dueño de `p_studio_id` con el artista `active` allí. Si no, `42501`.
  - Lleva `GRANT EXECUTE` a authenticated y service_role, y `REVOKE` de PUBLIC y anon (private no está expuesto en PostgREST).
- **`validate_studio_booking`** (create or replace desde la definición viva):
  - El lock pasa a `pg_advisory_xact_lock(hashtextextended(NEW.artist_user_id::text, 0))`, la misma clave que `prevent_artist_calendar_overlap`.
  - El chequeo de ocupado corre solo si `NEW.status='confirmed'` y además: es INSERT, o `OLD.status <> 'confirmed'`, o cambian `starts_at`, `ends_at` o `artist_user_id`. Excluye `NEW.id`.
  - Si hay conflicto: `23514`, "{artista} no está disponible en ese horario (agenda personal)" o "(tiene una cita en otro estudio)".
  - **Al completar**, carga los splits en el `studio_jobs_log` que crea, según el contrato vigente o el `revenue_split_pct` de la membresía activa:

    | Modalidad | `artist_split` | `studio_split` |
    | --- | --- | --- |
    | `percentage` / `mixed` | `round(gross*pct/100, 2)` | `gross - artist_split` |
    | `fixed` con `artist_to_studio` | `gross` | `0` |
    | `fixed` con `studio_to_artist` | — | `gross` |
    | Sin datos | null | null |

- **RPCs de agenda** (public SD; dueño o soporte; el artista tiene que estar `active` en el estudio):
  - `check_studio_booking_availability(p_studio_id, p_artist_user_id, p_starts, p_ends, p_exclude_booking uuid default null) returns jsonb {available, reason}`.
  - `list_studio_artist_busy_blocks(p_studio_id uuid, p_from timestamptz, p_to timestamptz) returns table(artist_user_id uuid, starts_at timestamptz, ends_at timestamptz, source text)`.
    - Exige `p_from < p_to` y un rango de 62 días o menos (`22023`).
    - Solo artistas `active`. La recurrencia se recorta al rango.
    - No devuelve título, cliente ni notas.

**Inventario**

- **Tipos de movimiento:** el CHECK de `studio_inventory_movements.kind` suma `assignment` (entrega a artista, resta stock) y `return` (devolución, suma stock). Se agrega el CHECK NOT VALID `kind not in ('assignment','return') or related_artist_user_id is not null`.
- **Trigger nuevo BEFORE INSERT `studio_inventory_movements_prepare`** (`private.prepare_inventory_movement`, INVOKER):
  - El ítem tiene que ser del mismo `studio_id` (`22023`).
  - Completa `unit_cost` con el `cost_per_unit` del ítem cuando viene null.
  - `assignment`: exige membresía `active` del artista en el estudio.
  - `return`: exige que haya existido alguna membresía y que `quantity` no supere el neto entregado de ese ítem a ese artista.
  - Si un movimiento negativo deja el stock por debajo de 0, falla con `23514` "Stock insuficiente de {ítem}".
- **`apply_inventory_movement`** (AFTER, create or replace desde la definición viva, conservando su `search_path`): suma los signos de `assignment` (−) y `return` (+) en las ramas INSERT **y** DELETE.
- **Vista `studio_artist_material_balance`** (security_invoker), por `studio_id`, `artist_user_id`, `item_id`, `item_name`, `unit`, `currency`:

  | Columna | Cálculo |
  | --- | --- |
  | `assigned_qty` | Σ `assignment` |
  | `returned_qty` | Σ `return` |
  | `net_assigned_qty` | `assigned − returned` |
  | `consumed_qty` | Σ `consumption` con ese artista (consumo del stock del estudio) |
  | `assigned_cost` | Σ qty·unit_cost de `assignment` − Σ qty·unit_cost de `return` |
  | `last_movement_at` | último movimiento |

- **Vista `studio_material_assignment_monthly`** (security_invoker): `studio_id`, `month date`, `artist_user_id`, `currency`, `quantity`, `cost`, netos de devoluciones.
- **`list_my_studio_material_assignments() returns table(studio_id, studio_name, item_name, unit, kind, quantity, performed_at)`**: SD, para el artista (`auth.uid()`). Solo devuelve `assignment` y `return`.

### M4 `20261030203000_studio_finance.sql`: gastos, ingresos y storage

**Tabla `studio_finance_entries`**

| Grupo | Columnas |
| --- | --- |
| Identidad | `id`, `studio_id fk cascade`, `location_id null fk set null` |
| Tipo | `entry_type text check in ('expense','income')`, `category text not null` |
| Importe | `description text not null (1–300)`, `amount numeric(12,2) not null check > 0`, `currency text not null check ^[A-Z]{3}$`, `occurred_on date not null default current_date` |
| Pago | `payment_method text null check in ('cash','card','transfer','other')`, `counterparty text null (≤160)` |
| Vínculos | `supplier_id null fk studio_suppliers set null`, `supply_order_id uuid null` (la FK se agrega en M5), `membership_id null fk set null`, `artist_user_id uuid null` |
| Comprobante | `receipt_storage_path text null` |
| Estado | `status text default 'recorded' check in ('recorded','voided')`, `voided_at`, `void_reason` |
| Auditoría | `created_by_user_id`, `created_at`, `updated_at` |

- **Categorías:**
  - Gasto: `rent`, `supplies`, `inventory_purchase`, `salaries`, `artist_payout`, `utilities`, `marketing`, `equipment`, `maintenance`, `taxes`, `fees`, `software`, `other`.
  - Ingreso: `chair_rent`, `merch_manual`, `service_other`, `sponsorship`, `other_income`.
  - Un CHECK cruza tipo con categoría.
  - **`artist_payout` solo se usa para pagos fijos studio_to_artist**, nunca para el porcentaje, que ya va neteado en los trabajos.
- **RLS:** dueño y soporte pueden SELECT, INSERT y UPDATE. DELETE revocado.
- **Guard `private.guard_finance_entry_write()`** (bypass estándar). Para el resto:
  - `supply_order_id` debe quedar null o sin cambios.
  - `membership_id`, `location_id` y `supplier_id` deben ser de `NEW.studio_id`.
  - `receipt_storage_path` es null o `like NEW.studio_id::text || '/finance/%'`.
  - Se fuerza `created_by_user_id := auth.uid()` en INSERT.
  - Las filas `voided` no se editan. Anular es un UPDATE a `voided` con `void_reason`.
- **Unicidad:** índice único parcial `(supply_order_id) where supply_order_id is not null and status='recorded'`.
- **Vista `studio_finance_monthly_by_category`** (security_invoker): `studio_id`, `month date`, `currency`, `entry_type`, `category`, `total`, `entries`. Solo cuenta las filas `recorded`.
- **Storage (arreglo de las policies vivas rotas).** En vivo, las policies de los buckets `studio-*` comparan `storage.foldername(s.name)` de `studios`, no el `name` del objeto. Por eso hoy solo soporte puede subir.
  - Se crea `private.can_manage_studio_storage_path(p_object_name text) returns boolean`: SD, `search_path ''`. Primera carpeta = `studios.id` del dueño, o `is_support_user()`.
  - Se hace DROP y CREATE de las policies de dueño (INSERT, SELECT, UPDATE, DELETE) de `studio-documents`, `studio-photos` y `studio-spot-attachments`, usando `bucket_id = '…' and private.can_manage_studio_storage_path(objects.name)`.
  - Nunca se usa `name` sin calificar dentro de un subquery.
  - Se conservan las lecturas públicas existentes de los buckets públicos.
  - Antes de tocar nada, se leen las policies vivas en `pg_policies` y se recrean con la misma intención.

### M5 `20261030204000_supplies_marketplace.sql`: usuarios Supplies y reposición

**`supply_vendors`** (columnas aptas para lectura pública)

| Grupo | Columnas |
| --- | --- |
| Cuenta | `id`, `user_id uuid null unique fk auth.users set null`, `email text null` (email de login: lo fija el registro desde `auth.users` y solo lo cambia soporte; único parcial `lower(email)`) |
| Perfil | `name not null (≤160)`, `slug unique not null`, `description (≤2000)`, `logo_image`, `cover_image` (CHECK http(s)) |
| Contacto | `contact_email`, `phone`, `whatsapp`, `website`, `instagram` |
| Cobertura | `country`, `city`, `ships_to_countries text[] default '{}'` (ISO-2), `lead_time_days int null` |
| Condiciones | `currency text not null default 'ARS' check ^[A-Z]{3}$`, `min_order_amount numeric(12,2) null`, `platform_discount_pct numeric(5,2) not null default 0 check 0–60`, `free_shipping_threshold numeric(12,2) null`, `benefits text[] default '{}'` (≤10 de ≤160) |
| Estado | `is_verified bool default false`, `is_active bool default true`, `profile_complete bool default false`, `created_at`, `updated_at` |

**Tablas privadas del vendor**

- **`supply_vendor_private`** (PK/FK `vendor_id` cascade): `legal_name`, `tax_id`, `fiscal_address`, `billing_email`, `notes`. RLS: dueño y soporte.
- **`supply_vendor_counters`** (PK/FK `vendor_id`): `order_seq int not null default 0`. Sin acceso de clientes; solo la usan las RPC.

**`supply_products`**

| Grupo | Columnas |
| --- | --- |
| Identidad | `id`, `vendor_id fk cascade`, `sku text null` (único por vendor si no es null), `name not null (≤160)`, `brand`, `description (≤2000)` |
| Clasificación | `category text not null check in ('inks','needles_cartridges','gloves','paper_film','hygiene','aftercare','machines','power_supplies','furniture','piercing','other')` |
| Presentación | `unit_label text not null default 'unidad'`, `pack_size numeric(12,2) null check > 0` |
| Precio | `price numeric(12,2) not null check ≥0`, `currency text not null`, `compare_at_price numeric(12,2) null` |
| Stock | `stock_quantity numeric(12,2) null check (stock_quantity is null or stock_quantity ≥ 0)`, `min_order_qty numeric(12,2) not null default 1 check > 0` |
| Imágenes y estado | `image_url` (CHECK http(s)), `images jsonb default '[]'`, `is_active bool default true`, `created_at`, `updated_at` |

- Un trigger exige `currency = vendor.currency`.

**`supply_discount_tiers`**

- Columnas: `id`, `vendor_id fk cascade`, `min_subtotal numeric(12,2) not null check ≥0`, `currency text not null` (= `vendor.currency`), `discount_pct numeric(5,2) not null check > 0 and ≤60`, `label text`.
- Único `(vendor_id, currency, min_subtotal)`.

**`supply_orders`**

| Grupo | Columnas |
| --- | --- |
| Identidad | `id`, `order_number text not null` (`P-YYYY-NNNNN`, único por vendor), `studio_id fk restrict`, `vendor_id fk restrict`, `location_id null fk set null` |
| Estado | `status text not null default 'submitted' check in ('submitted','confirmed','rejected','shipped','delivered','received','cancelled')` |
| Importes (`numeric(12,2)`) | `currency`, `subtotal`, `platform_discount_pct`, `tier_discount_pct`, `discount_amount`, `shipping_amount default 0`, `total` |
| Notas y envío | `notes (≤1000)`, `vendor_note (≤1000)`, `tracking_code (≤120)`, `estimated_delivery date` |
| Fechas | `submitted_at`, `confirmed_at`, `shipped_at`, `delivered_at`, `received_at`, `cancelled_at`, `rejected_at` |
| Recepción y auditoría | `receive_result jsonb`, `created_by_user_id`, `created_at`, `updated_at` |

**`supply_order_items`**

- Vínculos: `id`, `order_id fk cascade`, `product_id null fk set null`, `inventory_item_id null fk studio_inventory_items set null`.
- Snapshot del producto: `product_name`, `sku`, `unit_label`, `pack_size`, `category`.
- Cantidades: `quantity numeric(12,2) check > 0`, `received_quantity numeric(12,2) null`, `stock_decremented numeric(12,2) not null default 0`.
- Importes: `unit_price`, `line_subtotal`, `line_discount`, `line_total`.

**`supply_order_events`**

- Columnas: `id`, `order_id fk cascade`, `from_status`, `to_status`, `actor_user_id`, `actor_role text check in ('studio','vendor','support')`, `note`, `created_at`.

**Columnas nuevas en tablas existentes**

- `studio_suppliers.vendor_id uuid null fk supply_vendors set null`, con único parcial `(studio_id, vendor_id) where vendor_id is not null`.
- `studio_inventory_items.supply_product_id uuid null fk supply_products set null`.
- FK `studio_finance_entries.supply_order_id` hacia `supply_orders(id) on delete set null`.

**RLS**

- `supply_vendors`:
  - SELECT para anon y authenticated cuando `is_active` y `is_verified`.
  - El dueño ve su fila siempre; soporte ve todo.
  - UPDATE: dueño o soporte. No hay INSERT directo (se crea por RPC).
- **Guard `private.guard_supply_vendor_write()`** (bypass estándar): para el dueño rechaza cambios de `is_verified`, `user_id`, `email` y `slug` (`42501`).
- `supply_products` y `supply_discount_tiers`:
  - SELECT para authenticated cuando el producto y el vendor están activos y el vendor está verificado; el dueño ve todo.
  - INSERT, UPDATE y DELETE: dueño del vendor o soporte. Los productos se archivan con `is_active=false`.
- `supply_orders`, `supply_order_items` y `supply_order_events`:
  - SELECT: dueño del estudio del pedido, dueño del vendor y soporte.
  - **Sin escritura directa.**

**RPCs** (SD; validan la pertenencia cruzada de sede, ítems y líneas)

- **`complete_supply_vendor_registration(p_profile jsonb) returns public.supply_vendors`** (fila completa)
  - Es un wrapper INVOKER que llama a una función `private.*` SD.
  - Toma un advisory lock por uid, exige email confirmado y arma el slug con el nombre más un prefijo del uid.
  - Fija `user_id`, `email` (de `auth.users`) e `is_verified=false`.
  - Admite una lista blanca de claves y crea las filas de `supply_vendor_private` y `supply_vendor_counters`.
  - Es idempotente: si ya existe, devuelve la fila.
- **`handle_new_user`** se parchea con el patrón de `20260922012500`: `pg_get_functiondef`, luego `replace` de `NOT IN ('client', 'studio')` por `NOT IN ('client', 'studio', 'supplies')`, luego `execute`. Si el texto no aparece, la migración falla.
- **`submit_supply_order(p_studio_id uuid, p_vendor_id uuid, p_location_id uuid, p_items jsonb, p_notes text default null) returns jsonb`**
  - `p_items` es `[{product_id, quantity, inventory_item_id?}]`.
  - Lo usa el dueño o soporte.
  - Validaciones:
    - productos activos del vendor, en su moneda;
    - `quantity ≥ min_order_qty`;
    - stock suficiente si se controla (chequeo blando);
    - cada `inventory_item_id` pertenece al estudio;
    - la sede pertenece al estudio;
    - el vendor está verificado y activo;
    - se cumple el mínimo de compra.
  - Importes:
    - `line_subtotal = round(unit_price·qty, 2)`.
    - `subtotal = Σ line_subtotal`.
    - `pct = least(60, platform + mejor tier con min_subtotal ≤ subtotal)`.
    - `discount_amount = round(subtotal·pct/100, 2)`.
    - `line_discount = round(line_subtotal·pct/100, 2)`. La diferencia de redondeo la absorbe la línea de mayor subtotal, para que la suma coincida.
    - `line_total = line_subtotal − line_discount`.
    - `total = subtotal − discount_amount`. El envío se suma al confirmar.
  - El número se toma con `FOR UPDATE` de `supply_vendor_counters`. Se registra un evento.
- **`cancel_supply_order(p_order_id uuid, p_note text default null)`**: el estudio puede cancelar desde `submitted` o `confirmed`, antes de `shipped`. Desde `confirmed` restaura exactamente `stock_decremented`.
- **`vendor_update_supply_order(p_order_id uuid, p_action text, p_shipping_amount numeric default null, p_tracking_code text default null, p_estimated_delivery date default null, p_note text default null) returns jsonb`** (dueño del vendor o soporte). Acciones:

  | Acción | Transición | Efecto |
  | --- | --- | --- |
  | `confirm` | `submitted→confirmed` | `FOR UPDATE` de los productos ordenados por id. Falla con `23514` "Stock insuficiente para {producto}" si no alcanza. Descuenta el stock y lo guarda en `stock_decremented`. `shipping_amount = 0` si `(subtotal − discount_amount) ≥ free_shipping_threshold`; si no, toma `p_shipping_amount` o 0. `total = subtotal − discount_amount + shipping_amount`. |
  | `reject` | `submitted→rejected` | — |
  | `ship` | `confirmed→shipped` | Guarda el tracking. |
  | `deliver` | `shipped→delivered` | — |
  | `cancel` | `confirmed→cancelled` | Restaura `stock_decremented`, solo en productos que existen y controlan stock. |

- **`receive_supply_order(p_order_id uuid, p_lines jsonb default null) returns jsonb`**
  - `p_lines` es `[{item_id, received_quantity}]`. Lo usa el dueño del estudio o soporte, desde `shipped` o `delivered`.
  - `FOR UPDATE` del pedido. Si ya está `received`, devuelve `receive_result` (idempotente).
  - Valida que cada `item_id` sea del pedido y que `0 ≤ received_quantity ≤ quantity`.
  - Por cada línea con cantidad recibida mayor a 0:
    1. Resuelve el ítem en este orden: `inventory_item_id`, luego el ítem del estudio con `supply_product_id`, luego `(studio_id, sku)`. Si no encuentra ninguno, crea uno:
       - `unit` = 'unidad' si hay `pack_size`; si no, `unit_label`;
       - categoría del snapshot y moneda del pedido;
       - `sku` solo si no existe;
       - `supply_product_id`;
       - `cost_per_unit` = costo efectivo.
    2. Asegura el `studio_suppliers` con `vendor_id` (`on conflict do nothing`).
    3. Inserta un movimiento `restock` con:
       - `quantity = received × coalesce(pack_size, 1)`;
       - `unit_cost = line_total / (quantity × coalesce(pack_size, 1))`.
       - Si la moneda del ítem no coincide, `unit_cost` queda null y se marca `currency_mismatch`.
  - **Gasto:**
    - Importe: `Σ round(line_total·received/quantity, 2) + shipping_amount`.
    - Si es mayor a 0, crea `studio_finance_entries`: `expense`, `inventory_purchase`, con `supply_order_id`, `counterparty` = nombre del vendor y `supplier_id`.
  - Pasa a `received` y guarda `receive_result`: ítems, movimientos, gasto, faltantes y mismatches. Si hay faltantes, el evento dice "Recepción parcial".
- **Vistas** (security_invoker):
  - `supply_vendor_sales_monthly`: `vendor_id`, `month`, `currency`, `orders`, `gross`, `discounts`, `shipping`, `net`, `units`. Cubre los pedidos `confirmed`, `shipped`, `delivered` y `received`.
  - `supply_vendor_customers`: `vendor_id`, `studio_id`, `studio_name`, `orders`, `last_order_at`, `currency`, `total`.
- **Storage:** bucket público `supply-photos`.
  - `allowed_mime_types` jpeg, png y webp (sin svg); `file_size_limit` 10 MB.
  - Policies de INSERT, UPDATE y DELETE con `private.can_manage_supply_storage_path(objects.name)`: primera carpeta = `supply_vendors.id` del dueño, o soporte.
  - No hay policy SELECT amplia: las URLs públicas no la necesitan.

### M6 `20261030205000_studio_store.sql` (cuando Store commitee `20261030150000_store_core.sql`)

- `create_store_pos_order(...)`: venta en mostrador, canal `pos`, cobrada por el vendedor.
- `get_public_storefront` rama `studio`: el handle es el slug.
- Ajustes de la rama studio de `store_can_manage_seller`.
- Reportes con `get_store_sales_report('studio', studio_id, from, to)`.

## Repos de frontend (`public/shared/js/data/`)

- **Estilo:** el de `studios-repo.js`. Devuelven el builder o la RPC sin resolver (`{data,error}`) y nunca lanzan.
- **Encabezado:** cada repo declara qué tablas cubre.
- **Restricción de `studios-repo.js`:** solo usa `window`, `console`, `Date` y `Promise` en el nivel superior, porque el test lo corre en una VM.

**`studios-repo.js`** (agregados; W-REPO)

| Namespace | Método | Detalle |
| --- | --- | --- |
| `StudioMemberships` | `listRequestsForStudio(studioId)` | Status `requested`, embebe `studio_membership_request_details` y `artists_db` (`name, username, profile_picture, styles`). |
| | `requestMembership({studioId, role, locationId, message, portfolioUrl, proposedStartDate})` | |
| | `decideRequest(membershipId, 'accept'\|'reject', {role, locationId})` | |
| | `withdrawRequest(membershipId)` | |
| | `listRequestsForArtist(artistUserId)` | Embebe el estudio, incluido `user_id` para saber si tiene dueño. |
| | `listChangeRequestsForStudio(studioId)` | `studio_invitation_change_requests` pending con su membresía y su artista. |
| | `closeChangeRequest(id)` | UPDATE `status='declined'`; la RLS lo permite al estudio. |
| | `listActiveRosterWithArtists(studioId)` | **Cambio autorizado:** lee de `studio_public_roster` y, si da `42P01`/`PGRST205`, cae a la tabla actual. |
| | `listForArtistV2(artistUserId)` | `INVITE_COLS` + `initiated_by`, `current_contract_id`, con fallback a `INVITE_COLS`. Los métodos existentes no cambian. |
| | `listRosterV2(studioId)` | Mismas columnas y filtro que `listRoster` + `initiated_by`, `current_contract_id`, con fallback a `listRoster`. |
| `StudioSpots` | `decideApplicationRpc(appId, status)` | RPC `decide_studio_spot_application`. |
| | `listOpenByStudio(studioId)` | Status `open`: `title`, `kind`, `start_date`, `end_date`, `application_count`, `benefit_tags` (con fallback sin `benefit_tags`). |
| | `listArtistCounterOffersForStudio(studioId)` | `studio_spot_counter_offers` con `author_role='artist'` y `pending`, con postulación, spot y artista. |
| | `respondCounterOffer(id, decision)` | Reutiliza la RPC existente. |
| `StudioOps` | `listBookingsRange(studioId, fromIso, toIso)` | |
| | `checkBookingAvailability(studioId, artistUserId, startsIso, endsIso, excludeId)` | |
| | `listArtistBusyBlocks(studioId, fromIso, toIso)` | |
| | `listBookingsForArtist(artistUserId, fromIso, toIso)` | Embebe `studios(name, slug)`. |
| | `listMaterialBalance(studioId)` | |
| | `listMaterialAssignmentsMonthly(studioId, fromDate, toDate)` | |
| | `listMyMaterialAssignments()` | |
| | `listMonthlyMetrics(studioId, fromDate, toDate)` | `studio_monthly_metrics_by_currency` con `gte`/`lte` sobre el mes. |
| | `listRestockCandidates(studioId)` | Columnas de `listInventoryItems` + `supply_product_id` y embed `supply_products(id, name, price, currency, vendor_id, unit_label, pack_size)`, con fallback sin el embed. |
| | `listInventoryMovements(itemId)` | **Cambio autorizado:** el select suma `unit_cost` y `related_artist_user_id`. Las columnas existen en vivo. El nombre del artista se resuelve en el cliente. |
| `Studios` | `listUnownedStudios(query)` | RPC. |
| | `requestClaim(studioId, evidence, contactName, contactPhone)` | |
| | `getMyClaim()` | |

**`studio-contracts-repo.js`** → `WeotziData.StudioContracts`

| Grupo | Métodos |
| --- | --- |
| Listado | `listForStudio(studioId, {status})` (`status` es un string o un array; embebe `artists_db` y el título del spot), `listForArtist(artistUserId, {status})` (embebe el estudio), `get(id)`, `getCurrentForMembership(membershipId)` |
| Borrador | `saveDraft(obj)`, `prepareFromApplication(applicationId)`, `prepareForMembership(membershipId)` |
| Ciclo de vida | `issue(id, signerName, expiresAt)`, `sign(id, signerName, acceptTerms)`, `decline(id, reason)`, `cancel(id, reason)`, `terminate(id, reason, endMembership)`, `expireOverdue(studioId)` |

**`studio-finance-repo.js`** → `WeotziData.StudioFinance`

- `listEntries(studioId, {from, to, type, category, includeVoided})`, paginado con `allRows`.
- `saveEntry(obj)` y `voidEntry(id, reason)`.
- `monthlyByCategory(studioId, from, to)`.

**`supplies-repo.js`** → `WeotziData.Supplies` (también exportable a Node para `estimateOrder`)

| Grupo | Métodos |
| --- | --- |
| Vendors | `getVendorByUserId(uid)`, `getVendor(id)`, `getVendorBySlug(slug)`, `listVendors({search})`, `updateVendor(id, patch)`, `getVendorPrivate(id)`, `saveVendorPrivate(id, patch)`, `completeRegistration(profile)` |
| Productos | `listProducts(vendorId, {includeInactive})`, `searchCatalog({search, category, vendorId, limit})` (embebe el vendor con `name`, `slug`, `logo_image`, `currency`, `platform_discount_pct`, `benefits`, `free_shipping_threshold`, `min_order_amount`, `ships_to_countries`, `is_verified`), `saveProduct(obj)`, `archiveProduct(id)` |
| Tiers | `listTiers(vendorId)`, `saveTier(obj)`, `deleteTier(id)` |
| Pedidos | `listOrdersForStudio(studioId, {status})`, `listOrdersForVendor(vendorId, {status})`, `getOrder(id)` (con ítems, eventos, estudio, sede y vendor), `submitOrder({studioId, vendorId, locationId, items, notes})`, `cancelOrder(id, note)`, `receiveOrder(id, lines)`, `vendorUpdateOrder(id, action, {shippingAmount, trackingCode, estimatedDelivery, note})` |
| Reportes | `vendorSalesMonthly(vendorId, from, to)`, `vendorCustomers(vendorId)` |
| Cálculo | `estimateOrder(vendor, tiers, lines)` (pura). Calcula en centavos enteros con la misma regla que el servidor. Devuelve `{subtotal, pct, discount, total, freeShipping, belowMinimum}`. El servidor siempre recalcula. |

## Servidor (dueño: W-SERVER)

### Repos nuevos

- **`lib/repos/studios.js`**: `getStudioOwnerContact(studioId)` (email de `auth.users` de `studios.user_id`, o null), `getMembershipWithParties(id)`, `getContractWithParties(id)`, `getBookingWithParties(id)`, `getArtistContact(userId)`, `getClaimWithParties(id)`, `listPendingClaims()`.
- **`lib/repos/supplies.js`**: `getOrderWithParties(id)`, `getVendorOwnerContact(vendorId)`, `getVendorByUserId(uid)`.

### Endpoints de notificación

Body común `{kind, <id>}`. Respuesta `{success, sent, delivery_status}`. Cada kind verifica en el servidor la fila, la pertenencia y el **estado persistido** que corresponde al kind. Si el envío falla, la acción ya guardada **no** se revierte.

| Endpoint | Caller | Kinds | Body | Destinatario |
| --- | --- | --- | --- | --- |
| `POST /api/studio/notify` | dueño o soporte | `roster_invite`, `spot_decision` (existentes) | — | — |
| | | `membership_request_decision` | `{membership_id}` | el artista |
| | | `contract_issued`, `contract_terminated` | `{contract_id}` | el artista |
| | | `booking_created`, `booking_cancelled` | `{booking_id}` | **solo el artista**, nunca `client_email` |
| `POST /api/artist/studio-notify` | el artista de la fila | `membership_request_created` | `{membership_id}` | el dueño del estudio; nada si no tiene |
| | | `contract_signed`, `contract_declined`, `contract_terminated` | `{contract_id}` | el dueño del estudio |
| `POST /api/supplies/notify` | dueño del estudio | `order_submitted`, `order_cancelled`, `order_received` | `{order_id}` | dueño del vendor |
| | dueño del vendor | `order_confirmed`, `order_rejected`, `order_shipped`, `order_delivered` | `{order_id}` | dueño del estudio |

Reglas de los endpoints:

- **Test `studio-notify-auth`:** cada kind de `/api/studio/notify` llama a `_verifyStudioNotifyAccess` y el test `studio-notify-auth` se ajusta. `function roleFromKind` queda inmediatamente después de la ruta.
- **Idempotencia:** `idempotencyKey = ${kind}:${id}:${estado}`. Para `membership_request_created` la clave es `${kind}:${studio_id}:${artist_user_id}:${YYYY-MM-DD}`.
- **Rate limit:** `studioNotifyLimiter` usa `keyGenerator` = id del usuario autenticado (fallback IP), 60 cada 15 min, en los 3 endpoints.

### Emails

- **Eventos nuevos en `services/email-event-mapping.js`:**
  - `studio_membership_request_created`, `studio_membership_request_decision`
  - `studio_contract_issued`, `studio_contract_signed`, `studio_contract_declined`, `studio_contract_terminated`
  - `studio_booking_created`, `studio_booking_cancelled`
  - `supply_order_submitted`, `supply_order_status`
  - Todos con `templateHint 'studio-notification'`.
- **Eventos internos:** en `services/email-request-context.js`, el set `INTERNAL_ONLY_EVENTS` (todos los `studio_*` y `supply_*`, más `studio_roster_invite` y `studio_spot_decision`) devuelve 403 en `POST /api/email/:eventId`.
- **Copy:** el email `spot_decision` aceptado pasa a "Tu postulación avanzó; el estudio te va a enviar el contrato para firmar en /artist/invitations".

### Registro de artista

Afecta a `/api/register/artist-finalize`, `persistRegistrationStudioAssociations` y `lib/artist-registration.js`.

- **Membresía:** se deja de usar `on_conflict`.
  1. Se lee la fila abierta del par.
  2. Si no hay, se hace un POST simple con `status:'requested'`, `initiated_by:'artist'`, `role:'resident'` e `invited_at`, más su `studio_membership_request_details`.
  3. Un `23505` cuenta como éxito.
  4. Si falla con `23514`/`PGRST204`/`42703` (migración no aplicada), se reintenta con el payload legacy (`active`, sin `initiated_by`) y se registra un warn.
  5. Un error de membresía **no** revierte el registro: se loguea y la respuesta lleva `membership_pending: false`.
- **Lo que se deja de escribir:**
  - `artists_db.studio_id`;
  - `artists_db.estudios`, cuando la membresía queda `requested`;
  - `artist_tattoo_locations.studio_id`: se guarda null. `studio_name` es `NOT NULL` + CHECK `char_length(btrim(studio_name)) > 0` en vivo, así que queda el nombre del estudio **como texto** (mayúsculas, igual que `register.js`) junto con la ciudad. Si no hay nombre, no se escribe la fila. Es best-effort: un error acá no revierte el registro.
- **Mapa:** `buildLocationPatch` guarda en `artists_db` las coordenadas y la dirección de la sede elegida, aunque `work_type` sea `studio`. Así el artista sigue en el mapa mientras la solicitud está pendiente.
- **Sedes:** si el estudio tiene dueño, no se crean ni modifican sus sedes ni `primary_location_id`.
- **Tests:** se actualiza `tests/artist-registration.test.js`.

### Otros cambios

- `_detectUserRole` reconoce `studio` (`studios.user_id`) y `supplies` (`supply_vendors.user_id`).
- `POST /api/auth/reset-temp-password` acepta `userType: 'supplies'`: resuelve por `supply_vendors.email` (único, de login) y exige que `user_id` coincida.
- **Backoffice:**
  - `GET /api/admin/studio-claims` lista los reclamos pendientes con estudio y usuario.
  - `POST /api/admin/studio-claims/:id/decide` acepta `{decision: 'approve'|'reject', note}`. Llama a `decide_studio_claim` con el JWT del caller, que debe ser soporte.
  - `GET /api/admin/supply-vendors` lista los vendors.
  - `PATCH /api/admin/supply-vendors/:id` acepta `{is_verified, is_active}`.
- **`ADMIN_DATABASE_TABLES`:**
  - Suma tablas y vistas nuevas, además de `studio_bookings` y las vistas `*_by_currency`.
  - Con `readonly: true` quedan `studio_contracts`, `studio_membership_request_details`, `studio_finance_entries`, `supply_orders`, `supply_order_items`, `supply_order_events` y `studio_claim_requests`.
  - `ADMIN_DATABASE_WRITABLE` excluye `kind==='view' || readonly`.

## Frontend del estudio (`/studio/dashboard`)

### Shell (W-SHELL: `public/studio/dashboard/index.html`, `studio-dashboard.js`)

**Sidebar agrupada**

Cada grupo es un `div.sk-sidebar-group > p.sk-sidebar-group-title + a.studio-dash-tab`. Cada pestaña puede tener `span.sk-tab-badge`.

| Grupo | Pestañas |
| --- | --- |
| Estudio | Inicio `inicio` (default; `is-active` se mueve acá en el HTML) · Perfil `perfil` · Sedes `sedes` · Cuenta `cuenta` |
| Equipo | Roster `roster` · Solicitudes `solicitudes` · Spots `spots` · Contratos `contratos` · Agenda `agenda` · Travel `travel` |
| Operación | Operaciones `ops` · Inventario `inventory` · Reposición `reposicion` · Proveedores `suppliers` · Sponsors `sponsors` |
| Negocio | Tienda `tienda` · Finanzas `finanzas` · Reportes `analytics` (cambia la etiqueta, se mantiene el id) |

**Paneles nuevos:** `section.studio-dash-panel[data-panel=<tab>]` con `div[data-module-root]`. Además:
- `div#inventory-materials[data-module-root]` dentro del panel `inventory`.
- `div#reports-extended[data-module-root]` arriba del contenido de `analytics`.
- El root de cada módulo es el **primer** `[data-module-root]` de su panel. Hay un módulo por pestaña.

**Registro sincrónico `window.WeOtziStudioAdmin`**, creado al principio del IIFE de `studio-dashboard.js` (antes del DOMContentLoaded):
- `register(tab, {mount(root, ctx), show?(root, ctx, params)})`
  - Las registraciones se guardan en buffer.
  - Cuando el contexto queda resuelto, si la pestaña ya está activa se monta en el momento.
- `getContext(): Promise<ctx>`, con `ctx = {studio, studioId, userId, client, data: window.WeotziData, kit: window.WeOtziStudioKit, navigate(tab, params), setBadge(tab, n), notify(payload), refresh()}`
  - `notify` reusa `notifyStudio` y hace POST a `/api/studio/notify`.
- `activate(tab, params)` es el **único** punto de entrada.
  - Es idempotente por tab+params.
  - Monta en la primera visita y llama a `show` en cada una.
  - Click y `hashchange` lo llaman sin duplicar.
- `navigate(tab, params)` llama a `activate` y después hace `history.replaceState` del hash.
- `setBadge(tab, n)` y `onRosterRender(cb)`.
  - `renderRosterTable` llama a `WeOtziStudioAdmin._emitRosterRender(tableEl, members)` al final.
- El regex de hash `^[a-z]+$` se mantiene. Sin hash, se activa `inicio`.

**Cambios en Roster** (en `studio-dashboard.js`)

- Si la fila tiene `current_contract_id` (viene de `listRosterV2`, con fallback), los selects de rol y split quedan deshabilitados con el aviso "Se edita con una nueva versión del contrato".
- Se quita "Reactivar" para las filas `ended`. Para `paused`, el botón se mantiene.
- El buscador de invitación, si no encuentra resultados, muestra "¿No está en We Ötzi? Compartile el link de registro" con un botón para copiar `/register-artist`.

**Cambios en Spots**

- **Editor:** se suman las listas "Qué incluye" (`studio_includes`), "Beneficios" (`benefit_tags`, hasta 6), "Qué esperamos" (`artist_expectations`) y "Requisitos" (`minimum_requirements`).
- **Modalidad:** porcentaje, fijo o mixto. Campos `revenue_split_pct` para el porcentaje, y para el fijo `fixed_amount`, `fixed_currency` (select ISO: ARS, USD, EUR, BRL, CLP, MXN, COP, UYU, PEN), `fixed_period` y `fixed_payer`. El stipend sigue disponible.
- **Columnas nuevas:** se envían solo si existen. Si da `PGRST204`/`42703`, se reintenta sin ellas y se avisa.
- **Aceptar una postulación:** llama a `await window.WeOtziStudioContracts.openFromApplication({id, artist_user_id}, {id, title, kind})`, que devuelve `{contractId, issued}`. Después refresca las postulaciones, los spots y el roster.
- **Fallback:** sin el módulo de contratos o sin la RPC (`42883`/`PGRST202`), usa el flujo actual `decideApplicationRpc` + `spot_decision`.
- **Rechazar:** `decideApplicationRpc(id, 'rejected')` + `spot_decision`.
- **Copy:** el toast y el hint pasan a "Postulación aceptada: revisá y emití el contrato para sumarlo al roster". El toast viejo "sumado al roster" se va.
- **Badges al iniciar:** solicitudes pendientes, más cambios pedidos y contraofertas; contratos `sent` o por vencer. Si falla la carga, se ignora.

### Alta y reclamo de estudio (W-ONBOARD: `studio-register.js`, `studio-auth.js`, `public/studio/register/index.html`, `public/studio/login/index.html`)

- **Paso 1 del registro:** el buscador "¿Tu estudio ya figura en We Ötzi?" usa `listUnownedStudios`.
  - Si el estudio aparece, "Es mi estudio → Reclamar" crea la cuenta (signUp con borrador `user_metadata.studio_claim = {studio_id, evidence, contact_name, contact_phone}`).
  - Después de confirmar el email, `requestClaim`.
- **`studio-auth.js` con sesión y sin estudio:**
  - Si hay reclamo pendiente: la pantalla "Reclamo en revisión" (estudio, fecha, "Te avisamos por email") en lugar de redirigir.
  - Si el reclamo fue rechazado: muestra el motivo y la opción de registrar un estudio nuevo.
- **Error de `complete_studio_registration` por nombre ya existente:** se ofrece reclamar ese estudio.

### Kit compartido (W-KIT): `public/shared/js/studio-admin-kit.js` → `window.WeOtziStudioKit`

IIFE. Exporta a Node con `module.exports` cuando existe.

**Formato y fechas**
- `escapeHtml`, `escapeAttr`, `safeUrl(u)`.
- `fmtMoney(n, cur)`: `Intl es-AR` currency, con fallback "$ 1.234 ARS".
- `sumByCurrency(rows, amountKey, currencyKey)`, `fmtTotals(map)`.
- `fmtDate`, `fmtDateTime`, `fmtTime`, `toDateInput`, `toLocalInput`, `fromLocalInput`, `monthKey`, `monthLabel`.
- `periodRange(preset, custom)`. Presets: `this_month`, `last_month`, `last_3_months`, `last_6_months`, `last_12_months`, `this_year`, `custom`.

**Etiquetas y badges**
- `LABELS`, en español: `membershipStatus`, `membershipRole`, `initiatedBy`, `contractStatus`, `contractOrigin`, `compensationModel`, `fixedPeriod`, `fixedPayer`, `bookingStatus`, `movementKind`, `financeCategory`, `paymentMethod`, `supplyOrderStatus`, `supplyCategory`, `claimStatus`.
- `label(dict, value)`.
- `badge(text, tone)` con tonos `neutral`, `info`, `success`, `warning`, `danger`, y `statusBadge(dict, value)`.

**UI**
- `toast(msg, tone, {timeout, persist})`.
- `confirmDialog({title, body, confirmLabel, tone}) → Promise<boolean>`.
- `promptDialog({title, label, placeholder, required}) → Promise<string|null>`.
- `openModal({title, body, actions, size})` y `openDrawer({title, body, width})` → `{el, close}`.
  - Modales y drawers manejan el foco y cierran con Esc.
  - Se montan en `document.querySelector('.studio-page') || document.body`.
- `emptyState({title, body, actionHtml})`.
- `renderTable({columns, rows, emptyText})`.
- `barChart({items, format})`.

**Utilidades**
- `guarded(btn, asyncFn)`, `unwrap(res)`, `friendlyError(err)`, `isMissingSchema(err)`.
- `downloadCsv(filename, columns, rows)`: BOM y separador `;`.
- `debounce`, `readForm`.
- `listEditor({items, max, maxLen, placeholder}) → {el, getItems}`: lista editable de chips o líneas, para "Qué incluye", "Beneficios", etc.
- `postNotify(path, payload, client)`: hace POST con el Bearer de la sesión. Nunca lanza: devuelve `{ok, data}`.

**CSS del kit** (`studio-admin-kit.css`, prefijo `sk-`)
- Clases: `sk-modal`, `sk-drawer`, `sk-toast-stack`, `sk-badge--*`, `sk-kpis`, `sk-kpi`, `sk-toolbar`, `sk-chips`, `sk-chip[aria-pressed]`, `sk-table`, `sk-empty`, `sk-bars`, `sk-section`, `sk-subtabs`, `sk-grid-2`, `sk-field`, `sk-list-editor`, `sk-sidebar-group`, `sk-sidebar-group-title`, `sk-tab-badge`.
- `sk-sidebar-group` es columna desde 900px. Por debajo de 900px pasa a `display: contents` y el título se oculta.
- Tokens de `.studio-page`, radio 0, sombra dura solo en hover, impresión (`@media print`) para documentos.

### Módulos

**Inicio** (W-HOME, `studio-dashboard-home.js`)
- Pendientes, con enlaces vía `navigate`:
  - solicitudes y cambios pedidos;
  - contratos enviados, por vencer (3 días o menos) y vencidos;
  - citas de hoy y de mañana;
  - stock bajo;
  - pedidos de reposición en camino o por recibir, y totales actualizados por proveedores;
  - spots con postulaciones nuevas.
- KPIs del mes por moneda: tatuajes, ingreso del estudio y gastos.
- Si una fuente falla por migración pendiente, esa tarjeta se oculta.

**Solicitudes** (W-TEAM, `studio-dashboard-requests.js`)

Tiene tres sub-pestañas:

- **Altas:**
  - Muestra avatar, nombre, @username, estilos, mensaje, portfolio (`safeUrl`), rol, fecha propuesta y antigüedad.
  - "Aprobar": modal de rol y sede → `decideRequest('accept')` → `ctx.notify({kind:'membership_request_decision', membership_id})`.
  - "Aprobar con contrato": `prepareForMembership` → editor de contrato.
  - "Rechazar": confirma y notifica.
- **Cambios pedidos:**
  - "Responder con contrato": `prepareForMembership` → editor.
  - "Cerrar": `closeChangeRequest`.
- **Contraofertas** del artista:
  - Aceptar o rechazar con `respondCounterOffer`.
  - Si se acepta: `prepareFromApplication` → editor.

**Contratos** (W-TEAM, `studio-dashboard-contracts.js`)

- **Global:** `window.WeOtziStudioContracts = {openFromApplication(app, spot) → Promise<{contractId, issued}>, openForMembership(membership) → Promise<{contractId, issued}>, openEditor(contractId)}`.
- **Listado:** filtros por estado; columnas número, versión, artista, rol, modalidad, vigencia, estado, enviado y firmado. Llama a `expireOverdue` al cargar.
- **Editor** (drawer grande):
  - Partes, rol y sede.
  - Modalidad:
    - Porcentaje: % para el artista y el % del estudio calculado.
    - Fijo: monto, moneda ISO, periodicidad y quién paga ("Alquiler de puesto: el artista paga al estudio" / "Pago al artista: el estudio paga").
    - Mixto.
  - Vigencia y preaviso.
  - `listEditor` de "Qué incluye el spot", "Beneficios" y "Obligaciones del artista".
  - Normas y cláusulas.
  - Vista previa.
  - Botones "Guardar borrador" y "Emitir y firmar": `promptDialog` para el nombre del firmante, más el vencimiento (14 días por defecto). Emitir llama a `issue` y después a `ctx.notify({kind:'contract_issued', contract_id})`.
- **Vista de contrato emitido o firmado:**
  - Documento imprimible (`window.print` + `@media print`), con hash, firmas, estado y versión.
  - Acciones: cancelar (si está `sent`), rescindir (si está `signed`; luego `notify contract_terminated`) y nueva versión (borrador con `supersedes_contract_id`).
- **Roster:** con `onRosterRender`, inyecta `button[data-contract-for=<membership_id>]` "Contrato" en las filas activas o pendientes que no son `manager`. Abre el contrato vigente o prepara uno.

**Agenda** (W-AGENDA, `studio-dashboard-agenda.js` + `studio-agenda.css`)

- **Vistas:**
  - Día: columnas = artistas activos, filas 08–23 en tramos de 30 minutos.
  - Semana: columnas = días; tarjetas con color por artista.
  - Lista.
- **Ocupado:** los bloques "Ocupado" se muestran en gris, sin detalle (`listArtistBusyBlocks`, rango de 62 días o menos).
- **Filtros:** artista y sede.
- **Modal de cita:**
  - Campos: artista, sede, fecha, inicio y fin, cliente (nombre, email, teléfono), servicio, importe, seña, moneda y notas.
  - Chequeo en vivo con `checkBookingAvailability` (debounce de 400 ms).
- **Acciones:**
  - Editar, Cancelar (`notify booking_cancelled`), No asistió.
  - Completar: lanza `document.dispatchEvent(new CustomEvent('weotzi:studio-jobs-changed'))`.
- Crear una cita notifica `booking_created`.
- **Del lado del artista:**
  - `calendar-repo.js` suma la proyección `listStudioBookingsProjection`, solo si existe `D.StudioOps?.listBookingsForArtist`.
  - Cada evento lleva `type:'confirmed_session'` (cuenta como bloqueante), `sourceType:'studio_booking'`, `sourceId`, `readonly:true`, `href:null` y el título "Cita en {estudio}: {cliente}". Solo las citas confirmadas.
  - `public/calendar/index.html` carga `/shared/js/data/studios-repo.js` entre `postgrest-client.js` y `calendar-repo.js`.
  - `calendar.js` (solo `openEventById`): un evento readonly con `sourceType==='studio_booking'` muestra el toast "{título} · la gestiona el estudio".

**Inventario** (W-INV: `studio-dashboard-ops.js` + `studio-dashboard-materials.js`)

- **Cambios en `studio-dashboard-ops.js`:**
  - Se quita la agenda vieja: `wireBookingPanel`, `renderBookings` y `openBookingEditor`, su llamada y `'bookings'` del array del subnav.
  - `ops` escucha `weotzi:studio-jobs-changed` y vuelve a renderizar los trabajos.
  - El editor de movimientos suma "Entrega a artista" (`assignment`) y "Devolución" (`return`), con el artista obligatorio, y precarga el costo.
  - El historial muestra artista y costo.
  - El archivo debe seguir terminando en `})();`, con las 12 funciones que expone el test en scope.
- **Materiales** (`#inventory-materials`):
  - Balance por artista e ítem.
  - "Entregar materiales" en un modal con varias líneas (varios ítems para un artista).
  - "Registrar devolución".
  - CSV.

**Finanzas** (W-FIN, `studio-dashboard-finance.js` + `studio-finance.css`)

- Libro con filtros por período, tipo y categoría, y totales por moneda.
- **Alta y edición** en modal.
  - El comprobante se sube con `WeOtziUploader.uploadFile({supabase, bucket:'studio-documents', pathPrefix: studioId + '/finance', file})` y se guarda `result.path`.
  - Para verlo se usa `createSignedUrl`.
  - Si el insert falla, se borra el objeto.
- **Anular** con motivo.
- Los gastos de pedidos Supplies muestran un enlace al pedido (`navigate('reposicion', {order})`).

**Reportes** (W-FIN, `studio-dashboard-reports.js`, montado en `#reports-extended`)

- **Período** y **KPIs por moneda**:
  - Tatuajes (cantidad y bruto, de `listMonthlyMetrics`).
  - Ingreso del estudio por tatuajes (el `studio_net` de la vista).
  - Merch:
    - con Store: `get_store_sales_report`, en unidades e ingresos;
    - sin Store: suma de `merch_manual`, con unidades "—" y la nota "Activá la Tienda para ver unidades".
  - Otros ingresos.
  - Gastos.
  - **Resultado** = ingreso por tatuajes + merch + otros ingresos − gastos.
- **Tablas** con CSV:
  - resultado mensual;
  - gastos por categoría (con barras);
  - top artistas;
  - materiales entregados por artista;
  - compras a Supplies por proveedor.

**Reposición** (W-RESTOCK, `studio-dashboard-restock.js` + `studio-restock.css`)

- **Sugerencias:** `listRestockCandidates` muestra los ítems por debajo del punto de reposición.
- **Catálogo:**
  - Solo vendors verificados. Si `ships_to_countries` no está vacío, se exige el país de la sede de entrega.
  - Búsqueda por categoría y proveedor.
  - Cada tarjeta muestra precio, el % We Ötzi, beneficios y "envío gratis desde".
- **Carrito:**
  - Va por proveedor, con un pedido por proveedor.
  - Se vincula a un ítem de inventario.
  - Se elige la sede.
  - Muestra el estimado con `estimateOrder`, más avisos de mínimo y de envío gratis.
  - "Enviar pedido" llama a `submitOrder` y después a `postNotify('/api/supplies/notify', {kind:'order_submitted', order_id})`.
  - El carrito se guarda en `sessionStorage`.
- **Mis pedidos:**
  - Estados y eventos en un drawer.
  - Si está `confirmed` con envío, muestra "Total actualizado por el proveedor: X (envío Y)".
  - Se puede cancelar mientras esté `submitted` o `confirmed`.
  - "Recibir" pide las cantidades por línea, muestra el resultado (faltantes y mismatches) y notifica `order_received`.

**Tienda** (fase final, `studio-dashboard-store.js`)

- Mientras no exista `WeotziData.Store`, muestra `emptyState`: "La Tienda llega en la próxima fase. Mientras tanto, registrá ventas de merch en Finanzas → Ingreso → Merch (manual)", con un botón a Finanzas.

## Frontend del artista (W-ARTIST)

**Archivos:** `artist-invitations.js`, `invitations-model.js`, `invitations-studio.js`, `artist-applications.js`, `applications-state.js`, `inbox-deeplink.js`, `dashboard.js` (solo el guardado de estudio), `register.js` (lógica del paso estudio), los HTML de `/artist/invitations` y `/artist/applications` (solo el script `studio-contracts-repo.js` después de `studios-repo.js`), `public/register-artist/index.html` (un `ra-hint` en el paso 05) y las CSS de invitaciones (solo agregados).

**Estados (`invitations-model.js`)**
- Define `requested`, `pending`, `active`, `rejected_by_studio` y `rejected_by_artist`, usando `initiated_by` de `listForArtistV2`.
- Textos:
  - rechazo del estudio: "El estudio no aprobó tu solicitud";
  - stepper de las altas pedidas por el artista: "Solicitud enviada → En revisión → Aprobada".

**`/artist/invitations`**
- **Solicitudes enviadas:**
  - "Esperando al estudio", o "Esperando que el estudio se sume" si no tiene dueño.
  - Acción "Retirar solicitud".
- **Detalle del estudio:**
  - Botón "Trabajo acá / Solicitar alta", que abre un drawer con rol, sede, fecha, mensaje y portfolio.
  - Llama a `requestMembership`. Si el estudio tiene dueño, avisa con `postNotify('/api/artist/studio-notify', {kind:'membership_request_created', membership_id})`.
  - Si el estudio no tiene dueño, muestra "Este estudio todavía no está en We Ötzi. Guardamos tu solicitud y la va a ver cuando active su cuenta".
- **Contratos por firmar** (`StudioContracts.listForArtist`, `sent`):
  - Vista del contrato con el estilo de `offerPanel` (`inv-offer-grid`).
  - "Firmar y aceptar": nombre completo + "Leí y acepto los términos" → `sign` → `notify contract_signed`.
  - "Rechazar", con motivo.
  - Una invitación con contrato `sent` reemplaza "Aceptar" por "Revisar y firmar contrato".
  - `ROUTE_KEYS` suma `contrato` (`?contrato=<id>`).
- **Membresía activa:**
  - Muestra el contrato vigente, con la opción de rescindir.
  - Sección "Materiales entregados" (`listMyMaterialAssignments` filtrado por estudio).

**`/artist/applications`**
- `applications-state.js` deriva `contrato_pendiente` cuando hay un contrato `sent` para la postulación: "Contrato pendiente de firma →" lleva a `/artist/invitations?contrato=<id>`.
- "Spot confirmado" se muestra solo con contrato `signed` o con la postulación `accepted`.

**`inbox-deeplink.js`**
- Acepta `context_type 'studio_contract'` y lleva a `/artist/invitations?contrato=<id>`.

**Registro del artista** (`register.js`)
- La búsqueda de estudios pide `user_id`.
- Copy del hint:
  - Con dueño: "Tu alta queda pendiente hasta que el estudio la apruebe".
  - Sin dueño: "Guardamos tu solicitud; el estudio la verá cuando active su cuenta".
- No escribe `artist_tattoo_locations.studio_id`.

**`dashboard.js#handleProfileSave`**
- Deja de enviar `studio_id`.
- Si se elige un estudio nuevo con dueño, llama a `requestMembership`.

## Perfil público y entradas (W-PUBLIC)

**Archivos:** `studio-profile.js`, `public/studio/profile/index.html`, `public/bienvenida/index.html`, `bienvenida.js`, `bienvenida-ds.css`, `studio-spots-directory.js` (solo agregados de visualización).

- **Perfil de estudio:**
  - Roster en "Residentes" y "Guest e itinerantes" (`studio_public_roster`), con "Hasta {ends_on}" para guests.
  - Sección "Spots abiertos" (`listOpenByStudio`).
  - Hueco `#studio-store` para la vitrina.
- **`/studio-spots`:** el detalle y la tarjeta muestran la modalidad (porcentaje / fijo y quién paga) y los beneficios si existen.
- **`/bienvenida`:** tarjetas Estudio y Supplies, junto a cliente y artista.

## Supplies (W-SUPPLIES: `public/supplies/**`, `supplies-auth.js`, `supplies-register.js`, `supplies-dashboard.js`, `supplies.css`)

**Páginas:** `/supplies/register`, `/supplies/login` y `/supplies/dashboard`.
- Estructura `<body data-theme="light"><div class="studio-page supplies-page">`.
- Stack: `styles.css`, `studio.css`, `studio-admin-kit.css` y `supplies.css`.

**`supplies-auth.js`** → `window.WeOtziSuppliesAuth`
- Espejo de `studio-auth.js`.
- El signUp lleva `user_type:'supplies'` y el borrador en `user_metadata.supplies_registration`.
- Al confirmar el email llama a `completeRegistration`, que devuelve la fila completa, y luego a `remember`.
- Incluye recuperación y `appUrl`.

**`supplies-register.js`:** wizard en tres pasos (cuenta, negocio, comercial).

**`supplies-dashboard.js`**
- **Inicio:**
  - "Tu cuenta está en revisión: los estudios todavía no ven tu catálogo" si no está verificado.
  - Pedidos nuevos y KPIs.
- **Pedidos:**
  - Filtros y drawer de detalle.
  - Acciones: confirmar (envío), rechazar, despachar (tracking), entregado y cancelar. Cada una hace `postNotify('/api/supplies/notify', {kind:'order_*', order_id})`.
- **Catálogo:**
  - CRUD con imagen vía `WeOtziUploader.attach` (bucket `supply-photos`, prefijo `<vendor_id>`).
  - Archivar y CSV.
- **Beneficios:** % We Ötzi, tiers y textos.
- **Clientes**, **Reportes** (ventas mensuales y top productos), **Perfil** (público + privado) y **Cuenta**.

## Backoffice (W-BACKOFFICE)

**Archivos:** `public/backoffice/index.html` (solo un contenedor y los scripts), `backoffice-studio-claims.js`, `backoffice-supplies.js` y `admin.js` (solo `setApplicationStatus('accepted')`, que pasa a llamar a `decide_studio_spot_application` a través del endpoint de admin).

- **Reclamos de estudios pendientes:** aprobar o rechazar con nota.
- **Vendors Supplies:** verificar y activar o desactivar.

## Tests

- Cada agente escribe `tests/<area>.test.js` en `node:test`:
  - VM harness con un builder falso, siguiendo el patrón de `tests/studio-operations-workflows.test.js`;
  - funciones puras;
  - regex sobre markup.
- **SQL:** `supabase/tests/<area>.sql` con el patrón BEGIN → fixtures "QA ROLLBACK" → `set_config('request.jwt.claim.sub')` → `SET LOCAL ROLE authenticated` → `RAISE` → ROLLBACK.
- **Validación SQL:** un agente corre en vivo M1→M5 + los tests SQL en una sola transacción, con `SET LOCAL lock_timeout='3s'` y `statement_timeout='60s'`, termina con `ROLLBACK` e itera hasta que queda en verde.
- **Suite completa:** `node --test "tests/*.test.js"` debe quedar en verde.

## Dueños de archivos (sin solapamiento)

| Agente | Archivos |
|---|---|
| W-SQL-A | M1, M2, sus rollbacks, `supabase/tests/studio_affiliations_contracts.sql`, `supabase/seeds/20260829_*.sql` (solo `on_conflict`), `scripts/test-studio-identity-transactions.sql` |
| W-SQL-B | M3, M4, sus rollbacks, `supabase/tests/studio_agenda_inventory_finance.sql` |
| W-SQL-C | M5, su rollback, `supabase/tests/supplies_marketplace.sql` |
| W-REPO | `studios-repo.js` (agregados y los 2 cambios autorizados), `studio-contracts-repo.js`, `studio-finance-repo.js`, `supplies-repo.js`, `tests/studio-platform-repos.test.js` |
| W-KIT | `studio-admin-kit.js`, `studio-admin-kit.css`, `tests/studio-admin-kit.test.js` |
| W-SHELL | `public/studio/dashboard/index.html`, `studio-dashboard.js`, `tests/studio-dashboard-shell.test.js` |
| W-ONBOARD | `studio-register.js`, `studio-auth.js`, `public/studio/register/index.html`, `public/studio/login/index.html`, `tests/studio-claim-onboarding.test.js`; ajusta `tests/studio-identity-flows.test.js` si hace falta |
| W-SERVER | `server.js`, `lib/repos/studios.js`, `lib/repos/supplies.js`, `services/email-event-mapping.js`, `services/email-request-context.js`, `lib/artist-registration.js`, `tests/artist-registration.test.js`, `tests/studio-notify-auth.test.js`, `tests/studio-platform-server.test.js` |
| W-TEAM | `studio-dashboard-requests.js`, `studio-dashboard-contracts.js`, `studio-contracts.css`, tests |
| W-AGENDA | `studio-dashboard-agenda.js`, `studio-agenda.css`, `calendar-repo.js` (proyección), `public/calendar/index.html` (1 script), `calendar.js` (solo `openEventById`), tests (mantener `figma-final-calendario`) |
| W-INV | `studio-dashboard-ops.js`, `studio-dashboard-materials.js`, `tests/studio-operations-workflows.test.js`, tests |
| W-FIN | `studio-dashboard-finance.js`, `studio-dashboard-reports.js`, `studio-finance.css`, tests |
| W-RESTOCK | `studio-dashboard-restock.js`, `studio-restock.css`, tests |
| W-HOME | `studio-dashboard-home.js`, `studio-dashboard-store.js` (placeholder), tests |
| W-SUPPLIES | `public/supplies/**`, `supplies-auth.js`, `supplies-register.js`, `supplies-dashboard.js`, `supplies.css`, tests |
| W-ARTIST | ver sección Artista, tests |
| W-PUBLIC | ver sección Perfil público, tests |
| W-BACKOFFICE | ver sección Backoffice, tests |
| W-INTEGRATOR (sesión principal) | `package.json`, `package-lock.json`, `docs/CHANGELOG.md`, `docs/STUDIOS.md`, `docs/SUPPLIES.md`, `docs/MAPA_APLICACION.md`, `docs/TECHNICAL.md`, `CLAUDE.md` (referencia a `shared-drawer.js`), commits |
