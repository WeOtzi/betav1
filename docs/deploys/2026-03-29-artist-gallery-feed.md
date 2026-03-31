# Deploy: Feed de galeria por categorías en perfil de artista

**Fecha:** 2026-03-29

---

## Qué se cambió

Se agregó persistencia para una galería tipo feed con categorías en `artists_db`, manteniendo compatibilidad con `gallery_images`.

## Estructura propuesta

La nueva columna normalizada es `gallery_feed_items` con objetos JSONB de esta forma:

```json
[
  {
    "url": "https://...",
    "category": "realizados",
    "kind": "image",
    "created_at": "2026-03-29T00:00:00.000Z"
  }
]
```

### Valores permitidos

- `category`: `realizados`, `flash`, `proyectos`
- `kind`: `image`, `video`

## Compatibilidad

- `gallery_images` se conserva como espejo legacy para el frontend actual.
- La migración agrega un trigger para sincronizar ambos formatos.
- Los registros existentes se backfillean desde `gallery_images` hacia `gallery_feed_items`.
- El frontend no necesita cambios inmediatos para seguir funcionando.

## Archivos agregados

- `supabase/migrations/20260329000000_artist_gallery_feed_items.sql`

