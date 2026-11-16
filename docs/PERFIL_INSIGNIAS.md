# Perfil público del artista: insignias, compartidos y tarjeta para compartir

Ronda 2 · frente "perfil". Migración `supabase/migrations/20261116180000_perfil_insignias_most_wanted.sql`
(reversa en `supabase/rollbacks/`). Código: `lib/routes/perfil.js`, `lib/most-wanted.js`,
`lib/repos/perfil-trending.js`, `public/shared/js/wo-share-cards.js`,
`public/shared/js/data/profile-public-repo.js`.

## Insignias públicas

| Insignia | De dónde sale | Quién la cambia |
| --- | --- | --- |
| Embajador We Ötzi | `artists_db.embajador = 'si'` | Soporte (backoffice / support dashboard). El trigger `trg_guard_artist_embajador` impide que el artista se la escriba por API. |
| Most Wanted | `public.artist_most_wanted` (top de su zona) | `public.recalculate_most_wanted()`, a diario. |

### El campo público

`rpc/get_artist_public_badges(p_artist_user_id uuid) → jsonb` (anon y authenticated):

```json
{
  "ambassador": true,
  "most_wanted": true,
  "most_wanted_rank": 1,
  "most_wanted_zone": "Buenos Aires",
  "most_wanted_zone_level": "city",
  "most_wanted_since": "2026-11-15T03:40:00Z"
}
```

- `most_wanted` (booleano) y `most_wanted_rank` (1 = primero de su zona) son lo único que
  se publica del ranking. **Nunca** se exponen los conteos ni el puntaje.
- `most_wanted_zone` respeta la privacidad `show_city` del artista: con la ciudad oculta
  devuelve el país y `most_wanted_zone_level = 'country'`.

Para grillas y listas (tarjetas del marketplace, sugerencias del cotizador) no hace falta una
llamada por artista: la tabla `public.artist_most_wanted` es de lectura pública en las columnas
`artist_user_id, rank, zone_level, awarded_at, computed_at`.

En el navegador (cargar `/shared/js/data/profile-public-repo.js` después de `postgrest-client.js`):

```js
const badges = await WeotziData.ProfilePublic.getBadges(artist.user_id);   // un artista
const wanted = await WeotziData.ProfilePublic.mostWantedMap();             // Map(user_id → rank)
const isMostWanted = wanted.has(artist.user_id);
```

En el servidor: `require('./lib/repos/artists-public').ArtistsPublicRepo.getPublicBadges(userId)`.

Los dos métodos del navegador degradan a `null` / `Map` vacío si la migración no está aplicada.

## Most Wanted: cómo se calcula

Ventana móvil de **30 días**. Lógica pura con tests en `lib/most-wanted.js`; la base la
materializa con la misma fórmula.

| Señal | Fuente | Peso |
| --- | --- | --- |
| Visitas al perfil | `artist_profile_visits` (`profile_view`), visitantes únicos por día, tope 300. No cuenta al artista con su sesión | × 1 |
| Cotizaciones recibidas | `quotations_db` con `artist_id`, sin borradores `in_progress`: clientes con cuenta distintos (sin tope) + correos distintos de solicitudes de invitado (tope 3). Las cotizaciones manuales sin cliente vinculado no cuentan | × 6 |
| Veces en favoritos | `client_favorites` + puente opcional (abajo) | × 4 |
| Veces compartido | `artist_profile_shares`, personas distintas por día, tope 40. No cuentan los del propio artista (`is_owner` o su sesión) | × 3 |
| Trabajos completados | `quotations_db` en `completed`, cerradas en la ventana por un cliente con cuenta (`client_completed_at`). `artist_completed` no cuenta | × 8 |

- **Zona**: la ciudad del artista si en ella hay 3 o más perfiles públicos; si no, su país
  ("resto del país"). Sin ciudad ni país el perfil no participa.
- **Cupos por zona**: 1 ganador hasta 4 perfiles, 2 hasta 8 y 3 desde 9 (tope `p_top_n`).
- **Mínimo de actividad**: puntaje ≥ 12, al menos 2 señales distintas **y** al menos una señal
  que el artista no puede generar solo: una cotización de un cliente con cuenta, un favorito o
  un trabajo cerrado por el cliente. Un perfil vacío, con una sola señal, o que solo suma
  visitas, compartidos y solicitudes de invitado nunca gana. Nadie suma a su propio perfil.
