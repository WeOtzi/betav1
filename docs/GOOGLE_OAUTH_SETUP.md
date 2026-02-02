# Configuracion de Google OAuth para We Otzi

Esta guia explica como configurar Google OAuth para el inicio de sesion de clientes.

## Paso 1: Crear credenciales en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona o crea un proyecto
3. Ve a **APIs & Services > Credentials**
4. Click en **Create Credentials > OAuth client ID**
5. Selecciona **Web application**
6. Configura:
   - **Name**: `We Otzi Client Auth`
   - **Authorized JavaScript origins**: 
     - `http://localhost:3000` (desarrollo)
     - `https://tu-dominio.com` (produccion)
   - **Authorized redirect URIs**:
     - `https://flbgmlvfiejfttlawnfu.supabase.co/auth/v1/callback`
7. Guarda el **Client ID** y **Client Secret**

## Paso 2: Configurar pantalla de consentimiento OAuth

1. En Google Cloud Console, ve a **APIs & Services > OAuth consent screen**
2. Selecciona **External** si tu app es publica
3. Completa la informacion requerida:
   - **App name**: `We Otzi`
   - **User support email**: tu email
   - **App logo**: (opcional)
   - **App domain**: tu dominio
   - **Developer contact**: tu email
4. En **Scopes**, agrega:
   - `email`
   - `profile`
   - `openid`
5. Guarda los cambios

## Paso 3: Configurar Supabase

1. Ve al [Dashboard de Supabase](https://supabase.com/dashboard)
2. Selecciona tu proyecto `flbgmlvfiejfttlawnfu`
3. Ve a **Authentication > Providers**
4. Busca **Google** y habilitalo
5. Ingresa:
   - **Client ID**: el que obtuviste en el Paso 1
   - **Client Secret**: el que obtuviste en el Paso 1
6. Guarda los cambios

## Paso 4: Verificar la configuracion

1. Inicia el servidor: `npm start`
2. Ve a `http://localhost:3000/client/login`
3. Click en "Continuar con Google"
4. Deberias ver la pantalla de consentimiento de Google
5. Tras autenticarte, seras redirigido al dashboard de cliente

## URLs importantes

- **Supabase Callback URL**: `https://flbgmlvfiejfttlawnfu.supabase.co/auth/v1/callback`
- **Client Login**: `/client/login`
- **Client Register**: `/client/register`
- **Client Dashboard**: `/client/dashboard`

## Notas

- En desarrollo, asegurate de tener `http://localhost:3000` en los origenes autorizados
- Para produccion, agrega el dominio real de la aplicacion
- El Client Secret debe mantenerse seguro y nunca exponerse en el frontend

## Troubleshooting

### Error: redirect_uri_mismatch
- Verifica que la URI de redireccion en Google Cloud coincida exactamente con la URL de callback de Supabase

### Error: access_denied
- Verifica que el usuario tenga permisos para usar la app
- En modo de prueba, agrega usuarios de prueba en la pantalla de consentimiento

### El usuario no se crea en clients_db
- Esto es manejado automaticamente por el codigo en `client-auth.js`
- Verifica que las policies RLS permitan la insercion
