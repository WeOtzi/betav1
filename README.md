# We Ötzi - Unified Web Application

Aplicación web unificada para la gestión de estudios de tatuaje, combinando registro de artistas, marketplace, cotizaciones y herramientas de IA.

## 📚 Documentación

*   [**CHANGELOG.md**](docs/CHANGELOG.md): Historial de cambios y nuevas características (v1.0.0).
*   [**TECHNICAL.md**](docs/TECHNICAL.md): Arquitectura, API y detalles técnicos.
*   [**DEPLOYMENT.md**](docs/DEPLOYMENT.md): Guía paso a paso para desplegar en nuevos servidores.
*   [**GOOGLE_OAUTH_SETUP.md**](docs/GOOGLE_OAUTH_SETUP.md): Configuración de Google OAuth y Drive API.

## 🚀 Inicio Rápido

### Requisitos
*   Node.js 18+
*   npm

### Instalación

```bash
npm install
```

### Ejecución Local

```bash
npm start
```
El servidor estará disponible en `http://localhost:3000`.

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
