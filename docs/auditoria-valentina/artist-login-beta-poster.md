# Login artista · panel beta cerrada

Referencia recibida: dos capturas de Figma de la auditoría (comentarios y diseño correcto), correspondientes al ingreso de artista; nodo de auditoría `1:19989`, original `24:1261` según `docs/VALENTINA-FIRST-TASK.md`. Estilo y texto existentes: `/registerclosedbeta/` (`public/registerclosedbeta/index.html` y `public/shared/css/registerclosedbeta-ds.css`). No se verificaron medidas del nodo con conector Figma.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-login-beta | Artista · `/artist/login/` · anónimo | `1:19989` y capturas recibidas | `24:1261` y captura correcta recibida | Con desvíos → textos agregados; `A TU` ya coincidía con `#0055FF` | Simulado | Preview local segura `http://localhost:4647/preview/preview-local-safe/artist/login/`, 800 CSS px: poster sin desborde, login visible; recuperación navega a `/recover/?from=artist`. | Agregar rótulo y bajada al póster; no cambiar token azul ni formulario. |

La barra PREVIEW confirma datos ficticios, sin backend ni emails reales. La integración de soporte devuelve 501 por estar desactivada en este entorno. No se verificó beta publicada, persistencia real ni capturas a 1440/390 px: el navegador disponible tenía un viewport de 800 CSS px sin control de tamaño.
