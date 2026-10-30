# Store del artista · merch y diseños con licencia

**Estado**: en implementación en la rama `feature/store-artista` (desde `feature/figma-final-artista`), en el worktree `.claude/worktrees/store-artista`.
**Fecha**: 30 oct 2026. Contrato revisado después de una revisión adversarial de 4 lentes: seguridad, dinero, producto y factibilidad.
**Figma**: el archivo `w3JA83CcP5ISKjyOu87mx1` no tiene frames de Store. La UI sigue el DS final del artista (`public/shared/css/ds/`, reglas de `ds/README.md`: radius 0, sin hex sueltos, voseo, sin «!», navegación terminada en «→», íconos con `data-wo-icon`).
**Nombre en la UI**: «Store», igual que las otras secciones en inglés (Travel, Spots, Inbox). Los textos de ayuda dicen «tu Store».

## 1. Decisiones de producto (confirmadas por el usuario)

| Tema | Decisión |
| --- | --- |
| Pagos | Capa de pagos con adaptadores. Hoy solo existe `manual`: el vendedor o soporte confirma el pago. Stripe y Mercado Pago se enchufan después. |
| Licencias | Tres niveles fijos: Personal, Artista y Exclusiva. El vendedor habilita cada nivel y le pone precio. |
| Merch | Despacha el vendedor. El comprador carga la dirección y el pedido avanza preparado → enviado (con tracking) → entregado. También se puede retirar en el estudio. |

## 2. Quién cobra y cuándo se acredita el wallet

Hay que dejarlo explícito para no crear dinero que no existe.

Cada pedido nace con un `expected_collector`:

- **`seller`** (default en v1): el comprador le paga **directo al vendedor**, siguiendo las instrucciones que el vendedor cargó en Ajustes. Confirman el pago el vendedor o soporte. **No toca el wallet**: la plataforma nunca tuvo esos fondos. La comisión es 0.
- **`platform`**: solo si `app_settings.store_manual_collector = 'platform'` y `app_settings.store_platform_payment_instructions` no está vacío. El comprador le paga a We Ötzi y **solo soporte** confirma. Se acredita el wallet del artista: primero un `payment` retenido, después `release` y `fee`.
- **`provider`**: cuando haya un adaptador real (`app_settings.store_payment_provider ≠ 'manual'`). Lo confirma el webhook (service role). Acredita el wallet igual que `platform`.
- Los vendedores `studio` siempre usan `seller`, porque todavía no hay ledger de estudios.

Predicado único `store_order_uses_wallet(o)`: `o.seller_type = 'artist' and o.payment_collected_by in ('platform','provider')`. Lo usan todas las RPC que tocan el wallet, y además exigen que exista `public.artist_wallet_movements` (`to_regclass`). Los pedidos que no cumplen el predicado tienen `funds_release_at = null` y nunca entran en la liberación.

> **Consecuencia que hay que contarle al usuario**: con la configuración por defecto (`seller`), las ventas **no** acreditan el wallet, porque el dinero va directo al artista. El wallet se acredita cuando We Ötzi cobra: con `platform` configurado o con un proveedor real.

## 3. Licencias de uso (`terms_version = '2026-10'`)

Los textos completos viven versionados en `public/shared/js/store-model.js` (`TERMS['2026-10']`). La base guarda la versión aceptada por ítem. **Antes de producción tienen que pasar por revisión legal.**

| Nivel | Quién compra | Titular (`holder_name`) | Qué permite |
| --- | --- | --- | --- |
| `personal` | Cualquier cuenta | La persona que se tatúa. Por defecto el comprador; se permite regalarla. | Tatuar el diseño **una vez** en el cuerpo del titular, con el tatuador que elija. El titular puede compartir el stencil con ese tatuador solo para esa sesión. No permite reventa, merch ni uso comercial. |
| `artist` | Solo cuentas de artista con registro completo | El nombre del artista según `artists_db` (no se edita) | Tatuar el diseño **una vez** a un cliente, cobrar esa sesión y publicar el resultado dando crédito al autor. No es exclusiva. |
| `exclusive` | Cualquier cuenta | Editable (por defecto el comprador) | **Venta única**. Se ofrece solo mientras el diseño no tenga licencias vigentes ni pedidos pendientes. Al confirmarse, el diseño se retira para siempre. Permite tatuarlo una vez, al titular o, si compra un artista, a su cliente. |

Reglas comunes:
- La autoría y los derechos morales son del artista. El autor puede mostrar el diseño en su portafolio.
- Prohibido revender o redistribuir los archivos y usarlos para entrenar IA.
- Cada licencia tiene un código `WOL-XXXX-XXXX`. Se verifica en `/store/license/?verificar=WOL-…`. No se usa `?code=`, porque `client-auth.js` lo interpreta como callback de OAuth.
- **Uso único controlado**: el titular marca la licencia como usada (`mark_store_license_used`, con nota opcional, por ejemplo «Tatuado el 12/11 en Estudio X»). La verificación pública muestra «Uso disponible» o «Usada el {fecha}».
- **Aceptación**: el checkout exige marcar «Leí y acepto la licencia {nivel} (v2026-10)». La RPC recibe `p_terms_version` y guarda `terms_version` y `terms_accepted_at` en el ítem.
- **Declaración de autoría**: para publicar diseños, el vendedor tiene que confirmar en Ajustes «Confirmo que los diseños son de mi autoría y no infringen derechos de terceros». Se guarda en `authorship_attested_at`.

Qué incluye cada compra de diseño:
1. El **original** a full calidad.
2. El **stencil** listo para imprimir. Si es PNG, JPEG o WebP y el diseño tiene las medidas en cm, se ofrece «Imprimir a escala real».
3. El **certificado** imprimible.

Los dos archivos se bajan con URLs firmadas que emite el servidor.

## 4. Reglas transversales del SQL

- **Migración**: `supabase/migrations/20261030150000_store_core.sql`, NO aplicada. Reversa en `supabase/rollbacks/20261030150000_store_core.down.sql`. Usa `begin`/`commit` y `create table if not exists`, y termina con `notify pgrst, 'reload schema'`.
- **Grants de tablas**: `revoke all on table … from public, anon, authenticated;` y después solo el DML que necesita la UI. Nunca truncate, trigger ni references. Las policies usan `(select auth.uid())`.
- **Grants de funciones**: cada función empieza con `revoke all on function public.f(<firma>) from public, anon, authenticated;` y después lleva **un** grant explícito:
  - usuario → `to authenticated`;
  - públicas → `to anon, authenticated`;
  - servicio → `to service_role`;
  - internas y helpers de trigger → ninguno.
- **Funciones de servicio**: la primera línea del cuerpo es
  `if coalesce((select auth.role()), '') <> 'service_role' and current_user not in ('postgres','supabase_admin') then raise exception using errcode='42501', message='store:forbidden'; end if;`
  Las de usuario validan `auth.uid() is not null` y, si falta, lanzan `store:not_authenticated`.
- **`security definer`** con `set search_path = ''`. Todos los nombres van calificados (`public.`, `auth.`, `storage.`). Los ids y códigos salen de `gen_random_uuid()` (core); no se usa `random()` ni pgcrypto.
- **Guard triggers**: son `security invoker` (obligatorio) y se saltean **solo** si `current_user in ('postgres','supabase_admin','service_role') or coalesce((select auth.role()),'') = 'service_role'`. En cualquier otro caso se aplican. Las RPC definer tienen como owner a `postgres`, así que el guard no las frena.
- **Locks**: toda RPC que cambia un pedido sigue este orden:
  1. Lee el `product_id` del ítem sin lock.
  2. `select … from public.store_products where id = … for update`.
  3. `select … from public.store_orders where id = … for update`.
  4. Vuelve a validar el estado.

  Los updates llevan `where status = '<esperado>'` y verifican `found`. Las liberaciones de reserva siempre van condicionadas: `update store_products set reserved_order_id = null, reserved_until = null where id = $1 and reserved_order_id = <este pedido>`.
