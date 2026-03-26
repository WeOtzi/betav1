# We Ötzi - Unified Web Application

Aplicacion web unificada para la gestion de estudios de tatuaje, combinando registro de artistas, marketplace, cotizaciones y herramientas de IA.

## Documentacion

*   [**CHANGELOG.md**](docs/CHANGELOG.md): Historial de cambios y nuevas caracteristicas (v1.0.0).
*   [**TECHNICAL.md**](docs/TECHNICAL.md): Arquitectura, API y detalles tecnicos.
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
*Desarrollado por el equipo de We Ötzi. v1.0.0*

---
**Última sincronización:** 2026-02-03
