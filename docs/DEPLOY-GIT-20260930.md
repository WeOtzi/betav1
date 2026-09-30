# Entrega Git y entorno de Valentina — 30/09/2026

Repositorio: https://github.com/WeOtzi/betav1. Copia administradora: `C:\dev\weotzi-unified`. Versión de integración: **2.1.0**.

El runtime de septiembre se había publicado directamente por SSH/SFTP. Esta entrega incorpora esos cambios a Git y prepara desarrollo local → GitHub → servidor. CI verifica versión, changelog, descripción de commits y pruebas. El controlador privado del servidor descarga únicamente la SHA verificada; no hace pull sobre la carpeta pública ni recibe credenciales desde las ramas.

## Evidencia y estado

- Suite local: **397 pruebas aprobadas**, cero fallos. Prueba visual del entorno seguro: login de artista/cliente con una identidad ficticia, selector de modos en ambos sentidos, cotizaciones con detalle/chat, perfil, galería y agenda con actividad. La galería conserva sus cambios al recargar. El adaptador demuestra comportamiento local; no entrega correos ni autentica usuarios reales.
- Revisión de secretos del código: retirado un token administrativo n8n literal de una herramienta antigua, una clave de ejemplo y una contraseña histórica de documentación. La rotación de tokens anteriormente expuestos en el historial necesita revisión administrativa; borrar el literal actual no los revoca.
- Beta detectada con 502. Se comprobó que TCP loopback falla incluso desde un proceso Node aislado; el socket Unix responde 200. Aplicación real recuperada y URL pública `/inicio/` comprobada con **HTTP 200**.
- PM2 de beta pasó a una carpeta privada del controlador. El monitor PHP anterior, que reiniciaba el proceso cada minuto, se respaldó y desactivó. El proxy PHP ahora conecta al socket privado.
- La adopción de la versión anterior conserva código real, configuración y archivos persistentes. Los datos Supabase no se migran automáticamente durante un despliegue Git.
- Previews: gateway revisado con datos ficticios, sin ejecutar código de servidor ni scripts de instalación de las ramas. El dominio `preview.weotzi.com`, la sincronización de ramas y la recuperación completa deben verificarse en el servidor antes de considerarlos habilitados.
- Usuario Windows Valentina: scripts preparados y auditados. La autorización UAC fue cancelada; **no se creó todavía el usuario**. El aislamiento requiere una prueba real con su token Windows y después con el token de herramientas de su Codex.
- Identidad GitHub y correo de Valentina pendientes de informar. No se ha otorgado acceso a una identidad supuesta.

## Guías operativas

- [Handoff](HANDOFF-VALENTINA.md), [primera tarea](VALENTINA-FIRST-TASK.md) y [borrador de correo](VALENTINA-EMAIL-DRAFT.md).
- [Publicación y rollback](../deployments/hostinger/RELEASE-RUNBOOK.md).
- [Usuario Windows, comprobación y reversión de permisos](WINDOWS-VALENTINA.md).

No considerar completa la configuración hasta comprobar el commit en GitHub, CI de esa SHA, `/api/release` público, una preview de rama y un rollback con recuperación real del proceso. Estos puntos se actualizarán con evidencia al completarse.