- **Mantenimiento**: itera con `for update skip locked` y envuelve cada pedido en `begin … exception when others then` (registra el error en `metadata_json.maintenance_error` y sigue). Devuelve `{expired, flagged, delivered, released, failed:[ids]}`.
- **Wallet**: todas las sentencias contra `artist_wallet_movements` se ejecutan con `execute format(…) using …`, dentro de `if to_regclass('public.artist_wallet_movements') is not null`. No se declaran variables `%rowtype` de tablas del wallet. Si el wallet no está aplicado, `release` devuelve false **sin** marcar `funds_released_at`, y el mantenimiento reintenta. Antes de completar un `payment`, se hace un insert `on conflict (artist_user_id, external_reference) do nothing` para reconstruirlo si falta.
- **Dinero**: `numeric(12,2)` con `check (x = round(x, 2))`. Precios > 0, envío ≥ 0. La moneda va como `^[A-Z]{3}$` y, si `public.currencies(code)` es único, como FK.
  - `platform_fee_pct` se lee de `app_settings.store_platform_fee_pct` con cast seguro: `case when setting_value ~ '^\d+(\.\d+)?$' then least(greatest(setting_value::numeric, 0), 50) else 0 end`, con coalesce a 0.
  - Si `expected_collector = 'seller'`, la comisión es 0.
  - `platform_fee_amount = round(total_amount * pct / 100, 2)` es un snapshot que se toma al crear el pedido.
- **Errores**: `raise exception using errcode = 'P0001', message = 'store:<código>'`. El front traduce con `WeotziStoreModel.errorMessage(err)`. Códigos:
  - auth y existencia: `not_authenticated`, `forbidden`, `not_found`;
  - producto y diseño: `product_unavailable`, `product_reserved`, `exclusive_unavailable`, `tier_unavailable`, `artist_tier_requires_artist`, `own_product`, `design_no_longer_available`;
  - comprador y límites: `email_unconfirmed`, `too_many_pending`, `pending_order_exists`, `exclusive_cooldown`;
  - variantes y entrega: `variant_required`, `variant_unavailable`, `out_of_stock`, `invalid_quantity`, `pickup_unavailable`, `shipping_address_invalid`, `ships_to_unsupported`;
  - vendedor y términos: `seller_not_ready`, `terms_version_mismatch`;
  - pago y estados: `invalid_status`, `order_not_payable`, `collector_mismatch`, `payment_reported`, `cannot_reopen`;
  - envío: `tracking_required`, `invalid_tracking_url`;
  - catálogo y licencias: `stock_changed`, `checklist_incomplete`, `asset_licensed`, `asset_missing`, `invalid_image_path`, `download_limit`, `license_revoked`, `license_used`.

## 5. Esquema

### Helpers

Son `security definer` y `stable`, con `search_path = ''`. Ninguno lleva grant, salvo los que necesitan las policies, que llevan `to authenticated`.

- **`public.store_seller_ready_artist(p_user uuid)`**: existe `artists_db.user_id = p_user` con `registration_status is distinct from 'incompleto'`.
- **`public.store_can_manage_seller(p_seller_type text, p_seller_id uuid)`**:
  - `artist`: `p_seller_id = auth.uid()` y `store_seller_ready_artist`.
  - `studio`: `exists (select 1 from public.studios s where s.id = p_seller_id and s.user_id = (select auth.uid()))`.
  - La sesión de estudios puede extenderla con `create or replace`, por ejemplo para staff.
- **`public.store_can_manage_storage_folder(p_folder text)`**: misma lógica, comparando como texto (`auth.uid()::text`, `s.id::text`). Nunca castea el path a uuid.
- **`public.store_current_terms_version()`**: devuelve `'2026-10'`.

> **Nota de seguridad**: el nivel `artist` y la condición de vendedor dependen de `artists_db`, y esa tabla hoy acepta autoinsert y no tiene `username` único. No son una frontera fuerte hasta endurecer `artists_db` (pendiente).

### Tablas

**`store_products`**
- Identidad y estado:
  - `id`, `seller_type` (`artist|studio`), `seller_id`, `kind` (`merch|design`);
  - `status` (`draft|active|paused|retired`).
- Texto:
  - `title` (2–120), `description` (≤4000), `category` (≤40, texto libre), `tags text[]` (≤12);
  - `currency` (default `USD`).
- Precios:
  - `price_amount`: base para merch;
  - `license_personal_price`, `license_artist_price`, `license_exclusive_price`: null = nivel no ofrecido.
- Diseño:
  - `design_width_cm`, `design_height_cm` (1–200, numeric(5,1));
  - `design_style` (≤60), `placement_suggestion` (≤120).
- Imágenes: `images jsonb`, array ≤8 de `{path, alt}`. **Sin url**. El guard valida cada `path` con `^<seller_id>/<product_id>/[0-9]+-[0-9]+\.(jpe?g|webp|png)$`, que exista en `storage.objects` (bucket `store-previews`) y `alt` ≤200.
- Envío y retiro:
  - `shipping_price_amount` (≥0);
  - `ships_to_countries text[]` (ISO-2; vacío = sin restricción), `ships_to_note` (≤200);
  - `pickup_available`, `pickup_note` (≤300; pública: zona y horario, nunca la dirección).
- Campos del servidor: `sales_count`, `licenses_issued`, `reserved_order_id`, `reserved_until`, `exclusive_sold_at`, `published_at`, `retired_at`.
- `metadata_json`, timestamps.
- Checks de forma:
  - un diseño no tiene `price_amount`, envío ni retiro;
  - un merch no tiene precios de licencia.
- Guard `store_products_guard` (invoker; solo se aplica a las escrituras directas):
  - **insert**: fuerza `status='draft'` y los campos del servidor en 0 o null;
  - **update**: `seller_*` y `kind` no cambian, y los campos del servidor se conservan;
  - `retired` es final para el usuario;
  - **pasar a `active`** exige el checklist, el mismo que `WeotziStoreModel.publishChecklist`:
    - diseño: ≥1 precio de licencia, ≥1 imagen, assets `original` y `stencil`, ajustes del vendedor con `payment_instructions` y `contact_channel` no vacíos, y `authorship_attested_at` no null;
    - merch: `price_amount`, ≥1 variante activa, ≥1 imagen y los mismos ajustes, sin la autoría;
    - fija `published_at` la primera vez;
  - pasar a `retired` fija `retired_at`.
- Delete: solo `draft` y sin ítems de pedido.

**`store_product_variants`** (solo merch; el trigger valida el kind)
- Columnas: `id`, `product_id` (cascade), `label` (1–60), `size` (≤20), `color` (≤30), `sku` (≤40), `price_amount` (override, nullable), `stock` (null = sin límite, ≥0), `active`, `sort_order`, timestamps.
- Guard invoker:
  - desde la API el `stock` solo se fija en el insert; los cambios van por `adjust_store_variant_stock`;
  - no se puede desactivar ni borrar la última variante activa de un producto `active` (`checklist_incomplete`);
  - delete solo si no hay ítems que referencien la variante. La FK `store_order_items.variant_id` es `on delete restrict`; en la UI se «desactiva».

