# Design: Sincronización bidireccional artists_db ↔ auth.users

**Date:** 2026-03-27
**Status:** Approved

## Problema

Al registrarse desde `/registerclosedbeta`, los usuarios se crean en `auth.users` con `display_name: 'Artista'` (genérico). Aunque `register.js` actualiza este campo al completar el perfil vía `auth.updateUser()`, no existe ningún mecanismo a nivel de base de datos que garantice la sincronización. Si el campo `name` se actualiza directamente en `artists_db` (desde el dashboard de Supabase, un script, o cualquier otro cliente), `auth.users` no se actualiza.

Adicionalmente, no existe ningún mecanismo de eliminación en cascada entre `artists_db` y `auth.users`.

## Solución: PostgreSQL Triggers

Implementar tres triggers directamente en la base de datos de Supabase.

## Campos sincronizados

| `artists_db` | `auth.users` |
|---|---|
| `name` | `raw_user_meta_data->>'display_name'` |
| `whatsapp_number` | `phone` |

## Componentes

### 1. Trigger de sincronización: `artists_db` → `auth.users`

**Evento:** `AFTER INSERT OR UPDATE OF name, whatsapp_number ON public.artists_db`
**Función:** `sync_artist_to_auth()`

Comportamiento:
- En INSERT: si `name` no es nulo, escribe `display_name` en `raw_user_meta_data` y `whatsapp_number` en `phone`
- En UPDATE: solo actualiza los campos que cambiaron (`name` o `whatsapp_number`)
- Usa `SECURITY DEFINER` para acceder al esquema `auth`

```sql
UPDATE auth.users
SET
  raw_user_meta_data = raw_user_meta_data || jsonb_build_object('display_name', NEW.name),
  phone = NEW.whatsapp_number
WHERE id = NEW.user_id;
```

### 2. Trigger de eliminación: `artists_db` → `auth.users`

**Evento:** `AFTER DELETE ON public.artists_db`
**Función:** `delete_auth_on_artist_delete()`

Comportamiento:
- Elimina el registro en `auth.users` donde `id = OLD.user_id`
- Si no existe el usuario en auth (ya fue eliminado), la operación afecta 0 filas sin error

### 3. Trigger de eliminación: `auth.users` → `artists_db`

**Evento:** `AFTER DELETE ON auth.users`
**Función:** `delete_artist_on_auth_delete()`

Comportamiento:
- Elimina el registro en `artists_db` donde `user_id = OLD.id`
- Si no existe el artista (ya fue eliminado), la operación afecta 0 filas sin error

## Manejo de loops infinitos

Los deletes bidireccionales no causan loops porque:
1. Delete en `artists_db` → dispara delete en `auth.users` → el trigger de auth intenta delete en `artists_db` → el registro ya no existe, 0 filas afectadas → fin.
2. Delete en `auth.users` → dispara delete en `artists_db` → el trigger de artists_db intenta delete en `auth.users` → el registro ya no existe, 0 filas afectadas → fin.

## Deliverable

Un archivo de migración SQL en `/supabase/migrations/` aplicado vía Supabase MCP o CLI.

## Archivos relevantes

- `/public/shared/js/main.js` — Registro inicial (sets `display_name: 'Artista'`)
- `/public/shared/js/register.js` — Completion del perfil (sets `display_name` via `auth.updateUser`)
- `supabase/migrations/` — Destino del archivo de migración
