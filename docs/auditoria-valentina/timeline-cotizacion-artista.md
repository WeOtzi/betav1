# Timeline del detalle de cotización del artista

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-TIM-01 | Artista · `/my-quotations/detail/?quote=…` · pendiente | Captura actual adjunta por la usuaria | [Pantallas We Ötzi `62:11613`](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=62-11613) | Con desvíos antes del cambio; seis etapas y cuadrados comprobados después en preview local | Simulado | `preview-local-safe`, datos ficticios; Pendiente → Aceptar → Respondida y Reiniciar datos → Pendiente a 800 CSS px. Capturas headless 1440, 768 y 390 px. Prueba automatizada de las seis etapas y estados terminales. | Corrección de timeline en `valentina/inicio-placeholders` |

Referencia visual: imagen de la timeline de seis etapas proporcionada en la conversación. En esta sesión no está disponible el conector de Figma para inspeccionar las medidas internas del nodo; la coincidencia de píxeles exacta con el archivo no se declara verificada. El indicador de estado del encabezado y el historial conservan sus propios textos y datos. Rechazada, cancelada y vencida no generan una séptima etapa ni un marcador amarillo ficticio.

La preview local no comprueba persistencia remota, emails ni permisos de Supabase. La herramienta de navegador dejó de permitir capturas tras la primera; las capturas finales se tomaron con Chrome headless en la misma URL. La timeline se apila verticalmente a 768 y 390 px. La captura de 390 px muestra recorte horizontal en otras partes de la página (barra superior y dossier), fuera del alcance de esta corrección; no se declara la página completa libre de desborde móvil.
