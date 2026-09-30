# Marketplace y cotizaciones — 21/09/2026

Publicado en https://beta.weotzi.com/marketplace/ y https://beta.weotzi.com/quotation/.

## Datos y corrección

El frontend comprobaba la existencia de ConfigManager antes de que terminara su inicialización asíncrona. Esto activaba una lista de respaldo con dos artistas aunque Supabase estuviera disponible. Marketplace y cotizador ahora esperan `ConfigManager.ready()` y muestran un error recuperable si falla la conexión, sin sustituir los registros por ejemplos.

La consulta de `artists_db` devuelve 84 perfiles públicos de los 130 existentes. Los 46 con registro `incompleto` mantienen su visibilidad restringida. La base contiene también perfiles históricos de QA/demo: no se borraron ni se modificaron sus estados. Los enlaces de artista inexistente muestran un error explícito.

## Guardado de solicitudes

El envío anónimo directo fallaba al pasar de borrador a pendiente por las políticas de lectura de `quotations_db`. Se incorporó `POST /api/quotations/intake`, con campos permitidos explícitos, datos del tatuador consultados en servidor y vínculo de cliente únicamente cuando una sesión verificada coincide con su correo.

Una clave aleatoria del navegador identifica cada solicitud; el identificador público es un hash de esa clave. La clave no se almacena en la fila pública. El servidor usa la función `save_web_quotation`, accesible solamente a `service_role`, para guardar cotización y extras en una transacción. Los reintentos conservan el identificador y un autoguardado tardío no puede devolver una solicitud enviada a borrador. No se ampliaron las políticas públicas de lectura.

Migración aplicada: `supabase/migrations/20260921231500_web_quotation_intake.sql`.

## Validación

- 359 pruebas aprobadas con `node --test tests/*.test.js`; sintaxis de servidor y cotizador verificada.
- Prueba SQL con rollback: borrador, envío, reintento, protección frente a autoguardado tardío y atomicidad ante extras inválidos. Ejecución de RPC denegada para `anon` y `authenticated`.
- Navegador local: recorrido completo de ocho pasos con `tomtattoo.wo`, recuperación de borrador y pantalla «Solicitud enviada»; fila pendiente vinculada al artista y extras comprobados en Supabase.
- En ese recorrido el transporte de correo se capturó localmente para evitar enviar solicitudes ficticias al tatuador. No constituye una nueva prueba de entrega SMTP; ver `EMAIL-DELIVERY-20260921.md` para la validación anterior.
- API pública publicada: entrada inválida devuelve 400; borrador y envío devuelven 200; reintento mantiene el ID y autoguardado posterior mantiene `pending`. Esta prueba no disparó correos.
- Marketplace público: 84 resultados; búsqueda «Tomás» + Enter devuelve el perfil de Tomás G. Delatour.
- Eliminadas las tres cotizaciones temporales y sus extras; consulta final confirmó cero filas de prueba restantes.

## Publicación y recuperación

Release `weotzi-deploy-20260921-201140.tar.gz`: 417 archivos comprobados por SHA-256, cero diferencias; proceso PM2 `weotzi-beta` online. No hubo cambios de dependencias ni de credenciales.

Respaldo remoto: `/home/u795331143/domains/weotzi.com/public_html/beta/.deploy_backups/predeploy-20260921-201140.tar.gz`. La publicación conserva WordPress en el dominio principal. Para recuperar el runtime, restaurar ese respaldo siguiendo `DEPLOY-20260921.md`; la función nueva puede permanecer sin uso y no modifica políticas anteriores.

Verificación final en navegador público: la búsqueda abrió el perfil de Tomás G. Delatour; «Solicitar cotización» resolvió a /quotation/?artist=tomtattoo.wo y mostró «Confirmá tu artista» con sus estilos, estudio y precio de sesión de Supabase.