**`store_design_assets`** (solo diseño)
- Columnas: `id`, `product_id` (cascade), `kind` (`original|stencil`), `storage_path` (unique, ≤512), `file_name` (1–200), `mime_type`, `size_bytes`, `created_at`.
- Trigger:
  - el path cumple `^<seller_id>/<product_id>/(original|stencil)/[^/]+$`, con el segmento igual a `kind`;
  - existe en `storage.objects` del bucket `store-design-files` (si no, `asset_missing`);
  - **sobrescribe** `mime_type` y `size_bytes` con los metadatos del objeto (`metadata->>'mimetype'`, `(metadata->>'size')::bigint`);
  - el stencil solo admite png, jpeg, webp o pdf.
- Delete:
  - solo si el producto no tiene licencias (`asset_licensed`);
  - tampoco si deja un producto `active` sin original o sin stencil (`checklist_incomplete`).
- Sin update.

**`store_seller_settings`**
- PK `(seller_type, seller_id)`.
- Columnas:
  - `store_tagline` (≤160), `contact_channel` (≤200; por ejemplo «WhatsApp +54 9 11…» o «@usuario en Instagram»), `payment_instructions` (≤2000);
  - `shipping_policy`, `return_policy` (≤2000 cada una);
  - `pickup_address` (≤300, privada), `authorship_attested_at`, timestamps.

**`store_orders`**
- Identidad:
  - `id`, `order_number` (`ST-` + 8 caracteres de `gen_random_uuid()`, unique);
  - `seller_type`, `seller_id`, `channel` (`online|pos`).
- Comprador:
  - `buyer_user_id` (→ `auth.users` on delete set null), `buyer_role` (`client|artist|guest`);
  - `buyer_name` (1–120), `buyer_email`, `buyer_phone` (≤40).
- Estado:
  - `status` (`pending_payment|paid|fulfilled|cancelled|refunded|expired`);
  - `fulfillment_method` (`digital|shipping|pickup`);
  - `fulfillment_status` (`unfulfilled|preparing|shipped|ready_for_pickup|delivered`).
- Entrega:
  - `shipping_address jsonb` `{recipient,line1,line2,city,region,postal_code,country(ISO-2),phone}`;
  - `pickup_details` (≤300; copia de `pickup_address` al pagar);
  - `tracking_carrier` (≤60), `tracking_code` (≤80), `tracking_url` (`^https://`, ≤500).
- Montos: `currency`, `subtotal_amount`, `shipping_amount`, `total_amount` (>0), `platform_fee_pct`, `platform_fee_amount`.
- Pago:
  - `payment_provider` (`manual|stripe|mercado_pago`), `expected_collector` (`seller|platform|provider`);
  - `payment_instructions` (snapshot), `seller_contact` (snapshot de `contact_channel`);
  - `buyer_payment_reference` (≤200), `buyer_payment_reported_at`;
  - `paid_at`, `payment_collected_by`, `payment_confirmed_by`.
- Ciclo de vida:
  - `expires_at`, `shipped_at`, `ready_at`, `delivered_at`, `delivered_by` (`buyer|seller|support|auto`);
  - `cancelled_at`, `cancel_reason` (≤300), `refunded_at`.
- Fondos: `funds_release_at`, `funds_released_at`, `funds_hold` (bool; solo soporte).
- Notas: `buyer_note` (≤1000), `seller_message` (≤1000; **visible para el comprador**; no hay notas privadas en v1).
- Idempotencia: `idempotency_key` (≤80).
- `metadata_json`, timestamps.
- Índices únicos parciales:
  - `(buyer_user_id, idempotency_key) where channel = 'online'`;
  - `(seller_type, seller_id, idempotency_key) where channel = 'pos'`.
- Checks:
  - `shipping` exige dirección;
  - `status in (pending_payment, cancelled, expired)` ⇒ `fulfillment_status = 'unfulfilled' and paid_at is null`;
  - `fulfilled` ⇒ `delivered`;
  - `digital` ⇒ `fulfillment_status in ('unfulfilled','delivered')`;
  - `shipping` ⇒ `<> 'ready_for_pickup'` y `pickup` ⇒ `<> 'shipped'`;
  - `funds_released_at` ⇒ `funds_release_at` no null;
  - `channel = 'pos'` ⇒ `expected_collector = 'seller'`;
  - `buyer_role = 'guest'` ⇒ `buyer_user_id is null and channel = 'pos'`, en una sola dirección: un pedido online cuyo comprador borró la cuenta queda con `buyer_user_id` null y no viola el check.

**Ventas de mostrador (POS)**. Las crea la RPC de la sesión de estudios. Solo pueden ser merch con `pickup`, porque una licencia necesita una cuenta. Nacen `paid`, se cierran `fulfilled`/`delivered` en la misma RPC y tienen `funds_release_at` null.

**`store_order_items`** (v1: un ítem por pedido)
- Columnas:
  - `id`, `order_id` (cascade), `product_id` (set null), `variant_id` (**restrict**);
  - `kind`, `title`, `variant_label`, `image_path` (snapshots);
  - `license_tier`, `license_holder_name` (≤120);
  - `terms_version`, `terms_accepted_at`;
  - `unit_price`, `quantity` (1–20; diseño = 1), `line_total`, `created_at`.
- Checks: diseño ⇒ tier no null y cantidad 1; merch ⇒ tier null.

**`store_payments`**
- Columnas:
  - `id`, `order_id`, `provider`, `status` (`pending|succeeded|failed|refunded|duplicate`);
  - `amount`, `currency`, `collected_by`, `reference` (≤200), `note` (≤500);
  - `confirmed_by`, `provider_payload jsonb`, `created_at`.
- Índice unique `(provider, reference) where reference is not null and provider <> 'manual'`.
- Grant de columnas para authenticated, solo: `id, order_id, provider, status, amount, currency, collected_by, reference, created_at`.

**`store_licenses`**
- Identidad: `id`, `order_id`, `order_item_id` (unique), `product_id` (set null), `tier`.
- Titular: `holder_user_id` (set null), `holder_name`.
- Vendedor y diseño: `seller_type`, `seller_id`, `seller_display_name`, `seller_username`, `design_title`.
- Términos: `terms_version`, `verification_code` (unique, `WOL-XXXX-XXXX`).
- Uso: `used_at`, `used_note` (≤160).
- Ciclo de vida: `issued_at`, `revoked_at`, `revoke_reason`.
- `metadata_json`, `created_at`.

**`store_download_events`**
- Columnas: `id`, `license_id` (cascade), `asset_id` (set null), `user_id`, `created_at`.
- Escribe solo el servidor (service role). Lectura: vendedor y soporte.

### RLS (resumen)

**Productos, variantes, assets y ajustes**
- Select e insert/update/delete para el vendedor, vía `store_can_manage_seller` (los guards de arriba aplican igual).
- `*_support_all` usa `public.is_support_user()`.
- **Sin grants a anon.**
- Assets: además, `store_design_assets_licensee_read` (select) cuando existe una licencia no revocada del producto con `holder_user_id = auth.uid()`. Así el comprador puede listar la metadata; las descargas van por el servidor.

**Pedidos e ítems**
- Select para el comprador (`buyer_user_id = auth.uid()`), el vendedor y soporte.
- **Sin insert, update ni delete para authenticated.**

**Pagos**
- Select (columnas acotadas) para el comprador, el vendedor y soporte.

**Licencias**
- Select para:
  - el titular (`holder_user_id`);
  - el comprador del pedido (`exists store_orders o where o.id = order_id and o.buyer_user_id = auth.uid()`);
  - el vendedor y soporte.

