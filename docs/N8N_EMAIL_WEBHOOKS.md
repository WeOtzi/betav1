# n8n Email Webhooks - Guia de Integracion

Esta guia describe como We Otzi envia eventos a n8n para notificaciones por email.

## Resumen

We Otzi utiliza webhooks de n8n para enviar notificaciones por email en diferentes escenarios. Cada evento tiene su propia URL de webhook configurable y puede activarse/desactivarse individualmente desde el backoffice.

**Remitente de emails**: `isai@weotzi.com` (configurado en n8n)

## Eventos Disponibles

| ID del Evento | Nombre | Descripcion |
|---------------|--------|-------------|
| `artist_registration_completed` | Registro de Artista Completado | Se dispara cuando un artista completa su perfil |
| `client_registration_completed` | Registro de Cliente Completado | Se dispara cuando un cliente crea su cuenta |
| `password_reset_temp` | Restablecimiento de Contrasena | Se dispara cuando un usuario solicita recuperar su contrasena |
| `client_quotation_submitted` | Cotizacion de Cliente Enviada | Se dispara cuando un cliente envia una cotizacion |

## Configuracion en el Backoffice

1. Accede al backoffice: `/backoffice`
2. En la seccion **Super Admin**, selecciona **Eventos/Webhooks**
3. Para cada evento:
   - Ingresa la URL del webhook de n8n
   - Activa el toggle para habilitarlo
   - Usa el boton de prueba para verificar la conexion

## Estructura de Payloads

### Estructura Base

Todos los webhooks envian un payload con esta estructura base:

```json
{
    "event_id": "nombre_del_evento",
    "event_name": "Nombre Legible del Evento",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        // Datos especificos del evento
    }
}
```

### 1. artist_registration_completed

Se dispara cuando un artista completa el registro de su perfil.

```json
{
    "event_id": "artist_registration_completed",
    "event_name": "Registro de Artista Completado",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "artista@email.com",
        "username": "nombreartistico.wo",
        "password": "OtziArtist2025",
        "name": "Nombre Completo",
        "artistic_name": "Nombre Artistico",
        "city": "Ciudad",
        "country": "Pais",
        "styles": ["Realismo", "Black & Grey"],
        "studio": "Nombre del Estudio",
        "session_price": "500 USD",
        "years_experience": 5,
        "bio": "Biografia del artista...",
        "portfolio_url": "https://portfolio.com",
        "dashboard_url": "https://weotzi.chat/artist/dashboard",
        "profile_url": "https://weotzi.chat/artist/profile/nombreartistico.wo"
    }
}
```

### 2. client_registration_completed

Se dispara cuando un cliente crea su cuenta.

```json
{
    "event_id": "client_registration_completed",
    "event_name": "Registro de Cliente Completado",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "cliente@email.com",
        "password": "contrasenaDelCliente",
        "full_name": "Nombre del Cliente",
        "whatsapp": "+5491123456789",
        "birth_date": "1990-01-15",
        "age": 34,
        "instagram": "@cliente",
        "city": "Buenos Aires",
        "quote_id": "QN12345",
        "dashboard_url": "https://weotzi.chat/client/dashboard",
        "login_url": "https://weotzi.chat/client/login"
    }
}
```

### 3. password_reset_temp

Se dispara cuando un usuario (artista o cliente) solicita restablecer su contrasena.

```json
{
    "event_id": "password_reset_temp",
    "event_name": "Restablecimiento de Contrasena",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "email": "usuario@email.com",
        "temp_password": "Ab3dEf7hJk",
        "user_type": "artist",
        "login_url": "https://weotzi.chat/registerclosedbeta"
    }
}
```

**Nota**: `user_type` puede ser `"artist"` o `"client"`. El `login_url` varia segun el tipo de usuario.

### 4. client_quotation_submitted

Se dispara cuando un cliente completa y envia una cotizacion.

```json
{
    "event_id": "client_quotation_submitted",
    "event_name": "Cotizacion de Cliente Enviada",
    "timestamp": "2026-02-03T12:00:00.000Z",
    "source": "weotzi-app",
    "data": {
        "client_name": "Nombre del Cliente",
        "client_email": "cliente@email.com",
        "client_whatsapp": "+5491123456789",
        "client_age": 28,
        "quote_id": "QN12345",
        "artist_name": "Nombre del Artista",
        "artist_email": "artista@email.com",
        "tattoo_description": "Descripcion de la idea del tatuaje...",
        "tattoo_location": "Brazo derecho - Antebrazo",
        "tattoo_size": "Mediano (10-15 cm)",
        "tattoo_style": "Realismo",
        "tattoo_references": "https://drive.google.com/...",
        "client_budget": "500 USD",
        "client_preferred_date": "2026-03-15",
        "has_medical_conditions": false,
        "medical_details": null,
        "register_url": "https://weotzi.chat/client/register",
        "login_url": "https://weotzi.chat/client/login"
    }
}
```

## Configuracion del Servidor

Para que el flujo de restablecimiento de contrasena funcione, el servidor necesita la variable de entorno:

```env
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui
```

Esta clave se obtiene del dashboard de Supabase en **Settings > API > service_role key**.

**Importante**: Esta clave tiene permisos de administrador. Nunca la expongas en el frontend.

## Creando Workflows en n8n

### Ejemplo basico de workflow

1. **Trigger**: Webhook node (recibe el POST)
2. **Proceso**: Set node (prepara variables para el email)
3. **Envio**: Email node o SMTP node

### Tips para n8n

- Usa el `event_id` para filtrar eventos si usas una sola URL para multiples eventos
- Los datos estan en `$json.data.*`
- El timestamp esta en formato ISO 8601
- Para testing, usa el boton "Probar Webhook" en el backoffice

## Solucion de Problemas

### El webhook no se envia

1. Verifica que el evento este **activado** en el backoffice
2. Verifica que la URL del webhook sea correcta
3. Revisa la consola del navegador para errores
4. Usa el boton "Probar Webhook" para validar la conexion

### Error al restablecer contrasena

1. Verifica que `SUPABASE_SERVICE_ROLE_KEY` este configurada en el servidor
2. Verifica que el email exista en la base de datos
3. Revisa los logs del servidor para mas detalles

### El email no llega

1. Verifica la configuracion SMTP en n8n
2. Revisa que el workflow en n8n este activo
3. Verifica que el email del destinatario sea correcto

## Referencias

- [Documentacion de n8n](https://docs.n8n.io/)
- [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
- [EASYPANEL_DEPLOYMENT.md](./EASYPANEL_DEPLOYMENT.md) - Configuracion de variables de entorno
