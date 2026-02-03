# Guía de Despliegue - We Ötzi Unified

Esta guía detalla los pasos para desplegar la aplicación en un nuevo servidor (VPS, EC2, DigitalOcean, etc.).

## Requisitos Previos

*   **Sistema Operativo**: Linux (Ubuntu 20.04+ recomendado), macOS o Windows.
*   **Runtime**: Node.js v18 o superior.
*   **Gestor de Paquetes**: npm (incluido con Node.js).
*   **Puerto**: 3000 (abierto en el firewall).

## 1. Preparación del Servidor

1.  Instalar Node.js y npm:
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```

2.  Instalar PM2 (Process Manager) para mantener la app activa:
    ```bash
    sudo npm install -g pm2
    ```

## 2. Instalación de la Aplicación

1.  Clonar el repositorio o subir los archivos al servidor.
    *   Si usas el sistema de backup: Sube el archivo `setup.js`, `package.json` y la carpeta `installer/` (o simplemente todo el proyecto).

2.  Instalar dependencias:
    ```bash
    cd weotzi-unified
    npm install
    ```

## 3. Configuración

1.  **Variables de Entorno**:
    Crea un archivo `.env` en la raíz si es necesario, o configura las variables en tu proveedor de hosting.
    *   `PORT`: Puerto del servidor (Defecto: 3000).
    *   `SUPABASE_URL`: URL del proyecto Supabase.
    *   `SUPABASE_ANON_KEY`: Clave anonima de Supabase.
    *   `SUPABASE_SERVICE_ROLE_KEY`: Clave de servicio para Admin API (requerida para flujo de reset de contrasena).

    Para configuracion de n8n webhooks, ver [N8N_EMAIL_WEBHOOKS.md](./N8N_EMAIL_WEBHOOKS.md).

2.  **Credenciales de Google**:
    Asegúrate de tener el archivo JSON de la cuenta de servicio de Google (Service Account) disponible si el despliegue lo requiere como archivo, o ten a mano las credenciales para ingresarlas en el panel de administración.

## 4. Ejecución

### Modo Producción (con PM2)

```bash
# Iniciar la aplicación
pm2 start server.js --name "weotzi-app"

# Configurar reinicio automático al arrancar el sistema
pm2 startup
pm2 save
```

### Modo Manual

```bash
npm start
```

## 5. Verificación

Accede a `http://tu-ip-o-dominio:3000`. Deberías ver la landing page.

*   Verifica los logs para asegurar que no hay errores de arranque:
    ```bash
    pm2 logs weotzi-app
    ```

## 6. Uso del Instalador / Restauración de Backup

Si estás migrando a un servidor nuevo desde un backup (archivo .zip generado por el sistema):

1.  En el servidor nuevo, asegúrate de tener `setup.js` y `installer/`.
2.  Ejecuta el instalador:
    ```bash
    node setup.js
    ```
3.  Esto abrirá un servidor en el puerto `3001`.
4.  Accede a `http://tu-ip-o-dominio:3001`.
5.  Sigue el asistente web para subir tu archivo `.zip` de backup. El sistema restaurará automáticamente la base de datos y los archivos.

## Solución de Problemas Comunes

*   **Error EADDRINUSE**: El puerto 3000 está ocupado.
    *   Solución: Cambia el puerto: `PORT=3005 npm start`.
*   **Google Drive Error 403/404**:
    *   Verifica que el email de la Service Account tenga permisos de "Editor" en la carpeta de Google Drive destino.
*   **Errores de Memoria**:
    *   Si el servidor se reinicia al subir archivos grandes, aumenta la memoria asignada a Node: `NODE_OPTIONS="--max-old-space-size=4096" pm2 restart weotzi-app`.