### Buckets

| Bucket | Público | Límite | MIME | Path |
| --- | --- | --- | --- | --- |
| `store-previews` | sí | 3 MB | jpeg, webp, png (**sin SVG**) | `<seller_id>/<product_id>/<ts>-<n>.<ext>` |
| `store-design-files` | no | 50 MB | png, jpeg, webp, tiff, pdf, `image/vnd.adobe.photoshop`, `application/postscript`, `application/zip` | `<seller_id>/<product_id>/<original\|stencil>/<ts>-<nombre>` |

Policies de `storage.objects`:
- **`store-previews`**:
  - select `to authenticated` sobre la carpeta propia (anti-listado);
  - insert y delete para quien maneja la carpeta.
- **`store-design-files`**:
  - select para la carpeta propia o `is_support_user()`. **Los compradores no tienen policy**: descargan con URL firmada por el servidor;
  - insert para la carpeta propia;
  - delete para la carpeta propia, si no existe `store_design_assets` con ese path cuyo producto tenga licencias;
  - **sin update**.

## 6. RPCs

**Comprador (`to authenticated`)**

`create_store_order(p_product_id uuid, p_variant_id uuid, p_quantity int, p_license_tier text, p_license_holder_name text, p_fulfillment_method text, p_shipping_address jsonb, p_buyer_note text, p_terms_version text, p_idempotency_key text) → public.store_orders`

Valida en este orden:
1. **Idempotencia**: misma `(buyer_user_id, idempotency_key)` devuelve el pedido existente.
2. **Comprador**: email confirmado (`auth.users.email_confirmed_at`) y `p_terms_version` igual a `store_current_terms_version()`.
3. **Producto**: lock `for update`; tiene que estar `active` (`product_unavailable`). Si la reserva del exclusivo venció, **se vence en la misma transacción el pedido que la tenía** (stock y reserva incluidos, condicionado al id).
4. **Vendedor**:
   - comprarse a uno mismo da `own_product` (incluye al dueño del estudio);
   - el vendedor tiene que estar listo: ajustes con `payment_instructions` (cuando el cobrador es `seller`) y `contact_channel` (`seller_not_ready`).
5. **Límites anti-acaparamiento**:
   - 1 pedido `pending_payment` por (comprador, producto) (`pending_order_exists`);
   - hasta 5 pendientes por comprador cada 24 h (`too_many_pending`);
   - 1 reserva exclusiva activa por comprador;
   - cooldown de 7 días para reservar el mismo exclusivo después de que el comprador lo dejó vencer o lo canceló (`exclusive_cooldown`).
6. **Si es diseño**:
   - nivel ofrecido (`tier_unavailable`);
   - `artist` exige artista con registro completo (`artist_tier_requires_artist`);
   - producto reservado por otro pedido da `product_reserved`;
   - `exclusive` además exige `licenses_issued = 0` y ningún otro `pending_payment` del producto (`exclusive_unavailable`), y reserva el producto (`reserved_order_id`, `reserved_until = expires_at`);
   - cantidad 1, método `digital`.
7. **Titular de la licencia**: `artist` usa el nombre de `artists_db`; los otros niveles usan `p_license_holder_name`, o el nombre del comprador si viene vacío.
8. **Si es merch**:
   - variante activa del producto (`variant_required` o `variant_unavailable`), cantidad entre 1 y 20, y hasta 20 unidades pendientes por comprador y variante;
   - stock suficiente (`out_of_stock`); **se descuenta acá**;
   - `pickup` exige `pickup_available`;
   - `shipping` exige `recipient`, `line1`, `city` y `country` ISO-2, y que el país esté en `ships_to_countries` si la lista no está vacía (`ships_to_unsupported`).
9. **Precios desde la base**: precio unitario por nivel o variante (override o base), envío solo si el método es `shipping`.
10. **Cobro**:
    - `buyer_role`, `buyer_name` y `buyer_email` salen de la base;
    - `payment_provider` y `expected_collector` siguen la §2;
    - snapshots de instrucciones (las del vendedor o las de la plataforma) y de contacto, comisión según §4.
11. **Vencimiento**: `expires_at = now() + 24 h`.

**Otras RPC del comprador**

| RPC | Qué hace |
| --- | --- |
| `report_store_payment(p_order_id, p_reference)` | Solo con `pending_payment`. Guarda la referencia, fija `buyer_payment_reported_at` y extiende `expires_at` (y `reserved_until`) a `greatest(actual, now() + 7 días)`. |
| `confirm_store_order_received(p_order_id)` | Merch `paid` con `shipped` o `ready_for_pickup` → `delivered` / `fulfilled`, con `delivered_by = 'buyer'`. Si usa wallet: `funds_release_at = now() + 72 h` y el `payment` pasa a `awaiting_release` con `release_at`. |
| `mark_store_license_used(p_license_id, p_note)` | Solo el titular, con la licencia no revocada y sin uso previo (`license_used`). |

**Comprador, vendedor o soporte**

| RPC | Qué hace |
| --- | --- |
| `cancel_store_order(p_order_id, p_reason)` | Solo con `pending_payment` → `cancelled`. Restituye el stock (`stock = stock + qty where stock is not null`) y libera la reserva condicionada. **Si ya hay un pago informado, solo puede cancelar soporte** (`payment_reported`). |

**Vendedor o soporte**

| RPC | Qué hace |
| --- | --- |
| `confirm_store_order_payment(p_order_id, p_collected_by, p_reference, p_note)` | Detalle debajo de esta tabla. |
| `update_store_order_fulfillment(p_order_id, p_status, p_tracking_carrier, p_tracking_code, p_tracking_url, p_seller_message)` | Solo merch `paid`, siempre hacia adelante. Shipping: `unfulfilled → preparing → shipped`. Pickup: `unfulfilled → preparing → ready_for_pickup` (fija `ready_at`). Pasar a `shipped` fija `shipped_at` y, si el pedido usa wallet, exige tracking (`tracking_required`). **`delivered` lo marcan el comprador, soporte o el mantenimiento.** El vendedor solo puede marcarlo si el pedido **no** usa wallet. `tracking_url` tiene que ser `https://` (`invalid_tracking_url`). |
| `refund_store_order(p_order_id, p_reason)` | Detalle debajo de esta tabla. |
| `adjust_store_variant_stock(p_variant_id, p_new_stock, p_expected_stock)` | Concurrencia optimista: lockea el producto. Si el stock actual es distinto de `p_expected_stock`, devuelve `stock_changed`. |
| `get_store_sales_report(p_seller_type, p_seller_id, p_from date, p_to date)` | Devuelve `table(product_id, title, kind, month date, currency, units, gross_amount, orders)`. Solo cuenta pedidos `paid` o `fulfilled`. |

`confirm_store_order_payment`:
- **Permisos**: `p_collected_by` tiene que ser igual a `expected_collector` (`collector_mismatch`). Si es `seller`, confirman el vendedor o soporte. Si es `platform`, solo soporte.
- **Estado**:
  - Acepta `pending_payment`. Si `expires_at` ya pasó, solo lo acepta cuando hay un pago informado.
  - **Soporte** puede reabrir un `expired` si, con lock, recupera el stock y la reserva; si no puede, devuelve `cannot_reopen`.
  - Un pedido ya pagado con la misma referencia devuelve el pedido sin cambios (idempotente). Con otra referencia: inserta `store_payments` con estado `duplicate`, marca `metadata_json.needs_support` y devuelve el pedido.
