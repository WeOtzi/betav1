# CLAUDE.md — We Ötzi Unified

Plataforma web para el mundo del tatuaje: clientes piden cotizaciones, artistas gestionan su perfil/galería/agenda, estudios administran sedes y roster, y un backoffice/soporte opera todo.

## Arquitectura

- **Backend**: monolito Express en [server.js](server.js) (puerto `4545`). Sirve `public/` como estático con rutas limpias (`/explore` → `public/explore/index.html`) y expone APIs bajo `/api/*`. Lógica pura extraída en `lib/`, servicios (email, etc.) en `services/`.
- **Frontend**: HTML/CSS/JS vanilla, **sin framework ni build step**. Cada módulo vive en `public/<ruta>/index.html`; los scripts y estilos compartidos en `public/shared/js/` y `public/shared/css/`.
- **Datos y auth**: Supabase (Postgres + Auth + Storage). Migraciones SQL en `supabase/migrations/`. El proyecto Supabase vivo es `flbgmlvfiejfttlawnfu` (nombre "Chatbot") — NO el proyecto pausado "WeOtzi's App".
- **Integraciones**: Google Drive (carpetas de cotización), Gemini (generación de imágenes), Google Maps, n8n (emails — plantillas en `templates/email/`), Apify (import de Instagram).

## Comandos

```bash
npm start              # servidor en http://localhost:4545
npm run dev            # con nodemon
node --test "tests/*.test.js"   # suite de tests (node:test nativo)
npm run test:prequote  # test del estimador de pre-cotización
```

## Documentación clave

- [docs/MAPA_APLICACION.md](docs/MAPA_APLICACION.md) — mapa completo: rutas, módulos por tipo de usuario, esquema Supabase. **Empezar aquí.**
- [docs/TECHNICAL.md](docs/TECHNICAL.md) — endpoints API y flujos críticos.
- [docs/MISSION.md](docs/MISSION.md) — misión y pilares de producto.
- [deployments/DEPLOY.md](deployments/DEPLOY.md) — deploy a producción `beta.weotzi.com` (SSH + PM2, vía `scripts/deploy.py`; credenciales en `.server-credentials`, nunca en el repo).
- `docs/plans/` — solo planes activos o pausados (lo demás se elimina al completarse).

## Flujo de trabajo con git

- Remoto: `origin` → `github.com/WeOtzi/betav1`. **Push a `origin main` al cerrar cada sesión de trabajo** — el repo local no es respaldo.
- Features no triviales en rama `feature/<nombre>` desde `main`; merge a `main` cuando los tests pasen. Cambios chicos pueden ir directo a `main`.
- Commits agrupados por área con prefijo convencional (`feat(studios):`, `fix(explore):`, `chore:`); no acumular semanas de trabajo sin commitear.
- Antes de commitear: `node --test "tests/*.test.js"` en verde.

## Convenciones

- Vanilla JS con módulos por página; reutilizar los helpers compartidos (`config-manager.js`, `*-auth.js`, `shared-drawer.js`, `weotzi-uploader.js`) antes de crear nuevos.
- **Acceso a datos: SIEMPRE vía la capa PostgREST unificada** — `lib/postgrest.js` + repos en `lib/repos/` (servidor) y `window.WeotziData` (frontend). Prohibido el CRUD ad-hoc nuevo (`fetch('/rest/v1/...')` inline o `_supabase.from(...)` disperso). Guía: [docs/GUIA_CAPA_DATOS.md](docs/GUIA_CAPA_DATOS.md).
- Idioma del producto y la documentación: español.
- Cambios de esquema siempre como migración nueva en `supabase/migrations/` (timestamp como prefijo); nunca editar migraciones ya aplicadas.
- Secretos solo en `.env` / `.server-credentials` (ambos gitignored).
