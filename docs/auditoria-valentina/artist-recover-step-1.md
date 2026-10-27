# Recuperar contraseña · artista · paso 1

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-REC-01 | Artista · `/recover?from=artist` · email inicial | [Auditoría, desde 1:29615](https://www.figma.com/design/YyppETJDvHCC98scjrZnlO/Auditor%25C3%25ADa-Redise%25C3%25B1o-We-%25C3%2596tzi?node-id=1-29615) (no releído) | [Copia ampliada 243:2531](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=243-2531) · SVG 1440 × 900 proporcionado en la tarea | Coincide en composición de 1440 px según SVG; tablet y móvil son adaptaciones sin frame aportado | Simulado: validación y error visibles; envío real bloqueado | Local `preview-local-safe`, 1440/768/390 px, capturas en el entorno temporal de QA; pruebas automáticas y navegador | Rama `valentina/artist-recover-figma` |

## Alcance y límites

- El enlace de recuperación del login de artista ya abre `/recover?from=artist`; la vista antigua incrustada en el login no se usa. No se cambió la lógica de Supabase ni los pasos 2–4.
- Referencia verificada: SVG entregado por la usuaria, nodo 243:2531. No hubo conector Figma disponible para leer propiedades o variantes adicionales. El sistema de diseño en código (`public/shared/css/ds/`) proporcionó tokens y componentes existentes.
- La preview segura muestra PREVIEW y datos ficticios. Un correo de prueba con formato válido habilita el botón, pero `resetPasswordForEmail` está desactivado: aparece el error esperado y no avanza al paso 2. No se probó recepción de email, OTP ni escritura real.
- Quedan por comparar e implementar los pasos 2, 3 y 4 en **esta misma rama** cuando se aporten sus referencias. Esta entrada no los declara terminados.
