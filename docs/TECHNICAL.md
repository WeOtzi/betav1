# Documentación Técnica - We Ötzi Unified

## 1. Arquitectura del Sistema

We Ötzi Unified es una aplicación web moderna construida sobre una arquitectura cliente-servidor, diseñada para ser escalable y fácil de mantener.

### Componentes Principales

*   **Backend**: Node.js con Express.js. Actúa como servidor web, proxy de APIs y orquestador de lógica de negocio.
*   **Frontend**: HTML5, CSS3 y JavaScript (Vanilla) servidos como archivos estáticos. La estructura imita una SPA (Single Page Application) mediante rutas limpias manejadas por el backend.
*   **Base de Datos & Auth**: Supabase (PostgreSQL). Se utiliza para persistencia de datos y gestión de usuarios.
*   **Almacenamiento de Archivos**:
    *   **Supabase Storage**: Para activos inmediatos.
    *   **Google Drive**: Para organización de carpetas de cotizaciones y archivos de referencia a largo plazo.
*   **IA Generativa**: Google Gemini API (modelo `gemini-3-pro-image-preview`) para generación de imágenes.

## 2. Estructura de Directorios

```
weotzi-unified/
├── public/                 # Archivos estáticos del Frontend
│   ├── artist/             # Módulos de artista (dashboard, perfil)
│   ├── client/             # Módulos de cliente (login, dashboard)
│   ├── support/            # Módulos de soporte
│   ├── marketplace/        # Marketplace de artistas
│   ├── quotation/          # Formulario de cotización
│   ├── register-artist/    # Wizard de registro
│   ├── shared/             # Recursos compartidos (CSS, JS, Assets)
│   └── ...
├── server.js               # Punto de entrada del servidor Express
├── setup.js                # Bootstrapper del instalador/backup
├── installer/              # Servidor independiente para instalación/restauración
├── docs/                   # Documentación del proyecto
├── logs/                   # Logs del sistema
└── package.json            # Dependencias y scripts
```

## 3. API Reference (Backend)

El archivo `server.js` expone los siguientes endpoints API:

### IA & Generación
*   `POST /api/gemini/generate-image`: Genera imágenes de tatuajes usando Gemini.
    *   Body: `{ prompt, apiKey, model, aspectRatio, imageSize }`

### Google Drive Integration
*   `POST /api/google-drive/test`: Verifica conexión y permisos de carpeta.
*   `POST /api/google-drive/create-quote-folder`: Crea carpeta para cotización y sube archivos.
    *   Lógica: Busca carpeta existente -> Si no, crea nueva -> Descarga archivos de URL -> Sube a Drive.

### Administración & Sistema
*   `POST /api/admin/update-user-password`: Actualiza contraseñas de usuarios (Supabase Admin).
*   `POST /api/admin/generate-backup`: Genera un ZIP completo del sistema (Código + DB + Config).
*   `GET /api/admin/backup-tables`: Lista tablas disponibles para backup.
*   `GET /api/client-info`: Retorna IP y timestamp del cliente.
*   `POST /api/session-log`: Endpoint para `sendBeacon` (logs de sesión al cerrar pestaña).

## 4. Flujos de Datos Críticos

### Creación de Cotización
1.  Cliente llena formulario en `/quotation`.
2.  Frontend guarda datos en Supabase.
3.  Frontend llama a `/api/google-drive/create-quote-folder` en el backend.
4.  Backend autentica con Service Account de Google.
5.  Backend crea estructura de carpetas en Drive y transfiere imágenes.

### Backup y Restauración
1.  Admin solicita backup desde `/backoffice` o `/installer`.
2.  Backend (`installer/server.js` o endpoint de backup) recopila:
    *   Dumps de base de datos (JSON).
    *   Archivos `public/`.
    *   Configuraciones.
3.  Genera archivo ZIP descargable.
4.  Para restaurar, se usa `node setup.js` que levanta un servidor temporal para cargar el ZIP.

## 5. Seguridad

*   **Credenciales**: Las claves de API (Google, Supabase) se manejan via variables de entorno o se pasan de forma segura desde el cliente autenticado (dependiendo del endpoint).
*   **CORS**: Configurado implícitamente al servir frontend desde el mismo origen.
*   **Body Parser limit**: 50MB para permitir subida de imágenes en base64 si es necesario (aunque se prefiere URL).