- Los conteos quedan en `public.artist_trend_scores` (privada: el artista lee su fila, soporte
  todas, anon nada). `quotes_account` es la parte de `quotes` que viene de clientes con cuenta.

**Qué se puede forzar todavía.** Las visitas sin sesión y los compartidos anónimos se cuentan
por hash de IP y día: quien cambia de red puede inflarlos, pero ya no alcanzan para ganar
(hace falta la señal de otra cuenta) y tienen tope. Un artista con una segunda cuenta de
cliente verificada sí puede darse esa señal; se detecta mirando `artist_trend_scores`.

### Favoritos del frente "favoritos"

El recálculo no depende de la tabla nueva de favoritos. Si ese frente define la función

```sql
public.wo_favorites_artist_counts(p_since timestamptz)
  returns table (artist_user_id uuid, favorites bigint)
```

se suma sola a los favoritos de `client_favorites` (si no existe o falla, se ignora).

**Estado al cierre de la ronda 2 (CF-08).** El frente "favoritos" no definió esa función:
publicó `public.favorite_artist_save_counts(uuid[])`, con otra firma y otro propósito
(contadores públicos). Hoy:

- Guardar al **artista** en una lista sí cuenta: el trigger espejo de
  `20261116190000_favoritos_listas.sql` lo copia a `client_favorites`.
- Guardar un **trabajo** de la galería del perfil ya informa al autor (`data-artist-id`
  en el botón → `favorite_items.artist_user_id`), así que entra en `items_saved_count`.
  En Most Wanted todavía **no** suma.
- Pendiente (decisión de producto antes de escribir el puente): si los trabajos guardados
  pesan en Most Wanted, la función tiene que contar **personas distintas** por artista
  (`kind in ('design', 'merch')`, `owner_user_id <> artist_user_id`, `created_at >= p_since`),
  no ítems: una sola cuenta que guarda veinte trabajos no puede valer veinte favoritos. Y
  no debe incluir `kind = 'artist'`, que ya llega por `client_favorites`.

### Recalcular

- `pg_cron`: job `recalculate-most-wanted`, todos los días 03:40 UTC.
- `POST /api/perfil/most-wanted/recalculate` con `X-Cron-Token: $CRON_API_TOKEN`
  → `{ success, scored, zones, winners, notified }`.
- El servidor también corre el ciclo solo cada `MOST_WANTED_INTERVAL_HOURS` (12 por defecto,
  `0` lo apaga) y le avisa por correo (`artist_most_wanted_awarded`) a quien gana la insignia,
  una vez por racha. `MOST_WANTED_EMAILS=off` apaga el aviso.

## Compartidos

`POST /api/artist/profile-share` `{ artist_username | artist_id, channel }` (anónimo, con
límite de frecuencia). Canales: `copy, native, whatsapp, instagram, story, facebook, x, qr,
other`. Cuenta una vez por persona (huella de IP con sal, nunca la IP), canal y hora.
Lo llaman la hoja "Compartir" del perfil y el panel "Compartir mi perfil" del dashboard.

`artist_profile_shares` tiene RLS encendido y ninguna policy: solo la lee y la escribe el
servidor (`service_role`). Cada fila guarda quién compartió (`sharer_user_id`) y la huella de
su IP, así que ni el artista ni soporte la consultan desde el navegador. Si el panel llega a
mostrar "veces compartido", que salga de un conteo agregado por RPC.

## Tarjeta Open Graph e historia

`public/shared/js/wo-share-cards.js` compone con `<canvas>`:

- la **historia** 1080×1920 (Instagram): se comparte como archivo en el teléfono
  (`navigator.canShare({ files })`) o se descarga en escritorio, con el enlace copiado;
- la **tarjeta Open Graph** 1200×630: el artista (con su sesión) la sube a
  `profile-pictures/<user_id>/og-card-<ms>.jpg` y la ruta queda en `public.artist_share_cards`.
  `lib/routes/perfil.js` la usa como `og:image` / `twitter:image` con `og:image:width/height`;
  sin tarjeta válida usa la foto de perfil, como antes.

La tarjeta se regenera sola cuando cambia algo de lo que muestra (nombre, estilos, ciudad,
foto, enlace): al guardar "Mi perfil" en el centro de la cuenta, al abrir el dashboard, al ver
el propio perfil y al compartir. La ciudad no se dibuja si el artista la tiene oculta.