- **Validación del diseño**:
  - para `exclusive`: `reserved_order_id = order.id and exclusive_sold_at is null`;
  - para el resto: `exclusive_sold_at is null`, si no `design_no_longer_available`.
- **Efectos**:
  - Registra un `store_payments` con estado `succeeded`.
  - Emite una licencia por ítem de diseño (`licenses_issued += 1`).
  - Exclusivo: `retired`, `exclusive_sold_at` y libera la reserva. Cancela los demás `pending_payment` del producto con `cancel_reason = 'exclusive_sold'`, restituyendo stock.
  - Suma a `sales_count`.
  - Si el diseño es digital: `fulfilled` / `delivered` con `delivered_by = 'auto'`. Merch: pasa a `paid` y copia `pickup_details`.
- **Wallet** (solo si cumple el predicado):
  - inserta el `payment` (`external_reference = 'store:<id>:payment'`, `booking_reference = order_number`, `metadata_json.source = 'store'`, `counterparty_name = buyer_name`);
  - el `status` del `payment` es `awaiting_release` con `release_at = now() + 72 h` si es digital, y `pending_service` si es merch;
  - fija `funds_release_at` (digital) o lo deja en null (merch hasta la entrega).

`refund_store_order`:
- **Permisos**: soporte puede siempre. El vendedor solo si `payment_collected_by = 'seller'` y es digital o merch sin despachar (`unfulfilled` o `preparing`). La UI le muestra el copy «Confirmá que ya le devolviste el dinero».
- **Estados**: pasa `paid` o `fulfilled` a `refunded`.
- **Efectos**:
  - revoca las licencias;
  - `sales_count -= qty`;
  - restituye el stock si no se despachó;
  - si fue exclusivo: limpia `exclusive_sold_at`, el producto pasa a `paused` y `licenses_issued` se recalcula.
- **Wallet** (solo con el predicado):
  - si los fondos no se liberaron, el `payment` pasa a `cancelled`;
  - si ya se liberaron, inserta `refund/completed` por el monto del `release` (`:refund`) y, si hubo comisión, `adjustment/completed` por la comisión (`:fee_reversal`);
  - registra `store_payments` con estado `refunded`.

**Soporte (`to authenticated`; validan `is_support_user()`)**

| RPC | Qué hace |
| --- | --- |
| `set_store_order_funds_hold(p_order_id, p_hold boolean, p_note text)` | Retiene o libera los fondos del pedido. |

**Públicas (`to anon, authenticated`)**

`get_public_storefront(p_seller_type, p_handle) → jsonb`
- Rama `artist`: resuelve con `lower(username) = lower(p_handle)` y `registration_status is distinct from 'incompleto'`. Si hay 0 o más de 1 fila, devuelve null. La rama `studio` devuelve null; la extiende la sesión de estudios.
- Devuelve:
  - `seller`: `{type, id, handle, name, avatar_url, city, country}`. `city` vale null si `user_preferences.privacy->>'show_city' = 'false'`;
  - `allow_search_indexing`;
  - `settings`: `{tagline, shipping_policy, return_policy}`;
  - `products`: array de productos públicos.
- Producto público:
  - `id, kind, title, description, category, tags, currency`;
  - `price_from`: mínimo entre niveles o variantes activas;
  - `license_personal_price`, `license_artist_price`, `license_exclusive_price`;
  - `exclusive_available`: precio no null, sin reserva, `licenses_issued = 0` y sin pendientes;
  - `reserved`: hay una reserva vigente;
  - `licenses_issued`;
  - `design_width_cm, design_height_cm, design_style, placement_suggestion`;
  - `images [{path, alt}]`;
  - `shipping_price_amount, ships_to_countries, ships_to_note, pickup_available, pickup_note`;
  - `variants [{id, label, size, color, price_amount, in_stock, low_stock}]`. `low_stock` vale el stock si es ≤5 y null en otro caso;
  - `published_at`.
- Solo productos `active`.

| RPC | Qué hace |
| --- | --- |
| `get_public_store_product(p_product_id) → jsonb` | `{seller, settings, allow_search_indexing, product}`. Solo `active`; para el resto, null. |
| `verify_store_license(p_code) → jsonb` | `{valid, revoked, used, used_at, tier, design_title, seller_id, seller_display_name, seller_username, holder_initials, issued_at, terms_version}`. Datos personales mínimos: solo iniciales. |

**Servicio (`to service_role`)**

| RPC | Qué hace |
| --- | --- |
| `release_store_order_funds(p_order_id) → boolean` | Exige el predicado del wallet, `fulfilled`, `not funds_hold`, `funds_release_at <= now()` y `funds_released_at` null. En el wallet: reconstruye el `payment` si falta, lo lockea, lo pasa a `completed` (`where status in ('awaiting_release','pending_service')` y `found`) e inserta `release/completed` por el monto del `payment` (`:release`) y `fee/completed` por `platform_fee_amount` si es > 0 (`:fee`). Fija `funds_released_at`. Si falta el wallet, devuelve false. |
| `run_store_maintenance() → jsonb` | (a) Vence los `pending_payment` con `expires_at < now()` y **sin** pago informado: restituye y libera. (b) Los que tienen pago informado y ya vencieron se marcan `metadata_json.needs_support = true`, una sola vez, y no se vencen. (c) Marca `delivered` (`delivered_by = 'auto'`) los `shipped` con `shipped_at + 14 días` y los `ready_for_pickup` con `ready_at + 7 días`. (d) Libera los fondos vencidos. |
| `confirm_store_order_payment_as_provider(p_order_id, p_provider, p_reference, p_amount, p_currency)` | Monto y moneda tienen que coincidir. Efectos iguales a la confirmación con `collected_by = 'provider'`. |

Las dos confirmaciones comparten el helper interno `store_apply_order_payment(…)`, que no tiene grants.

## 7. Servidor

| Archivo | Rol |
| --- | --- |
| `services/store-payments.js` | Registro de adaptadores `{ id, label, isConfigured(), createCheckout(order) → {mode, instructions?, redirectUrl?}, parseWebhook?, verifyWebhook? }`. `registerProvider` valida la interfaz y exige `verifyWebhook(rawBody, headers)` (HMAC con `crypto.timingSafeEqual`) si hay `parseWebhook`. También exporta `getProvider` y `listProviders`. Solo trae `manual`. |
| `services/store-orders.js` | Handlers con `deps` inyectables (`resolveUser`, `repo`, `providers`, `now`, `env`), testeables sin red. Devuelven `{ success, error }`, con mensajes en español. |
| `lib/repos/store.js` | Service role sobre `pgrest`: `getOrderWithItems(id)`, `getLicenseForHolder(licenseId, userId)`, `getAsset(assetId)`, `countDownloadsToday(licenseId)`, `insertDownloadEvent(...)`, `runMaintenance()` y `confirmProviderPayment(...)` (estos dos con `pgrest.raw('rpc/…')`). |
| `lib/storage-sign.js` | `signStorageObject(bucket, path, {expiresIn, download})`. Firma con service role (`POST /storage/v1/object/sign/<bucket>/<path>`). Centraliza la config y los headers, como `lib/instagram-import.js:392-420`. |

Endpoints:
- `POST /api/store/licenses/:licenseId/assets/:assetId/url`. Lleva `authLimiter` y Bearer (`resolveBearerUser`).
  1. La licencia tiene que ser del titular o del comprador del pedido, y no estar revocada (si no, 403 o 410).
  2. El asset tiene que pertenecer al producto de la licencia.
  3. Tope de 50 descargas por licencia y por día (429).
  4. Registra el evento.
  5. Firma por **300 s fijos** con `download = file_name` y devuelve `{ success, url, expires_in }`.
