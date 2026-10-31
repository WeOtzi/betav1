# Campos actuales de Estudios

Verificado el 31/10/2026 mediante `information_schema.columns` del proyecto **We Otzi App - Beta**. Solo se consultó estructura; no se leyeron perfiles ni datos personales.

La base activa tiene **42 columnas en `studios` y 28 en `studio_locations`**. Nulabilidad de base de datos y obligatoriedad del formulario son reglas diferentes.

## Campos del registro

| Paso | Campos actuales | Obligatorios |
| --- | --- | --- |
| Cuenta | Nombre del estudio, email, contraseña, repetir contraseña | Nombre de 2–160 caracteres; email válido; contraseña de 8 o más caracteres y repetición coincidente. Con sesión existente se usa su email y se omite contraseña. |
| Identidad | Frase corta/tagline, descripción/bio, año de fundación, idiomas, Instagram, sitio web, WhatsApp | Ninguno. Tagline hasta 120 caracteres, bio hasta 2000; año entero de 1900 al actual; web HTTP/HTTPS. |
| Sedes | Etiqueta, dirección, país, provincia/estado, ciudad, localidad/barrio, calle, número, unidad/piso, código postal, pin/coordenadas, sede principal y sede activa | Al menos una dirección confirmada; de 1 a 30 sedes; una principal activa. En ingreso manual: dirección, país y ciudad. |
| Fotos | Portada, logo, galería; archivos o enlaces alternativos | Opcionales. JPG, PNG o WebP, máximo 5 MB cada uno; hasta 8 imágenes de galería entre archivos y URLs. |
| Confirmación | Resumen y confirmación de la cuenta por email cuando Auth lo exige | No incorpora campos nuevos. |

La contraseña y su repetición pertenecen a **Supabase Auth**: no son columnas de `studios`, ni se guardan en los borradores o en la metadata del perfil.

## Ficha del estudio: `studios`

| Campo | Tipo | Admite vacío en BD | Valor inicial |
| --- | --- | --- | --- |
| `id` | UUID | No | `gen_random_uuid()` |
| `name` | Texto | No | — |
| `normalized_name` | Texto | No | — |
| `ubicacion` | Texto | Sí | — |
| `created_at` | Fecha y hora | No | `now()` |
| `updated_at` | Fecha y hora | No | `now()` |
| `country` | Texto | Sí | — |
| `country_code` | Texto | Sí | — |
| `state_province` | Texto | Sí | — |
| `city` | Texto | Sí | — |
| `locality` | Texto | Sí | — |
| `street` | Texto | Sí | — |
| `street_number` | Texto | Sí | — |
| `unit` | Texto | Sí | — |
| `postal_code` | Texto | Sí | — |
| `formatted_address` | Texto | Sí | — |
| `latitude` | Número decimal | Sí | — |
| `longitude` | Número decimal | Sí | — |
| `google_place_id` | Texto | Sí | — |
| `phone` | Texto | Sí | — |
| `website` | Texto | Sí | — |
| `geocoded_at` | Fecha y hora | Sí | — |
| `user_id` | UUID | Sí | — |
| `email` | Texto | Sí | — |
| `slug` | Texto | Sí | — |
| `tagline` | Texto | Sí | — |
| `bio` | Texto | Sí | — |
| `cover_image` | Texto | Sí | — |
| `logo_image` | Texto | Sí | — |
| `photo_feed_items` | JSON | No | `'[]'::jsonb` |
| `founded_year` | Entero | Sí | — |
| `languages` | Lista de textos | No | `ARRAY[]::text[]` |
| `instagram` | Texto | Sí | — |
| `tiktok` | Texto | Sí | — |
| `whatsapp` | Texto | Sí | — |
| `contact_phone` | Texto | Sí | — |
| `is_verified` | Booleano | No | `false` |
| `is_active` | Booleano | No | `true` |
| `profile_complete` | Booleano | No | `false` |
| `primary_location_id` | UUID | Sí | — |
| `google_maps_url` | Texto | Sí | — |
| `is_seeking_artists` | Booleano | No | `false` |

## Sedes del estudio: `studio_locations`

| Campo | Tipo | Admite vacío en BD | Valor inicial |
| --- | --- | --- | --- |
| `id` | UUID | No | `gen_random_uuid()` |
| `studio_id` | UUID | No | — |
| `label` | Texto | Sí | — |
| `is_primary` | Booleano | No | `false` |
| `is_active` | Booleano | No | `true` |
| `sort_order` | Entero | No | `0` |
| `country` | Texto | Sí | — |
| `country_code` | Texto | Sí | — |
| `state_province` | Texto | Sí | — |
| `city` | Texto | Sí | — |
| `locality` | Texto | Sí | — |
| `street` | Texto | Sí | — |
| `street_number` | Texto | Sí | — |
| `unit` | Texto | Sí | — |
| `postal_code` | Texto | Sí | — |
| `formatted_address` | Texto | Sí | — |
| `latitude` | Número decimal | Sí | — |
| `longitude` | Número decimal | Sí | — |
| `google_place_id` | Texto | Sí | — |
| `geocoded_at` | Fecha y hora | Sí | — |
| `phone` | Texto | Sí | — |
| `hours_json` | JSON | Sí | — |
| `created_at` | Fecha y hora | No | `timezone('utc'::text, now())` |
| `updated_at` | Fecha y hora | No | `timezone('utc'::text, now())` |
| `photo_feed_items` | JSON | No | `'[]'::jsonb` |
| `workstation_photos` | JSON | No | `'[]'::jsonb` |
| `google_maps_url` | Texto | Sí | — |
| `is_seeking_artists` | Booleano | No | `false` |

## Campos todavía no presentes en beta

La migración local `20261028180000_invitaciones_estudios_contacto.sql` propone nueve columnas que **no aparecen en el esquema remoto consultado**: `specialty_styles`, `station_count`, `equipment`, `artist_requirements`, `default_revenue_split_pct`, `accepts_guest_spots`, `guest_window_start`, `guest_window_end` y `accepts_artist_inquiries`. No se aplicó esa migración en esta tarea.

`workstation_photos` existe en las sedes; no existe en `studios`. Los campos de dirección en `studios` reflejan la sede principal. `id`, `user_id`, `normalized_name`, `slug`, fechas y estados son campos de sistema; no se solicitan como datos libres en el registro.

Spots, invitaciones, equipo, trabajos, inventario, facturación y contratos usan tablas relacionadas; sus campos no forman parte de estas dos fichas ni del alta inicial.
