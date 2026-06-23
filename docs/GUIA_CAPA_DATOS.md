# Guía de acceso a datos — Capa PostgREST unificada (ESTÁNDAR)

> **Regla del proyecto, a partir de 2026-06-21:** todo acceso a datos de Supabase
> se hace **a través de la capa PostgREST unificada**. No se escribe CRUD ad-hoc
> (`fetch('${url}/rest/v1/...')` inline en el servidor, ni `_supabase.from(...)`
> disperso en el frontend). Si tocas datos, agregás/usás un **método con nombre**
> en el repositorio del dominio.

Contexto y diseño completo: [docs/plans/2026-06-21-postgrest-capa-unificada-piloto-cotizaciones.md](plans/2026-06-21-postgrest-capa-unificada-piloto-cotizaciones.md).

---

## Por qué

Supabase ya expone PostgREST (`/rest/v1/`) y supabase-js es su wrapper: el proyecto
**ya usaba PostgREST**, pero de forma fragmentada (3+ helpers de datos solapados en
el servidor + `.from()` disperso en 46 módulos frontend, sin manejo de error ni
claves de relación consistentes). La capa centraliza eso, escapa filtros
(anti-inyección) y encapsula las inconsistencias.

---

## Servidor (`lib/`)

```js
const { pgrest } = require('./lib/postgrest');

// Lectura con select explícito y filtros parametrizados/escapados:
const rows = await pgrest('mi_tabla')
  .select('id,col_a,col_b')
  .eq('owner_id', userId)
  .order('created_at', { ascending: false })
  .limit(20)
  .execute();

// single() devuelve la fila o null:
const row = await pgrest('mi_tabla').select('*').eq('id', id).single().execute();

// Escrituras:
await pgrest('mi_tabla').insert({ ... });
await pgrest('mi_tabla').eq('id', id).patch({ campo: valor });
await pgrest('mi_tabla').upsert(obj, { onConflict: 'clave' });
await pgrest('mi_tabla').eq('id', id).delete();

// Paginación + conteo:
const { rows, count } = await pgrest('mi_tabla').range(0, 49).count('exact').execute();
```

- Por defecto usa **service-role** (salta RLS). La autorización la hace el endpoint
  (ownership / `verifyAdminCaller`) ANTES de llamar al repo.
- `pgrest('t', { key: 'anon' })` respeta RLS (raro server-side; justificarlo).
- Identidad por Bearer: `const { resolveBearerUser } = require('./lib/auth/supabase-auth')`.
- **Patrón correcto:** un endpoint NO arma queries; llama a un método del repo de
  dominio (`lib/repos/<dominio>.js`). Ver [lib/repos/quotations.js](../lib/repos/quotations.js) como referencia.

## Frontend (`public/shared/js/data/`)

Cargar (después de `config-manager.js`) en la página:
```html
<script src="/shared/js/data/postgrest-client.js"></script>
<script src="/shared/js/data/<dominio>-repo.js"></script>
```

Hay **dos niveles** de acceso, ambos sobre el cliente autenticado singleton:

**1. Repos de dominio con nombre** (preferido para lógica reusada; ej. Cotizaciones):
```js
const rows = await WeotziData.Quotations.listForArtist(userId);
await WeotziData.Quotations.updateStatusById(id, 'responded');
```

**2. Choke-point `WeotziData.from(...)`** (para el resto del CRUD): reemplaza
`_supabase.from(...)` / `supabaseClient.from(...)` disperso por `WeotziData.from(...)`,
que enruta por el mismo cliente singleton y **conserva el contrato `{ data, error }`**:
```js
const { data, error } = await WeotziData.from('studios').select('*').eq('id', id);
const ch = WeotziData.channel('mi-canal').on('postgres_changes', {...}, cb).subscribe();
WeotziData.removeChannel(ch);
```

Excepciones legítimas (NO van por el choke-point): `client.storage.from(...)` (Storage),
`client.auth.*`, clientes ad-hoc de prueba (backoffice), y funciones que reciben el
cliente por **inyección de dependencia** para tests (p.ej. `resolveArtistAuthState`).

- Los métodos de repo **lanzan** en error (no devuelven `{data,error}`): usá
  `try/catch` donde el comportamiento deba ser no-fatal.
- No re-crear clientes con `supabase.createClient(...)`: usar el singleton de
  `config-manager.js` (lo hace la capa por vos).
- Filtros con valores de usuario (emails, etc.) → la capa los escapa (`orValue`).

---

## Cómo agregar un dominio o un método nuevo

1. **Servidor:** agregá el método con nombre en `lib/repos/<dominio>.js` (o creá el
   archivo) usando `pgrest(...)`. El endpoint solo valida auth/ownership y llama al método.
2. **Frontend:** agregá el método en `public/shared/js/data/<dominio>-repo.js`
   (expone `window.WeotziData.<Dominio>`), envolviendo supabase-js vía `WeotziData.run(...)`.
3. **Claves de relación:** encapsulá la clave correcta en el repo (no la repitas en
   los llamadores). Ej. en cotizaciones: `quotation_notes`/`quotation_sessions` usan
   `quotations_db.id` (int); `quotations_attachments`/`chat_messages` usan `quote_id` (text).
4. **Tests:** agregá pruebas de equivalencia (que el método genere la query esperada)
   en `tests/`. Ver [tests/postgrest.test.js](../tests/postgrest.test.js).

## Checklist antes de mergear/desplegar

- [ ] `node --test "tests/*.test.js"` en verde.
- [ ] Cero accesos directos al/los dominio(s) migrado(s):
      `grep -rnE "\.from\('<tabla>'" public/shared/js --include=*.js` (excluyendo los repos)
      y `grep -nE "/rest/v1/<tabla>" server.js` → 0.
- [ ] `node --check` en los archivos tocados.
- [ ] RLS intacto (frontend bajo sesión del usuario; service-role solo server-side).

## Estado de migración por dominio

| Dominio | Estado |
|---|---|
| Cotizaciones (quotations_db + notes/sessions/attachments/chat) | ✅ Migrado (piloto, repos con nombre) |
| Job board (job_board_*) | ✅ Migrado (JobBoardRepo + choke-point) |
| Artistas, Estudios, Soporte, Clientes, Reviews, Config/catálogos | ✅ Migrado (choke-point `WeotziData.from`) |
| Currencies, Instagram (servidor) | ✅ Migrado (CurrenciesRepo, InstagramRepo) |
| Frontend completo | ✅ Cero `<cliente>.from(...)` directo (salvo las excepciones legítimas de arriba) |
| Servidor | ✅ **Cero** `fetch('/rest/v1/...')` inline; TODOS los helpers (`_supabaseFetch`, `fetchAdminTableRows`, `supabaseQuery`) delegan en `pgrest` |
| Analytics NO-cotización (`/api/analytics/{users,devices,pages,errors,locations,summary}`) | ✅ Migrado: `supabaseQuery` delega en `pgrest.raw(path, { apiKey })` conservando la anon key |

**Migración PostgREST: 100% completa.** Todo el acceso a datos (frontend + servidor) pasa por la capa unificada.
