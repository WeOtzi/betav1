# Supplies en We Ötzi

Actualizado: 2026-10-30. Diseño y contrato entre módulos: [docs/plans/2026-10-30-estudios-plataforma.md](plans/2026-10-30-estudios-plataforma.md).

## Qué es

Supplies es el tipo de cuenta de las tiendas de insumos para tatuaje: tintas, cartuchos y agujas, guantes, papel y film, higiene, aftercare, piercing y equipos. Los estudios les compran directo desde **Reposición**, en el panel del estudio. Cada pedido tiene el descuento We Ötzi que define la tienda, más los beneficios por volumen.

## Rutas

| Ruta | Función |
| --- | --- |
| `/supplies/register` | Alta en 3 pasos: cuenta, negocio y condiciones comerciales. El signUp guarda un borrador en `user_metadata.supplies_registration`, sin email ni contraseña. Después de confirmar el email, `complete_supply_vendor_registration` crea el vendor. |
| `/supplies/login` | Login, recuperación por enlace o código y banner de email confirmado. |
| `/supplies/dashboard` | Pestañas Inicio, Pedidos, Catálogo, Beneficios, Clientes, Reportes, Perfil y Cuenta. |

Los redirects `/supplies/login?confirmed=1` y `/supplies/login?recovery=1`, y sus variantes `/beta`, tienen que estar en la lista de URLs de redirect de Supabase Auth, igual que los de `/studio/login`.

## Verificación

Una tienda nueva arranca con `is_verified = false` y los estudios no ven su catálogo. Su Inicio muestra "Tu cuenta está en revisión". Soporte la verifica desde el backoffice, en **Revisiones → Proveedores Supplies**. Un guard impide que el dueño cambie `is_verified`, `user_id`, `email` o `slug`.

## Precios y beneficios

- `platform_discount_pct`: el descuento We Ötzi, entre 0 y 60 %.
- `supply_discount_tiers`: descuentos extra a partir de un subtotal.
- El descuento total es `min(60, We Ötzi + mejor tier alcanzado)`.
- `min_order_amount` es el mínimo de compra. `free_shipping_threshold` da envío gratis cuando `subtotal − descuento ≥ umbral`.
- Todos los productos están en la moneda de la tienda.
- `submit_supply_order` calcula los precios en el servidor y guarda un snapshot por línea. El frontend usa `WeotziData.Supplies.estimateOrder` solo para mostrar el estimado, con la misma regla en centavos.

## Ciclo de un pedido

| Estado | Quién | Qué pasa |
| --- | --- | --- |
| `submitted` | Estudio | Envía el pedido con la sede de entrega. Se valida que los productos estén activos, el mínimo, la compra mínima por producto y el stock (blando). |
| `confirmed` | Tienda | Fija el envío (0 si corresponde envío gratis) y descuenta el stock controlado, guardando cuánto descontó. |
| `rejected` | Tienda | Solo desde `submitted`. |
| `shipped` | Tienda | Con código de seguimiento opcional. |
| `delivered` | Tienda | — |
| `received` | Estudio | `receive_supply_order` (idempotente) repone el inventario con `restock`, convirtiendo packs a unidades con `pack_size`. Si hace falta crea el ítem o el proveedor del estudio y registra el gasto `inventory_purchase` en Finanzas por lo recibido más el envío. Los faltantes quedan como "Recepción parcial". |
| `cancelled` | Estudio (`submitted`/`confirmed`) o tienda (`confirmed`) | Restaura exactamente el stock descontado. |

Cada transición queda en `supply_order_events` y notifica a la otra parte por `/api/supplies/notify`. El destinatario siempre es el email de auth del dueño.

## Datos

`supply_vendors`, `supply_vendor_private` (datos fiscales), `supply_vendor_counters` (numeración `P-YYYY-NNNNN`), `supply_products`, `supply_discount_tiers`, `supply_orders`, `supply_order_items` y `supply_order_events`. Vistas: `supply_vendor_sales_monthly` y `supply_vendor_customers`. Bucket público `supply-photos`, con imágenes bajo `<vendor_id>/`.

Del lado del estudio:
- `studio_inventory_items.supply_product_id` vincula el ítem con el producto para sugerir reposiciones.
- `studio_suppliers.vendor_id` vincula el contacto con la tienda.
- `studio_finance_entries.supply_order_id` vincula el gasto con el pedido.

## Estado de la entrega

La migración `supabase/migrations/20261030204000_supplies_marketplace.sql` está **NO aplicada**. Tiene su rollback y su test SQL (`supabase/tests/supplies_marketplace.sql`), validado contra la base viva dentro de `BEGIN … ROLLBACK`. Mientras no se aplique, las páginas Supplies muestran "falta aplicar una migración" y no permiten crear cuentas.
