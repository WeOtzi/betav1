# We Ötzi - Unified Web Application

Aplicacion web unificada para la gestion de estudios de tatuaje, combinando registro de artistas, marketplace, cotizaciones y herramientas de IA.

## Mision y Vision

We Ötzi existe para rediseñar el futuro del arte visual y del tatuaje, posicionandose como la plataforma lider a nivel global donde los artistas viven de su oficio sin barreras. Lee la declaracion completa en [**MISSION.md**](docs/MISSION.md).

## Documentacion

*   [**MISSION.md**](docs/MISSION.md): Mision, vision, pilares estrategicos y como aplicarlos al producto.
*   [**MAPA_APLICACION.md**](docs/MAPA_APLICACION.md): Mapa completo local de rutas, funciones por usuario, servicios, arquitectura y componentes Supabase.
*   [**CHANGELOG.md**](docs/CHANGELOG.md): Historial de cambios y nuevas caracteristicas (v2.0.1).
*   [**TECHNICAL.md**](docs/TECHNICAL.md): Arquitectura, API y detalles tecnicos.
*   [**ARTIST_SIGNUP_FLOW.md**](docs/ARTIST_SIGNUP_FLOW.md): Flujo de registro de artista (auth + artists_db) y runbook local de validacion.
*   [**DEPLOYMENT.md**](docs/DEPLOYMENT.md): Guia paso a paso para desplegar en nuevos servidores.
*   [**EASYPANEL_DEPLOYMENT.md**](docs/EASYPANEL_DEPLOYMENT.md): Guia de despliegue en Easypanel (VPS con Docker).
*   [**GOOGLE_OAUTH_SETUP.md**](docs/GOOGLE_OAUTH_SETUP.md): Configuracion de Google OAuth y Drive API.
*   [**N8N_EMAIL_WEBHOOKS.md**](docs/N8N_EMAIL_WEBHOOKS.md): Integracion con n8n para envio de emails (registro, reset password, cotizaciones).

## Inicio Rapido

### Requisitos
*   Node.js 20+
*   npm

### Instalacion Local

```bash
npm install
npm start
```
El servidor estara disponible en `http://localhost:4545`.

### Despliegue con Docker (Easypanel)

```bash
# Build de la imagen
docker build -t weotzi-app .

# Ejecutar contenedor
docker run -p 4545:4545 -e NODE_ENV=production weotzi-app
```

Ver [EASYPANEL_DEPLOYMENT.md](docs/EASYPANEL_DEPLOYMENT.md) para instrucciones completas de despliegue en Easypanel.

## 🌟 Características Principales

*   **Gestión de Artistas**: Registro, perfiles públicos y dashboards.
*   **Cotizaciones Inteligentes**: Flujo completo desde solicitud del cliente hasta carpeta en Drive.
*   **IA Integrada**: Generación de referencias de tatuajes con Gemini 3 Pro.
*   **Backup & Restore**: Sistema propio de copias de seguridad completas.

## 📂 Estructura del Proyecto

```
weotzi-unified/
├── public/                 # Frontend estático
├── server.js               # Servidor Backend Express
├── installer/              # Sistema de instalación/backup
├── docs/                   # Documentación
└── setup.js                # Script de inicio del instalador
```

## 🔧 Backend & Servicios

La aplicación se conecta a:
*   **Supabase**: Base de datos PostgreSQL y Auth.
*   **Google Cloud**: Drive API (almacenamiento) y Gemini API (IA).

---
*Desarrollado por el equipo de We Ötzi. v2.0.1*

---
**Última sincronización:** 2026-05-27

### Convenciones frontend (2026-05-13)

*   **Cliente Supabase compartido**: los scripts en `public/shared/js/` reusan una unica instancia via `window._supabase = window._supabase || supabase.createClient(...)`. Al agregar un nuevo script que use Supabase, sigue el mismo patron (ver `public/shared/js/main.js:5` como referencia). Test clients efimeros (admin.js `testClient`) son la unica excepcion deliberada.
*   **Microsoft Clarity opt-in por entorno**: el snippet en los HTML solo carga el tag cuando `window.CLARITY_PROJECT_ID` esta definido con un ID real. Para activar en produccion, define `window.CLARITY_PROJECT_ID = 'xxx'` antes del bloque de Clarity (idealmente inyectado por el servidor segun entorno).
*   **Flujo de registro pre-auth**: los datos del wizard de `/register-artist` y del email-form de `/registerclosedbeta` se guardan en `artists_db` con `registration_status='incompleto'` via `POST /api/register/artist-draft` (sin crear `auth.users`). El usuario Auth se crea solo al confirmar el resumen final via `POST /api/register/artist-finalize`, que setea `user_id` y cambia el estado a `pendiente de validacion`. Ver [ARTIST_SIGNUP_FLOW.md](docs/ARTIST_SIGNUP_FLOW.md) para el detalle.