- `POST /api/store/orders/:id/checkout`. Bearer; tiene que ser el comprador dueño y el pedido estar `pending_payment`. Delega en el adaptador. En modo `manual`, el front **no lo llama**: pinta las instrucciones desde la fila.
- `POST /api/store/maintenance`. Exige `X-Cron-Token === CRON_API_TOKEN` y llama a `run_store_maintenance`. Lo dispara un job de n8n cada hora (pendiente de crear).
- `POST /api/store/payments/webhook/:provider`. Usa `express.raw({ type: '*/*', limit: '1mb' })` y va registrado **justo antes** de `app.use(express.json(...))`. `apiLimiter` lo saltea (`skip`), y tiene un limiter propio. Sin adaptador con `parseWebhook`, responde 404. Hay un test de fuente que verifica el orden.

## 8. Frontend

### 8.1 Lógica pura

Son módulos UMD, testeables con `node:test`.

**`public/shared/js/store-model.js`** → `window.WeotziStoreModel`

Constantes:
- **`STATUS_LABELS`**, con copy fijo:
  - `pending_payment` «Esperando pago», `paid` «Pago confirmado», `fulfilled` «Completado», `cancelled` «Cancelado», `refunded` «Reembolsado», `expired` «Vencido»;
  - fulfillment: `unfulfilled` «Por preparar», `preparing` «En preparación», `shipped` «Enviado», `ready_for_pickup` «Listo para retirar», `delivered` «Entregado»;
  - producto: `draft` «Borrador», `active` «Publicado», `paused` «Pausado», `retired` «Retirado».
- **`STATUS_TAGS`**: mapea cada estado a una clase `wo-tag wo-tag--*`.
- **`LICENSE_TIERS`**: id, label, resumen, bullets y `requiresArtist`. **`TERMS['2026-10']`**: textos completos por nivel más las reglas comunes. **`TERMS_VERSION`**.
- **`FILES`**:
  - `PREVIEW_MAX_BYTES = 3 MB`, `ORIGINAL_MAX_BYTES = 50 MB`, `STENCIL_MAX_BYTES = 20 MB`;
  - las listas `PREVIEW_MIME`, `ORIGINAL_MIME` y `STENCIL_MIME` (iguales a la migración; las fija un test de contrato);
  - `EXTENSION_MIME`: de `psd` a `image/vnd.adobe.photoshop`, `ai`/`eps` a `application/postscript`, `procreate` a `application/zip`, y así.
- **`ERROR_COPY`**: el copy de cada código `store:*`.
- **`VERIFY_PARAM = 'verificar'`**.

Funciones:
- **Montos**: `formatMoney(amount, currency)` envuelve `WeOtziCurrency` si existe y siempre muestra el código ISO («USD 50», «ARS 65.000»). **Nunca convierte** según la preferencia del visitante.
- **Precios y niveles**:
  - `unitPriceFor(product, {tier, variantId})`, `orderTotals(product, {tier, variantId, quantity, method})`, `priceFrom(product)`;
  - `availableTiers(product, {viewerIsArtist})`: devuelve `[{id, available, reason}]`.
- **Envío**: `canTransitionFulfillment(method, from, to, {actor, usesWallet})` y `nextFulfillmentSteps(...)`.
- **Validación**: `publishChecklist(product, {variants, assets, settings})` devuelve `[{key, ok, label}]`. Es espejo del guard. También `validateProductDraft(form)`, `validateShippingAddress(addr, product)` y `isHttpsUrl`.
- **Vistas**: `orderView(order)` (labels, tags, timeline y próxima acción por rol), `licenseView(license)` y `errorMessage(err)`.
- **Archivos y rutas**:
  - `contentTypeFor(fileName, fileType)`, `validateFile(kind, file)`;
  - `buildAssetPath(sellerId, productId, kind, fileName, ts)`, `buildPreviewPath(sellerId, productId, ts, n, ext)`;
  - `sanitizeFilename`, `normalizeUsername` (agrega `.wo` si falta, igual que `artist-profile.js:152-155`);
  - `storeUrl(handle)`, `itemUrl(id)`, `checkoutUrl({...})`.

**`public/shared/js/store-watermark.js`** → `window.WeotziStoreWatermark`
- Funciones puras: `fitWithin(w, h, max)`, `tilePositions(w, h, step)`, `watermarkLabel(handle)` y `encodePlan(...)`.
- Funciones de navegador:
  - `renderPreview(file, {maxSide: 1600, label})`:
    1. Convierte HEIC con `convertIfHEIC` si `heic-converter.js` está cargado.
    2. Dibuja en canvas una marca diagonal repetida «WE ÖTZI · @usuario».
    3. Intenta exportar con `toBlob('image/webp', 0.82)`. Si `blob.type` no es webp (Safari), vuelve a exportar como `image/jpeg` 0.82.
    4. Mientras el resultado pase de 3 MB, baja la calidad y después el lado.
    5. Devuelve `{blob, ext, contentType, width, height}`.
  - `renderPlain(file)`: para merch, sin marca.

### 8.2 Repo de datos

**`public/shared/js/data/store-repo.js`** → `window.WeotziData.Store`. Es el único acceso a datos de la Store. Sigue el patrón de `account-repo.js`: `run()`, `availabilityProbe` y `isAvailable()`.

- **Entorno**:
  - `isAvailable()`: HEAD a `store_products` cacheado; false ante 404, `PGRST202` o `PGRST205`.
  - `isPreviewEnv()`: `window.WEOTZI_PREVIEW === true || (window.WoDemo && WoDemo.enabled)`.
  - `featureEnabled()`: `ConfigManager.features.store === true || isPreviewEnv()`.
  - `previewUrl(path)`: si `path` empieza con `demo/` o `data:`, apunta al asset de demo (con `WEOTZI_BASE_PATH`); si no, `storage.from('store-previews').getPublicUrl(path)`.
- **Vendedor**:
  - Productos: `listMyProducts(sellerType, sellerId)`, `getMyProduct(id)` (con variantes, assets y ajustes), `createProduct(fields)`, `updateProduct(id, patch)` (whitelist), `setProductStatus(id, status)`, `deleteDraftProduct(id)`.
  - Variantes: `saveVariants(productId, variants)` hace upsert por `id` y manda solo los cambios. **Nunca reemplaza todo ni borra variantes con pedidos**: esas se desactivan. `adjustStock(variantId, newStock, expectedStock)` es una RPC.
  - Imágenes: `uploadPreviewImage(sellerId, productId, blob, index, contentType)` devuelve `{path}`. `removePreviewImage(path)`.
  - Archivos de diseño: `uploadDesignAsset(sellerId, productId, kind, file)` sube primero y después inserta la fila; si falla, compensa con `remove`. `removeDesignAsset(asset)`.
  - Ajustes: `getSellerSettings(sellerType, sellerId)`, `saveSellerSettings(sellerType, sellerId, patch)`.
  - Pedidos: `listSellerOrders(sellerType, sellerId)`, con ítems, licencias y pagos, todo con columnas explícitas. Acciones: `confirmPayment(orderId, {collectedBy, reference, note})`, `updateFulfillment(orderId, {...})`, `cancelOrder(orderId, reason)`, `refundOrder(orderId, reason)`.
  - Reporte: `getSalesReport(sellerType, sellerId, from, to)`.
