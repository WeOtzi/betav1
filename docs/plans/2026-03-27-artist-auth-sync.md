# Artist ↔ Auth Bidirectional Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Crear triggers de PostgreSQL en Supabase que sincronicen `name`→`display_name` y `whatsapp_number`→`phone` entre `artists_db` y `auth.users`, y que cascaden los deletes en ambas direcciones.

**Architecture:** Tres funciones PostgreSQL con `SECURITY DEFINER` + tres triggers. Las funciones corren con privilegios del creador para acceder al esquema `auth`. El delete bidireccional es seguro porque el segundo delete siempre afecta 0 filas (el registro ya fue eliminado).

**Tech Stack:** PostgreSQL 15, Supabase MCP (`apply_migration`), proyecto ID `flbgmlvfiejfttlawnfu`

---

### Task 1: Crear el directorio de migraciones y el archivo SQL

**Files:**
- Create: `supabase/migrations/20260327000000_artist_auth_sync.sql`

**Step 1: Crear el directorio**

```bash
mkdir -p supabase/migrations
```

**Step 2: Crear el archivo de migración con el siguiente contenido exacto**

```sql
-- Migration: artist_auth_sync
-- Syncs name → display_name and whatsapp_number → phone between artists_db and auth.users
-- Also cascades deletes in both directions

-- ============================================================
-- FUNCTION 1: Sync name + whatsapp_number → auth.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_artist_to_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE auth.users
    SET
      raw_user_meta_data = raw_user_meta_data || jsonb_build_object('display_name', NEW.name),
      phone = NEW.whatsapp_number
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger 1: fires after INSERT or UPDATE of name or whatsapp_number
DROP TRIGGER IF EXISTS trigger_sync_artist_to_auth ON public.artists_db;
CREATE TRIGGER trigger_sync_artist_to_auth
  AFTER INSERT OR UPDATE OF name, whatsapp_number
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artist_to_auth();

-- ============================================================
-- FUNCTION 2: Delete auth.users when artist is deleted
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_auth_on_artist_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;

-- Trigger 2: fires after DELETE on artists_db
DROP TRIGGER IF EXISTS trigger_delete_auth_on_artist_delete ON public.artists_db;
CREATE TRIGGER trigger_delete_auth_on_artist_delete
  AFTER DELETE
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_auth_on_artist_delete();

-- ============================================================
-- FUNCTION 3: Delete artists_db when auth user is deleted
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_artist_on_auth_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM public.artists_db WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;

-- Trigger 3: fires after DELETE on auth.users
DROP TRIGGER IF EXISTS trigger_delete_artist_on_auth_delete ON auth.users;
CREATE TRIGGER trigger_delete_artist_on_auth_delete
  AFTER DELETE
  ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_artist_on_auth_delete();
```

**Step 3: Verificar que el archivo existe y su contenido es correcto**

```bash
cat supabase/migrations/20260327000000_artist_auth_sync.sql
```

Expected: el SQL completo con las 3 funciones y 3 triggers.

---

### Task 2: Aplicar la migración vía Supabase MCP

**Step 1: Aplicar la migración usando la herramienta `apply_migration`**

Usar el MCP tool `apply_migration` con:
- `project_id`: `flbgmlvfiejfttlawnfu`
- `name`: `artist_auth_sync`
- `query`: el contenido exacto del archivo SQL de Task 1

**Step 2: Verificar que los triggers existen en la base de datos**

Usar `execute_sql` con:
```sql
SELECT
  trigger_name,
  event_object_schema,
  event_object_table,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE trigger_name IN (
  'trigger_sync_artist_to_auth',
  'trigger_delete_auth_on_artist_delete',
  'trigger_delete_artist_on_auth_delete'
)
ORDER BY trigger_name;
```

Expected: 3 filas, una por cada trigger.

**Step 3: Verificar que las funciones existen**

Usar `execute_sql` con:
```sql
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_name IN (
  'sync_artist_to_auth',
  'delete_auth_on_artist_delete',
  'delete_artist_on_auth_delete'
)
AND routine_type = 'FUNCTION';
```

Expected: 3 filas.

---

### Task 3: Verificar el trigger de sincronización con datos reales

> **IMPORTANTE:** Solo hacer UPDATE en un artista existente para verificar que el trigger funciona. No hacer DELETE de datos reales.

**Step 1: Obtener un artista de prueba existente**

Usar `execute_sql` con:
```sql
SELECT a.user_id, a.name, a.whatsapp_number,
       u.raw_user_meta_data->>'display_name' AS auth_display_name,
       u.phone AS auth_phone
FROM public.artists_db a
JOIN auth.users u ON u.id = a.user_id
WHERE a.name IS NOT NULL
LIMIT 1;
```

Anotar el `user_id` y los valores actuales.

**Step 2: Hacer un UPDATE no destructivo (agrega un espacio y lo quita) para disparar el trigger**

Usar `execute_sql` con (reemplazando `<USER_ID>` con el UUID del Step 1):
```sql
UPDATE public.artists_db
SET name = name  -- mismo valor, pero dispara el trigger porque listamos 'name' en UPDATE OF
WHERE user_id = '<USER_ID>';
```

> Nota: Si el trigger es `UPDATE OF name, whatsapp_number`, un UPDATE que no cambia el valor podría no dispararse en algunos configs de PostgreSQL. En ese caso, usar:
> ```sql
> UPDATE public.artists_db SET name = name || '' WHERE user_id = '<USER_ID>';
> UPDATE public.artists_db SET name = trim(name || '') WHERE user_id = '<USER_ID>';
> ```

**Step 3: Verificar que auth.users se actualizó**

Usar `execute_sql` con:
```sql
SELECT
  a.name AS artist_name,
  u.raw_user_meta_data->>'display_name' AS auth_display_name,
  a.whatsapp_number AS artist_phone,
  u.phone AS auth_phone
FROM public.artists_db a
JOIN auth.users u ON u.id = a.user_id
WHERE a.user_id = '<USER_ID>';
```

Expected: `artist_name` == `auth_display_name` y `artist_phone` == `auth_phone`.

---

### Task 4: Commit del archivo de migración

**Step 1: Commit**

```bash
git add supabase/migrations/20260327000000_artist_auth_sync.sql
git commit -m "feat: add DB triggers for artist↔auth bidirectional sync

- sync name → display_name and whatsapp_number → phone on INSERT/UPDATE
- cascade DELETE from artists_db → auth.users
- cascade DELETE from auth.users → artists_db

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Notas importantes

- El trigger `UPDATE OF name, whatsapp_number` solo se dispara si esas columnas están listadas en el SET del UPDATE (no necesariamente si el valor cambia, sino si la columna es mencionada).
- Los deletes bidireccionales son seguros: cuando el trigger A elimina en B, el trigger de B intenta eliminar en A pero ya no existe → 0 filas afectadas → sin loop.
- `SECURITY DEFINER` es necesario para que las funciones puedan escribir en el esquema `auth` que normalmente está restringido.
- El campo `phone` en `auth.users` es una columna de nivel superior (no en `raw_user_meta_data`), se actualiza directamente.
