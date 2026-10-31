# Runbook: aplicar las migraciones de Estudios, Supplies y Store

**Fecha:** 2026-10-31 · **Estado:** APLICADO el 2026-10-31 · **Proyecto Supabase:** `flbgmlvfiejfttlawnfu` ("Chatbot"; nunca el pausado "WeOtzi's App").

Se aplicaron en orden Store (`store_core`), M1, M2, M3, M4, M5 (en dos partes: `..._part1` y `..._part2`, por tamaño) y M6, vía `apply_migration` del MCP, cada una en su transacción. Verificado después: sin funciones faltantes, UNIQUE viejo retirado e índice parcial creado, `studio_public_roster`, costos `numeric(14,6)`, bucket `supply-photos`, `handle_new_user` parcheado, policies de Storage sobre `objects.name`, 40 estudios y 56 membresías intactos. El test `supabase/tests/studio_operations_workflows.sql` pasó contra el esquema vivo dentro de BEGIN…ROLLBACK. Lo que sigue queda como referencia para repetirlo en otro entorno o para el rollback.

## Qué se aplica, en orden

| # | Archivo | Qué hace | Rollback |
| --- | --- | --- | --- |
| 0 | `20261030150000_store_core.sql` | Store compartida (`store_*`), de `feature/store-artista`. Toma `AccessExclusiveLock` sobre `storage.objects` un instante. | `rollbacks/20261030150000_store_core.down.sql` |
| 1 | `20261030200000_studio_affiliations.sql` | Alta en dos sentidos, reclamo, guards, roster público. **Quita el UNIQUE** `studio_artist_memberships_no_double_active` y deja un puente en `decide_studio_spot_application`. | `..._studio_affiliations.down.sql` |
| 2 | `20261030201000_studio_contracts.sql` | Contratos, firma, aceptación de spots por contrato. | `..._studio_contracts.down.sql` |
| 3 | `20261030202000_studio_agenda_inventory.sql` | Agenda con disponibilidad, materiales por artista, costos con 6 decimales (recrea `studio_inventory_health_by_currency`). | `..._studio_agenda_inventory.down.sql` |
| 4 | `20261030203000_studio_finance.sql` | Finanzas y **arreglo de las policies de Storage `studio-*`** (hoy solo soporte puede subir). | `..._studio_finance.down.sql` |
| 5 | `20261030204000_supplies_marketplace.sql` | Cuentas Supplies, catálogo, pedidos, parche de `handle_new_user`, bucket `supply-photos`. | `..._supplies_marketplace.down.sql` |
| 6 | `20261030205000_studio_store.sql` | Tienda del estudio: venta en mostrador y vitrina pública. | `..._studio_store.down.sql` |

M1→M6 van **juntas y en orden** (M1 deja puentes que M2 reemplaza). Store (0) va antes de M6; puede ir antes o después de M1–M5.

## Antes de aplicar

1. **Mergear a `main`**, en este orden: `feature/store-artista` y después `feature/estudios-plataforma` (contiene la Store hasta `c595cc8`). Deploy del código **antes** de las migraciones es seguro.
2. **Validación en una sola transacción que se revierte.** Desde la raíz del repo:

   ```bash
   node scripts/sql/compose-studio-validation.cjs --rollbacks > validation.sql
   ```

   Pegar `validation.sql` en el SQL Editor de Supabase y ejecutar. Aplica Store + M1→M6, corre los cinco tests SQL (`studio_affiliations_contracts`, `studio_agenda_inventory_finance`, `supplies_marketplace`, `studio_operations_workflows` e `identity-transactions`) cada uno en un savepoint, aplica los rollbacks en orden inverso y termina en `ROLLBACK`. Tiene que devolver `VALIDACION ESTUDIOS: OK`. Si falla, no aplicar nada: el error dice el archivo.
3. **Backup lógico** desde el backoffice (Backup ZIP) o `pg_dump` del schema `public`.
4. **Ventana:** poco tráfico (el lock sobre `storage.objects` de Store y los `ALTER TABLE` de M1/M3 esperan hasta 5 s por `lock_timeout` y fallan limpio si no lo consiguen).
5. **Auth → URL Configuration:** agregar los redirects `/supplies/login?confirmed=1`, `/supplies/login?recovery=1` y sus variantes `/beta`, como los de `/studio/login`.

## Aplicar

Por cada archivo, en orden, con el SQL Editor (o `apply_migration` del MCP, un archivo por vez, nombrado como el archivo sin `.sql`). Cada archivo abre y cierra su propia transacción. Si uno falla, **no seguir**: revisar el error; lo ya aplicado se revierte con su `.down.sql`.

## Verificar

```sql
-- Objetos clave
select to_regclass('public.studio_contracts'), to_regclass('public.supply_orders'),
       to_regclass('public.studio_finance_entries'), to_regclass('public.store_products');
-- Guards y RPC
select proname from pg_proc where proname in ('guard_studio_membership_write','guard_studio_membership_delete',
  'request_studio_membership','sign_studio_contract','submit_supply_order','create_store_pos_order');
-- Storage arreglado: el dueño puede escribir en su carpeta
select policyname from pg_policies where tablename = 'objects' and policyname like 'studio_documents_%';
-- Sin filas rotas
select count(*) from public.studio_artist_memberships where status = 'requested';
```

En la app: `/studio/dashboard` carga Inicio sin el aviso de migración; `/studio-spots` muestra modalidad y beneficios; `/artist/invitations` carga; el registro de artista con estudio deja la membresía `requested`.

## Rollback

Aplicar los `.down.sql` en orden inverso (6 → 0), cada uno en su transacción. Avisos:

- `20261030200000….down.sql` restaura el UNIQUE viejo: antes pasa las filas `requested` a `ended` y conserva una sola fila cerrada por (estudio, artista, rol, estado).
- `20261030202000….down.sql` vuelve los costos a 2 decimales (redondea).
- `20261030204000….down.sql` devuelve `handle_new_user` a la definición previa y borra el bucket `supply-photos` si está vacío.

## Después

- Verificar a los Supplies desde Backoffice → Revisiones (los estudios no los ven hasta entonces).
- Decidir los reclamos de estudios desde el mismo lugar.
- Pendiente de producto: una pantalla propia de reclamos para soporte (hoy es una lista en el backoffice).