- **Público**: `getStorefront(sellerType, handle)`, `getPublicProduct(id)` y `verifyLicense(code)`, todos por RPC. No lanzan: devuelven null y loguean un warning.
- **Comprador**:
  - Pedidos: `createOrder(input)`, `getMyOrder(id)`, `listMyPurchases(userId)`.
  - Acciones: `reportPayment(orderId, reference)`, `confirmReceived(orderId)`, `cancelOrder` (compartido).
  - Licencias: `getLicense(id)`, `markLicenseUsed(id, note)`, `listLicenseAssets(productId)`.
  - Descargas: `getDownloadUrl(licenseId, asset)` hace POST al endpoint del servidor con Bearer y `WEOTZI_BASE_PATH`.
- **Soporte**: `listPendingPlatformOrders()`, `listFlaggedOrders()` y `setFundsHold(...)`.
- **En el preview o el demo** (`isPreviewEnv`), **ningún método llama a Storage ni al servidor**:
  - `uploadPreviewImage` reduce la imagen a ≤900 px como data URL y devuelve `{path: 'data:…'}`;
  - `uploadDesignAsset` inserta la fila con `storage_path = 'demo/<productId>/<kind>/<ts>-<nombre>'`;
  - los métodos de borrado solo tocan la fila;
  - `getDownloadUrl` devuelve `/shared/assets/demo/store/<original|stencil>.<ext>` según `asset.kind` y `mime_type`.

  Un test con sandbox `vm` y un `_supabase.storage` falso verifica que no se llame a Storage.
- **Queries**: no filtran sobre recursos embebidos ni usan `overlaps` ni `textSearch`. Las selects se exportan (`STORE_SELECTS`) para que un test las corra contra el emulador.

### 8.3 Topbar y sesión de las páginas `/store/*`

`public/shared/js/store-shell.js` → `window.WeotziStoreShell` define:
- `mountStoreTopbar(root, {active})`, con tres estados:
  - **anónimo**: la nav pública de `explore/index.html:23-36` más «Acceder»;
  - **cliente**: la nav de cliente más «Compras»;
  - **artista**: «Dashboard →», «Mi Store» y «Mis compras».

  El rol sale de `_supabase.auth.getSession()` y de una consulta a `WeotziData.Artists.getByUserId`. No monta el selector de `account-modes`.
- `notify(msg, tone)`, que es el toast.
- `openDialog` y `closeDialog`, con focus trap y Escape.
- `requireSession({returnTo})`, que devuelve la sesión o null.
- `loginLinks(returnTo)`: arma `/client/login?returnTo=…`, `/client/register?returnTo=…` y `/artist/login?returnTo=…`.

El CSS base de las páginas públicas está en `public/shared/css/store-ds.css` (shell, topbar, cards, tags, toasts, diálogos). Las páginas `/store/*` cargan `wo-demo.js` como **primer** script y **no** cargan `client-auth.js`; la excepción es el checkout, que lo usa para el ingreso inline.

**Cambios compartidos en `client-auth.js`**:
- Soporte de `?returnTo=` con un `normalizeReturnTo` que acepta solo paths del mismo origen que empiecen con `/store/`.
- Se aplica al redirect después del login, a `emailRedirectTo` del signUp y a `redirectTo` de Google.
- Los artistas se aceptan: el checkout no corta con `isArtist`.

### 8.4 Páginas

| Ruta | Archivos | Contenido |
| --- | --- | --- |
| `/artist/store/` | `public/artist/store/index.html`, `public/shared/js/artist-store.js`, `public/shared/css/artist-store-ds.css` | Ver el detalle debajo de la tabla. |
| `/store/?artist=<username>` | `public/store/index.html`, `public/shared/js/store-catalog.js`, `public/shared/css/store-catalog.css` | Vitrina con header del artista, «Ver perfil →» y chips Todo · Diseños · Merch. Grilla de cards con badges («Exclusiva disponible», «Reservado», «Últimas N unidades»). Respeta `allow_search_indexing` en `<meta name="robots">`. Vacío: «Este artista todavía no publicó diseños ni merch. Mirá su portafolio →». |
| `/store/item/?id=` | `public/store/item/index.html`, mismo JS y CSS | Ficha con galería. Diseño: tres cards de nivel (las no disponibles van deshabilitadas con motivo; `artist` para quien no es artista muestra «Solo para cuentas de artista» con link al login de artista), «Qué incluye», medidas, estilo y términos plegables. Merch: variante, cantidad, envío y países, retiro. CTA «Comprar →». |
| `/store/checkout/?item=&license=&variant=&qty=` | `public/store/checkout/index.html`, `public/shared/js/store-checkout.js`, `public/shared/css/store-buyer.css` | Ver el detalle debajo de la tabla. |
| `/store/purchases/` | `public/store/purchases/index.html`, `public/shared/js/store-purchases.js`, mismo CSS | Cards de pedidos; `?pedido=` abre el detalle. Timeline, instrucciones y contacto, «Ya pagué →», cancelar. Descargas: Original, Stencil, «Imprimir a escala real» (solo PNG/JPEG/WebP con medidas) y Certificado. «Marcar licencia como usada». Seguimiento y «Ya lo recibí →». Ayuda: «¿Problemas con tu pedido? Escribile al vendedor o a soporte →». Vacío: «Todavía no compraste nada. Explorá artistas →». Sin sesión: links de login con `returnTo`. |
| `/store/license/?id=` · `?verificar=` | `public/store/license/index.html`, `public/shared/js/store-license.js`, mismo CSS | `?id=` (titular, comprador o vendedor): certificado imprimible con `@media print`, con nivel, titular, diseño, autor, fecha, código y uso. `?verificar=`: resultado público. |

`/artist/store/` en detalle:
- **Header**: «Store» / «Tu Store» / «Vendé merch y diseños con licencia de uso.». Botones «+ Nuevo diseño», «+ Nuevo producto» y «Ver tu Store pública →».
- **Stats**: ventas del mes (`get_store_sales_report`), pagos por confirmar, pedidos por preparar y productos publicados.
- **Tabs**: Diseños · Merch · Pedidos · Ajustes.
- **Editor** (drawer o modal con focus trap):
  - datos del producto;
  - licencias: 3 cards con un toggle y el precio;
  - archivos privados: original y stencil;
  - imágenes: con marca de agua automática para diseños;
  - variantes con stock: el stock se ajusta vía `adjustStock`;
  - envío: países y precio; retiro: nota pública;
  - checklist de publicación en vivo.
- **Pedidos**:
  - chips Por confirmar pago · Por preparar · Enviados · Completados · Cancelados;
  - un drawer de detalle con comprador, dirección, ítem y licencia;
  - pago: instrucciones, referencia informada y «Confirmar pago recibido» (modal con referencia y nota);
  - stepper de envío con formulario de tracking; cancelar o reembolsar según las reglas.
- **Ajustes**: tagline, contacto, instrucciones de pago (con ayuda: «Indicá cómo pagar el monto exacto en la moneda del producto»), políticas, dirección de retiro (privada) y la declaración de autoría. Si falta algo, alerta de primer uso.
- **Estados por query**: `?tab=disenos|merch|pedidos|ajustes`, `?nuevo=diseno|merch`, `?editar=<id>`, `?pedido=<id>`, `?modal=confirmar-pago`.

`/store/checkout/` en detalle:
- **Sin sesión**:
  - ingreso inline con email y contraseña (`ClientAuth.login`, aceptando artistas);
  - links «Creá tu cuenta →» y «¿Sos artista? Ingresá →» con `returnTo`;
  - los parámetros se guardan en `sessionStorage` (`wo_store_checkout`).
