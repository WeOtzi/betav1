# Recuperar contraseña · artista · paso 2

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-REC-02 | Artista · `/recover?from=artist` · código inicial | [Auditoría, desde 1:29615](https://www.figma.com/design/YyppETJDvHCC98scjrZnlO/Auditor%25C3%25ADa-Redise%25C3%25B1o-We-%25C3%2596tzi?node-id=1-29615) (no releído) | [Copia ampliada 243:2601](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=243-2601) · SVG 1440 × 900 entregado en la tarea | Coincide en composición desktop según SVG; tablet/móvil adaptados sin frame específico | Simulado: entrada, error, reenvío y volver; OTP real bloqueado | Local `preview-local-safe`; captura visual de HTML/CSS a 1440/768/390 px y recorrido interactivo en navegador | PR #6 · rama `valentina/artist-recover-figma` |

## Alcance y límites

- La vista conserva el envío y la verificación de Supabase Auth. No se enviaron correos: para abrir el paso 2 en la preview se reemplazó **solo en la sesión del navegador** la respuesta del servicio externo por una respuesta ficticia. Se comprobó que el código se distribuye en las seis casillas, habilita Verificar, muestra el error de OTP inválido, limpia los campos y reinicia la espera al reenviar, y vuelve al email con foco y valor conservados. Esto no demuestra un OTP válido ni una sesión recuperada.
- El texto, la geometría y las seis casillas se contrastaron con el SVG proporcionado. La captura responsive sin barra PREVIEW usa una copia temporal del HTML/CSS de la rama para verificar dimensiones, no reemplaza la prueba interactiva. El viewport real de 390 px no tiene desborde horizontal (`scrollWidth = 390`); las seis casillas y el botón permanecen visibles.
- La preview segura desactiva emails y backend real. No hubo conector Figma para leer propiedades o variantes adicionales ni se probó recepción de correo, validación real del token o persistencia. Los pasos 3 y 4 siguen pendientes en este PR borrador.
