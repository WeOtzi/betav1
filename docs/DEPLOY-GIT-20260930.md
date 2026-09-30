# Entrega Git y entorno de Valentina — 30/09/2026

Repositorio: https://github.com/WeOtzi/betav1. Copia administradora: `C:\dev\weotzi-unified`. Primera integración: **2.1.0**, commit `c181087ae3903771daa5418209ed141a75bd4ebc`. Corrección de arranque **2.1.1** preparada; su publicación debe acreditarse con SHA y evidencia propias.

El runtime de septiembre se había publicado directamente por SSH/SFTP. Esta entrega incorpora esos cambios a Git y prepara desarrollo local → GitHub → servidor. CI verifica versión, changelog, descripción de commits y pruebas. El controlador privado del servidor descarga únicamente la SHA verificada; no hace pull sobre la carpeta pública ni recibe credenciales desde las ramas.

## Evidencia y estado

- Suite local final: **398/398 pruebas aprobadas**, cero fallos y ninguna omitida. Prueba visual del entorno seguro: login de artista/cliente con una identidad ficticia, selector de modos en ambos sentidos, cotizaciones con detalle/chat, perfil, galería y agenda con actividad. La galería conserva sus cambios al recargar. El adaptador demuestra comportamiento local; no entrega correos ni autentica usuarios reales.
- GitHub `main`: integración 2.1.0 publicada mediante el conector GitHub autorizado del propietario. [Verify delivery, ejecución 36684275260](https://github.com/WeOtzi/betav1/actions/runs/36684275260) aprobó esa SHA. El CLI guardado usa `isai-weotzi` y solo tiene lectura; antes de usar `git push` normal se debe autenticar una identidad con escritura. Valentina necesita su propia cuenta y permisos, sin copiar sesiones o tokens del propietario.
- Revisión de secretos del código: retirado un token administrativo n8n literal de una herramienta antigua, una clave de ejemplo y una contraseña histórica de documentación. La rotación de tokens anteriormente expuestos en el historial necesita revisión administrativa; borrar el literal actual no los revoca.
- Beta detectada con 502. Se comprobó que TCP loopback falla incluso desde un proceso Node aislado; el socket Unix responde 200. Aplicación real recuperada y URL pública `/inicio/` comprobada con **HTTP 200**.
- PM2 de beta pasó a una carpeta privada del controlador. El monitor PHP anterior, que reiniciaba el proceso cada minuto, se respaldó y desactivó. El proxy PHP ahora conecta al socket privado.
- La adopción de la versión anterior conserva código real, configuración y archivos persistentes: release `legacy-20260930071026`, versión 2.0.1. Los datos Supabase no se migran automáticamente durante un despliegue Git.
- El primer cron falló porque `PM2 startOrReload` conservó el directorio de trabajo original; la recuperación automática restauró HTTP 200. La corrección a eliminar y crear el proceso con el directorio correcto se probó: el cron de las **07:39 UTC** publicó **2.1.0**, y `/api/release` público confirmó la SHA exacta `c181087ae3903771daa5418209ed141a75bd4ebc`. Las herramientas corregidas y los proxies PHP versionados se incorporan a **2.1.1**; su nuevo commit/CI no se confunde con el de 2.1.0.
- **Rollback real comprobado:** a las **07:44:29 UTC** volvió el release privado anterior `legacy-20260930071026`, versión 2.0.1, con HTTP 200. El cron de las 07:45 respetó el bloqueo de la SHA c181087; `resume` a las 07:46:11 y el cron de las 07:47:11 volvieron a publicar c181087. Código y recuperación del proceso se comprobaron, preservando configuración y archivos persistentes.
- **Preview publicada automáticamente:** rama `valentina/prueba-entorno`, [CI aprobado en ejecución 36685093322](https://github.com/WeOtzi/betav1/actions/runs/36685093322), publicación por cron a las **07:44:06 UTC**. El [índice HTTPS](https://preview.weotzi.chat) responde 200 y enlaza la [preview de la rama](https://preview.weotzi.chat/preview/preview-valentina-prueba-entorno-f6aefa2d/inicio/). El DNS ya resuelve tras limpiar la caché negativa. El dominio se creó en Hostinger Premium dentro del plan actual, sin costo adicional.
- **Navegador remoto:** artista con tres trabajos, cuatro sesiones de hoy y cotizaciones; cambio **Modo cliente** al panel con tres pendientes, dos publicaciones y dos propuestas; detalle de cotización y chat correctos. Ambos sentidos del selector también fueron comprobados. El gateway sirve únicamente archivos públicos y fixtures; POST al proxy devuelve 403 y no ejecuta backend de ramas ni envíos reales.
- Usuario Windows Valentina: scripts preparados y auditados. La autorización UAC fue cancelada; **no se creó todavía el usuario**. El aislamiento requiere una prueba real con su token Windows y después con el token de herramientas de su Codex.
- Identidad GitHub y correo de Valentina pendientes de informar. No se ha otorgado acceso a una identidad supuesta.
- Protección de `main` pendiente: la lectura actual indica `protected=false` y ninguna ruleset. La política del equipo exige PR/revisión de Isaí, pero GitHub aún no la impone. Los permisos disponibles no permiten administrarla; el propietario recibió la solicitud y tiene [instrucciones concretas](MAIN-PROTECTION.md).

## Guías operativas

- [Handoff](HANDOFF-VALENTINA.md), [primera tarea](VALENTINA-FIRST-TASK.md) y [borrador de correo](VALENTINA-EMAIL-DRAFT.md).
- [Publicación y rollback](../deployments/hostinger/RELEASE-RUNBOOK.md).
- [Usuario Windows, comprobación y reversión de permisos](WINDOWS-VALENTINA.md).

GitHub, CI, sincronización de beta, preview de rama y rollback están comprobados con los resultados anteriores. Quedan crear/probar la cuenta Windows de Valentina, confirmar su correo/usuario GitHub y otorgarle escritura, y activar la protección de `main`. No se crearon tags estables; las publicaciones se identifican por versión y SHA efectiva de `/api/release`. El siguiente commit 2.1.1 debe conservar su propia evidencia de CI/publicación.
