# Login cliente · panel beta cerrada

Referencia: captura de la pantalla «Bienvenida de nuevo» y comentario de Laura aportados en esta tarea. Puntos de entrada: auditoría `1:33149`, original `205:649` según `docs/VALENTINA-FIRST-TASK.md`; no se midió el nodo actual mediante conector Figma. El póster del login de artista (`public/artist/login/index.html`) sirve como referencia del estilo añadido.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-client-login-beta | Cliente · `/client/login/` · anónimo | `1:33149` y captura recibida | `205:649` | Con desvíos → rótulo y bajada agregados al panel oscuro | Simulado | Preview segura `http://localhost:4647/preview/preview-local-safe/client/login/`, 1440 px de ancho, sin desborde, rótulo y bajada visibles; a 390 px el panel sigue oculto y el formulario visible. El envío vacío enfoca Email. Captura local fuera del repositorio: `C:\Users\Dev\AppData\Local\Temp\opencode\client-login-1440.png`. | Solo copia y estilo del póster; sin cambios de acceso. |

La barra PREVIEW confirma datos ficticios y sesión cerrada; soporte remoto indica “No simulado en preview”. No se verificaron autenticación real, persistencia, Google ni correos. El viewport de 1440 × 900 muestra el panel completo en una captura de página completa, porque la barra PREVIEW añade altura.