- **Con sesión**:
  - resumen;
  - titular de la licencia (no editable para `artist`);
  - envío (país ISO-2 desde una lista) o retiro;
  - nota;
  - casilla de términos;
  - «Confirmar pedido →», que manda `idempotency_key` como UUID generado una vez y guardado en `sessionStorage`.
- **Después de crear el pedido**: pantalla «Pedido creado» con el total en código ISO y «Tenés hasta el {fecha} para pagar». Muestra las instrucciones y el contacto del vendedor, el form «Ya pagué → informar comprobante» y «Ver mis compras →».

### 8.5 Integraciones

Son cambios mínimos en archivos compartidos y todos quedan detrás del gate.

- **Gate común**: `WeotziData.Store.featureEnabled() && await WeotziData.Store.isAvailable()`. Agregar `features.store: false` en `public/shared/js/app-config.json`.
- **Perfil público** (`public/artist/profile/index.html`, `artist-profile.js`): banda `#store-band` entre Portafolio y Residencias, que nace `hidden`. Muestra hasta 6 ítems y «Ver la Store →», y se oculta en silencio si no hay productos.
- **Menú Ö** (`wo-artist-menu.js`):
  - en `renderDrop`, los links «Mi Store» y «Mis compras» con `appPath()`;
  - una fuente `store` en `loadAll` con dos tipos de ítem:
    - pedidos `pending_payment` con pago informado: «Pago informado · Pedido #ST-… · Confirmalo antes del {fecha}»;
    - merch `paid` sin despachar;
  - un `activityRow` «Pedidos de la Store» con contador, que alimenta el badge.
- **Topbars de cliente** (`public/client/dashboard|chats|requests|profile/index.html`): un link «Compras» a `/store/purchases/`, oculto por defecto y mostrado por el gate.
- **Soporte** (`public/shared/js/support-dashboard-store.js` y `public/support/dashboard/index.html`): pestaña STORE con el patrón de `support-dashboard-tickets.js`. Lista los pedidos `platform` por confirmar, los marcados `needs_support` y los que tienen `funds_hold`. Acciones: confirmar, reembolsar y retener.
- **Wallet**: `wallet-model.js` `normalizeMovement` agrega `source` y `orderNumber`, y `wallet-account.js` `movementMeta` muestra «Pedido #ST-…» cuando `source === 'store'`.
- **Docs**: `docs/MAPA_APLICACION.md` (rutas y esquema) y `docs/TECHNICAL.md` (endpoints).

### 8.6 Demo y preview

- **Emulador** (`public/shared/js/wo-demo-postgrest.js`): envolver la llamada al handler de RPC en `try/catch` y responder `400 { code: 'P0001', message: err.message }`. Hoy un `throw` en el modo demo termina repitiendo el request contra Supabase vivo. Se cubre con un test.
- **Extensión** `public/shared/js/demo-fixtures/store.js` (`WoDemoFixtureExtensions['store']`):
  - declara las 9 tablas y la pseudo-tabla `store_demo_sellers` con `ctx.TABLES.push`;
  - asigna `ctx.tables.*` y `ctx.relations`: productos → variantes y assets; pedidos → ítems, licencias y pagos; licencias → pedido;
  - simula **todas** las RPC con las mismas validaciones y los mismos códigos `store:*`, usando `throw new Error('store:<código>')`.
- **Datos de la extensión**:
  - **Vendedor demo** (la identidad): 3 diseños (uno con exclusiva disponible, uno reservado, uno retirado por venta exclusiva) y 3 merch (remera con talles, print y sticker).
  - **Pedidos que recibe**: pendiente con pago informado, pagado por preparar, enviado, y digital completado con licencia.
  - **Segundo vendedor ficticio**: «Mara Ink» (`mara-ink.wo`, solo en `store_demo_sellers`, nunca en `artists_db`), con productos activos.
  - **Compras del usuario demo a Mara**: un diseño pagado con licencia y assets, y un merch enviado.
  - **Vitrina**: la RPC simulada resuelve solo el handle de la identidad y los de `store_demo_sellers`; para el resto devuelve null.
- **Registro**: se agrega `'store'` a `EXTENSIONS` en `wo-demo-fixtures.js` y se sube `VERSION` en `wo-demo.js`.
- **Assets de demo**: `public/shared/assets/demo/store/` con previews y archivos SVG o PNG livianos, más `original.svg` y `stencil.svg`.

### 8.7 Contratos de tests (respetar o actualizar)

- **`/artist/store/index.html`**:
  - `wo-demo.js` como primer script;
  - un único `<weotzi-product-nav active="store" menu-id="st-mobile-menu" menu-toggle-id="st-mobile-menu-toggle" logout-id="st-logout" …>`, más `organisms.css` y `organisms.js`;
  - `wo-artist-menu.js` con `defer`;
  - un único `<weotzi-product-footer>`.
- **Listas de páginas**: agregarla a `ARTIST_PAGES` (`tests/demo-tour.test.js`) y a las dos listas de `tests/mobile-topbar-responsive.test.js`.
- **Lo que no se toca**: `DATA.navigation` (`tests/components-catalog.test.js` fija 7 destinos) y `wo-tour-steps.js` (son 13 capítulos fijos).
- **CSS nuevo**: `:not([hidden])`; nunca `.x[hidden]{display:flex}` (`tests/hidden-overlays.test.js`).
- **Páginas `/store/*`**: `wo-demo.js` como primer script.
- **Tests nuevos**:
  - `tests/store-model.test.js`;
  - `tests/store-schema.test.js`: grants por función (incluido `anon` y `authenticated` en los revokes), `search_path = ''`, sin grants de insert/update a `authenticated` en pedidos, pagos, licencias ni wallet, sin `update` en `store-design-files`, sin SVG en previews, MIME y límites iguales a `store-model`, rollback completo y archivo único;
  - `tests/store-demo-fixtures.test.js`: RPC simuladas, compra, pago, exclusiva, reembolso y selects del repo contra el emulador;
  - `tests/store-repo-preview.test.js`: cero llamadas a Storage en el preview;
  - `tests/store-server.test.js`: handlers con `deps`, firma de descargas, cron token, registro de adaptadores y orden webhook → `express.json`;
  - `tests/store-pages.test.js`: contratos de cada página y ausencia de CRUD ad-hoc (`/rest/v1/` inline, `_supabase.from(`).

## 9. Fuera de alcance de v1 (pendientes)

- **Emails transaccionales**: pedido creado, pago informado (al vendedor), pago confirmado y enviado. Hay que sumar eventos en `email-event-mapping`, plantillas, el endpoint `POST /api/store/orders/:id/notify` y la sincronización con n8n.
- **Hilo de Inbox por pedido**: `inbox_threads.category` no admite `store`, y el cliente no tiene UI de `inbox_threads`.
- **Adaptadores reales de Stripe y Mercado Pago**, con claves de test.
- **Carrito con varios ítems.**
- **Disputas de la Store en el centro de soporte**: hoy hay `funds_hold` y reembolso.
- **Modo «Diseños» en `/marketplace`.**
- **Endurecer `artists_db`**: `username` único (`lower`) y policy de insert.
- **Aplicar las migraciones en Supabase vivo**: primero `20261028150000_artist_wallet.sql`, después `store_core`. Activar `features.store` y crear el job de n8n de mantenimiento.
- **Wallet**: mostrar el saldo negativo como «Saldo adeudado», porque hoy `summarize` lo recorta a 0, y tomar el disponible desde la RPC.
- **Revisión legal** de los textos de licencia.
