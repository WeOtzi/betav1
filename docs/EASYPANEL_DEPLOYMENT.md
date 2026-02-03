# We Otzi - Guia de Despliegue en Easypanel

Esta guia detalla como desplegar la aplicacion We Otzi en tu VPS usando Easypanel.

## Informacion del Servidor

- **IP**: 69.62.98.207
- **Panel**: https://jubcpl.easypanel.host (o http://69.62.98.207:3000)
- **Dominio configurado**: weotzi.chat

## Paso 1: Acceder a Easypanel

1. Abre tu navegador y ve a la URL del panel de Easypanel
2. Inicia sesion con tu cuenta: `isainazar@icloud.com`

## Paso 2: Crear un Nuevo Proyecto

1. En el dashboard de Easypanel, haz clic en **"Create Project"** o **"Crear Proyecto"**
2. Nombra el proyecto: `weotzi-app`
3. Haz clic en **"Create"**

## Paso 3: Crear el Servicio de la Aplicacion

1. Dentro del proyecto `weotzi-app`, haz clic en **"+ Service"** o **"+ Servicio"**
2. Selecciona **"App"** (Servicio de Aplicacion)
3. Configura el servicio:

### Opcion A: Desde GitHub (Recomendado)

Si tienes el codigo en un repositorio GitHub:

1. Selecciona **"GitHub"** como fuente
2. Conecta tu cuenta de GitHub si no lo has hecho
3. Selecciona el repositorio `weotzi-unified`
4. Rama: `main`
5. Easypanel detectara automaticamente el `Dockerfile`

### Opcion B: Subir Archivos Manualmente

1. Selecciona **"Docker"** como fuente
2. Sube los archivos del proyecto (o usa git clone en el servidor)

## Paso 4: Configurar Variables de Entorno

En la seccion **"Environment"** o **"Variables de Entorno"**, agrega las siguientes:

```env
# Puerto y entorno
PORT=4545
NODE_ENV=production

# Supabase (tu configuracion actual)
SUPABASE_URL=https://flbgmlvfiejfttlawnfu.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888
SUPABASE_STORAGE_BUCKET=quotation-references
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui

# Google Maps
GOOGLE_MAPS_API_KEY=AIzaSyAaop8XBfjEIMw8lSv4LakBXVZ9HL4ekLs

# n8n Webhook (tu instancia de n8n)
N8N_WEBHOOK_URL=https://chatbot-we-otzi-n8n.jubcpl.easypanel.host/webhook/8bc207a6-ee21-4150-9a92-211a68b19544
N8N_DRIVE_FOLDER_ID=1sBpYYrMPiyIwiXcKCcOnSPPZOJM4vq3W

# WhatsApp
WHATSAPP_NUMBER=+541162079567

# Contrasena predeterminada para artistas
PRESET_PASSWORD=OtziArtist2025

# Modo demo (false para produccion)
DEMO_MODE=false
```

**Nota**: `SUPABASE_SERVICE_ROLE_KEY` es necesaria para el flujo de restablecimiento de contrasena via n8n. Se obtiene en Supabase Dashboard > Settings > API > service_role key. Ver [N8N_EMAIL_WEBHOOKS.md](./N8N_EMAIL_WEBHOOKS.md) para mas detalles.

## Paso 5: Configurar Dominio y Proxy

1. Ve a la seccion **"Domains"** o **"Dominios"**
2. Agrega el dominio:
   - **Dominio**: `weotzi.chat`
   - **Puerto interno**: `4545`
   - **HTTPS**: Habilitado (Let's Encrypt)

3. Asegurate de que tu dominio `weotzi.chat` apunte a la IP del servidor:
   - Tipo: `A`
   - Host: `@`
   - Valor: `69.62.98.207`

## Paso 6: Configurar el Build

En la seccion **"Build"**:

1. **Builder**: Dockerfile
2. **Dockerfile path**: `Dockerfile` (raiz del proyecto)
3. **Context**: `.` (directorio actual)

## Paso 7: Desplegar

1. Haz clic en **"Deploy"** o **"Desplegar"**
2. Espera a que el build termine (puedes ver los logs en tiempo real)
3. Una vez completado, tu aplicacion estara disponible en `https://weotzi.chat`

## Verificacion

Despues del despliegue, verifica que todo funcione:

1. **Pagina principal**: https://weotzi.chat/quotation
2. **API de configuracion**: https://weotzi.chat/shared/js/app-config.json
3. **Informacion del cliente**: https://weotzi.chat/api/client-info

## Servicios Adicionales en Easypanel

Tu servidor ya tiene configurados:

- **n8n**: https://chatbot-we-otzi-n8n.jubcpl.easypanel.host
- **Evolution API**: https://chatbot-we-otzi-evolution-api.jubcpl.easypanel.host:8181

Estos servicios estan integrados con la aplicacion principal.

## Actualizaciones

Para actualizar la aplicacion:

### Si usas GitHub:
1. Haz push de los cambios al repositorio
2. En Easypanel, haz clic en **"Redeploy"** o activa **"Auto Deploy"**

### Manual:
1. Ve al servicio en Easypanel
2. Haz clic en **"Redeploy"**

## Logs y Monitoreo

- **Ver logs**: En Easypanel, selecciona el servicio y ve a la pestana "Logs"
- **Metricas**: Easypanel muestra uso de CPU, memoria y red en el dashboard

## Troubleshooting

### El contenedor no inicia
1. Revisa los logs de build en Easypanel
2. Verifica que todas las variables de entorno esten configuradas
3. Asegurate de que el puerto 4545 no este en uso por otro servicio

### Errores de conexion a Supabase
1. Verifica que `SUPABASE_URL` y `SUPABASE_ANON_KEY` sean correctos
2. Revisa los logs del contenedor para ver errores especificos

### Dominio no funciona
1. Verifica que el registro DNS apunte a 69.62.98.207
2. Espera la propagacion DNS (puede tomar hasta 48 horas)
3. En Easypanel, verifica que el certificado SSL se haya generado

## Estructura de Variables de Entorno

| Variable | Descripcion | Requerida |
|----------|-------------|-----------|
| `PORT` | Puerto del servidor | Si |
| `NODE_ENV` | Entorno (production/development) | Si |
| `SUPABASE_URL` | URL del proyecto Supabase | Si |
| `SUPABASE_ANON_KEY` | Clave anonima de Supabase | Si |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio para Admin API (requerida para reset de contrasena) | Si* |
| `GOOGLE_MAPS_API_KEY` | API Key de Google Maps | Si |
| `N8N_WEBHOOK_URL` | URL del webhook de n8n (legacy, para Google Drive) | No |
| `WHATSAPP_NUMBER` | Numero de WhatsApp de soporte | Si |
| `DEMO_MODE` | Activar modo demo | No |
| `EMAILJS_SERVICE_ID` | ID del servicio EmailJS | No |
| `EMAILJS_TEMPLATE_ID` | ID del template EmailJS | No |
| `EMAILJS_PUBLIC_KEY` | Clave publica de EmailJS | No |
| `GEMINI_API_KEY` | API Key de Google Gemini | No |
| `GOOGLE_DRIVE_FOLDER_ID` | ID de carpeta Google Drive | No |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT` | JSON de cuenta de servicio | No |

*`SUPABASE_SERVICE_ROLE_KEY` es requerida si se usa el flujo de restablecimiento de contrasena con n8n. Ver [N8N_EMAIL_WEBHOOKS.md](./N8N_EMAIL_WEBHOOKS.md) para configuracion de webhooks.
