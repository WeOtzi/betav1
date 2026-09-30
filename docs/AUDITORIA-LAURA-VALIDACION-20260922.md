# Preparación técnica y validación — Laura, 22/09/2026

La guía de uso está en [AUDITORIA-LAURA-20260922.md](AUDITORIA-LAURA-20260922.md) y se agregó a la [tarea de preparación de Notion](https://app.notion.com/p/3de19a70144c81c79b69d6da87443de1). Se conserva el criterio de cierre: Laura debe confirmar personalmente ambos accesos y la recepción de correo. No se completaron sus tareas de auditoría en su nombre.

## Cuenta y datos

- Eliminado el Auth anterior `336903ae-b65b-4ad0-8896-5b64f6eb278d` y sus perfiles/borradores de artista para liberar `lalal3647@gmail.com`, tal como se solicitó. Comprobación final: cero registros Auth y artista con ese correo.
- Respaldo previo cifrado con DPAPI en `tmp/laura-pre-reset-backup.dpapi`, excluido del release. Incluye perfiles, referencias y datos asociados. Se conservaron las dos cotizaciones históricas; se desligó la referencia `accepted_artist_id` que impedía eliminar la identidad anterior. El snapshot conserva ese vínculo.
- Cuenta de auditoría `aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b`: una identidad Auth, un perfil artista y un perfil cliente. Su correo es `lalal3647+auditoria@gmail.com` y el acceso se entrega mediante recuperación de contraseña a su propio Gmail. No se incluyeron contraseñas en Notion ni en el correo.
- Seed aplicado: `supabase/seeds/20260922_laura_audit.sql`. Tres imágenes ilustrativas, cinco cotizaciones, dos sesiones, tres eventos, dos mensajes, una publicación privada y un viaje. Los datos están marcados como auditoría; las cotizaciones iniciales muestran ambos lados en la misma cuenta. Para pruebas entre personas, usar la cuenta nueva y la cuenta cargada en sesiones separadas.

## Cambios funcionales

- `POST /api/account/mode`: autentica el bearer, activa cliente sin reemplazar perfiles existentes y dirige a dashboard o alta de artista según el perfil persistido. Ignora identidades que envíe el navegador.
- Selector compartido **Modo cliente / Modo tatuador** en encabezados de ambos espacios, conservado cuando el componente de navegación vuelve a renderizarse; ajuste de encabezado y tarjetas de cliente en móvil.
- El registro autenticado de artista permite el correo de su propia cuenta y marca el perfil finalizado. El login/entrada de cliente activa el perfil cliente para un artista, en lugar de expulsarlo al panel de artista.
- `AUDIT_REGISTRATION_OPEN=true` permite el alta temporal de clientes sin verificar la recepción del correo; la API sigue validando formato y contraseña. El registro de artista ya usaba creación confirmada del lado servidor. Ambos flujos se probaron con `example.invalid`.
- La cuenta de prueba queda marcada mediante `app_metadata.qa_unverified_email`, que el navegador no puede cambiar. Se protegen los reclamos de cotizaciones históricas por email en RLS, trigger y endpoints de cliente. El modo de prueba no es prueba de propiedad de un buzón.
- Consulta Auth exacta por email, limitada a `service_role`, para resolver duplicados sin depender de un listado administrativo incompleto.
- El trigger de alta respeta los borradores del wizard. Se corrigió el conflicto donde el trigger creaba un segundo perfil antes de que el servidor vinculara el borrador. Se tuvo en cuenta que Auth aplica `app_metadata` después del INSERT.

Migraciones aplicadas: `20260922010000_test_registration_claim_guard`, `20260922011000_registration_auth_lookup`, `20260922012000_registration_trigger_draft_and_test_guard`, `20260922012500_auth_insert_metadata_order`.

## Evidencias

- `node --test tests/*.test.js`: **364/364** aprobadas. Checks de sintaxis de servidor, configuración, selector y registro aprobados.
- Prueba HTTP contra **beta.weotzi.com**: altas de artista y cliente con buzones inexistentes, login inmediato, activación de ambos modos, misma identidad, rechazo anónimo, correo propio permitido en alta de artista, identidad inyectada ignorada. El trigger no reclamó una cotización histórica por email y el endpoint rechazó el intento con 403.
- Se eliminaron las cuentas y cotizaciones temporales de esa prueba. Consulta final: cero Auth temporales; se conserva únicamente la cuenta preparada para Laura.
- Navegador local con el mismo runtime: dashboard artista con galería/agenda/diseños; cambio a dashboard cliente con cotización pendiente, mensaje y publicación; retorno a artista. Comprobación móvil sin desborde horizontal después del ajuste. El transporte de correo local se capturó para no enviar mensajes de QA.
- Release final `weotzi-deploy-20260922-002211.tar.gz`: **419 archivos SHA-256 sin diferencias**. PM2 `weotzi-beta` online; entradas artista/cliente, inicio, recuperación y estudios responden 200.
- Backup: `/home/u795331143/domains/weotzi.com/public_html/beta/.deploy_backups/predeploy-20260922-002211.tar.gz`. El release anterior a todos estos cambios fue respaldado en `predeploy-20260922-001838.tar.gz`.

## Correo, Figma y cierre

Borrador Gmail creado para `lalal3647@gmail.com`, asunto **We Ötzi — accesos y guía para la auditoría del rediseño**, ID `r-584574200234322708`, mensaje `1a0c7239844d26ca`. No enviado. Incluye guía, enlaces, alias, recuperación, fechas y criterios de Notion.

Laura creará su propio archivo Figma y lo compartirá con Isaí, según la aclaración del usuario. No se modificaron permisos ni el original del rediseño. El SMTP fue configurado y probado en la sesión anterior; la recepción en el Gmail de Laura queda para su confirmación. Esta preparación no representa una auditoría exhaustiva ni una prueba nueva de entrega de cada evento de email.

Para cerrar la ventana temporal de altas de cliente sin confirmación: cambiar `AUDIT_REGISTRATION_OPEN=false` en el `.env` de beta y reiniciar `weotzi-beta`. Respaldo de configuración anterior: `.deploy_backups/env-before-audit-20260922`. El frontend retorna al registro normal de Supabase. No eliminar las protecciones de propiedad de cotizaciones al cerrar esa ventana. La política histórica de autoconfirmación de artista requiere revisión separada antes de convertir beta en un entorno de registro verificado.
