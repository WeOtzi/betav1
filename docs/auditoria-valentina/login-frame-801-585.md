# Pantalla 2 · acceso de artista · frame 801:585

## Alcance y referencia

- Rama: `valentina/rediseno-laura`.
- Base: `4810dde74061f38b38a257365813b5bf0d425d94`, versión `2.2.3-valentina.rediseno-laura.6`.
- Referencia: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-585
- Nodo leído con `get_design_context`, incluida su captura de 1440 × 1024.
- Sistema de diseño: tokens y componentes existentes en `public/shared/css/ds/`. Consulta al archivo Figma del DS por Neutral y Archivo Black sin resultados; no se inventan componentes.
- Única superficie modificada: `/artist/login/`. Sin cambios en autenticación, recuperación, permisos, consultas, otras páginas ni CSS global.

## Inventario

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2-01 | Artista · `/artist/login/` · anónimo | No solicitado | 801:585 | Coincide: composición del frame de escritorio; controles flotantes existentes conservados | Simulado: acceso y sesión; Probado: validaciones y avisos sociales | Capturas y geometría renderizada en preview local segura | Entrega 2.2.3-valentina.rediseno-laura.7 |

## Diferencias corregidas

- Título de bienvenida: Archivo Black 400, sin negrita sintética del h1.
- Desplazamiento vertical de campos y botón principal corregido (~0,9 px a 1440 × 1024).
- Etiqueta Recomendado: ancho 101,132 px; separación final al registro según frame.
- Siete SVG descargados del nodo exacto, con dimensiones originales fraccionarias, sin referencias temporales en runtime. Sus únicas referencias están en el HTML de este login.

## Pruebas realizadas

Entorno: proceso existente `node scripts/release/local-preview.cjs` en 4647; identificación accesible «Entorno de prueba». Se conservó ese proceso al detectar el puerto ocupado. URL de prueba: `http://localhost:4647/preview/preview-local-safe/artist/login/`.

1. Prueba previa a la edición: fallaron las seis aserciones de Y de los campos/botón/etiqueta, ancho de etiqueta y peso tipográfico.
2. Después de editar, geometría renderizada a 1440 × 1024: email Y=395,906; contraseña Y=496,063; ENTRAR Y=571,354; etiqueta Y=724,542 y ancho=101,125. Desvío menor de 0,1 px frente a las medidas de referencia salvo redondeo del motor. Peso de título 400.
3. Viewports reales de iframe del mismo origen: 1920×1080, 1440×1024, 1366×768, 1280×720, 1024×768, 801×700, 768×1024 y 390×844. Sin overflow horizontal de documento ni textos recortados en los tres botones sociales. A 768/390 px, botones sociales de 44 px de alto.
4. Los siete SVG cargan con `naturalWidth > 0`; geometría de iconos de campo y botones ~19,9896 px, Facebook ~16,6563 px y estrella ~12,2917 × 11,7396 px.
5. Clic ENTRAR sin datos: rechazado; foco en email. Email inválido: `typeMismatch`, rechazado.
6. Instagram y Facebook: clic muestra el aviso correcto de proveedor no disponible. No autentican. Email: oculta el aviso y enfoca `login-email`.
7. Recuperar contraseña: navega a `/recover/?from=artist&email=…` y renderiza el formulario existente. No se solicitó código ni se enviaron emails. La herramienta falló al intentar clicar el enlace de vuelta (`UnknownVizError`); se volvió mediante navegación explícita.
8. `npm test`: 419 aprobadas, 0 fallidas, 0 omitidas.

## Verificación final y límites

El bloqueo inicial de captura se resolvió cuando Valentina hizo visible la pestaña de Review. Se obtuvieron y revisaron capturas del frame renderizado a 1440×1024 y de la adaptación a 390 px, dentro de iframes de QA del mismo origen, escalados solo para caber en Review. La composición de escritorio coincide visualmente con la referencia: panel oscuro, título de tres líneas, logo, formulario, separador y botones sociales. No se hizo un diff automatizado píxel a píxel. Se conservan el soporte flotante existente y el ojo del entorno de prueba, que no pertenecen al frame Figma. Los iframes temporales de QA se eliminaron del navegador; no forman parte del código.

- Acceso simulado: completar el formulario con datos ficticios y clicar ENTRAR abre `/artist/dashboard/`. Al volver a cargar `/artist/login/` aparece «Ya iniciaste sesión», confirmando conservación de la sesión ficticia.
- Consola del login: sin errores de autenticación/UI; advertencia existente de soporte `[support-chat] conversation endpoint failed 501`, servicio no simulado en preview. No se modificó ese módulo compartido.
- No hay pantalla vacía ni overlay de errores; la página conserva su identidad y controles accesibles.

No se realizaron pruebas de autenticación real, Google, integración con Instagram/Facebook, entrega de correos ni Supabase. El acceso y la sesión comprobados en preview son simulados. Instagram/Facebook solo muestran avisos de no disponibilidad; Email enfoca el formulario de acceso existente.

La publicación se realiza con `valentina-delivery.cjs publish`, que vuelve a ejecutar `npm test` y `check:release`, publica únicamente los archivos explícitos y espera CI y coincidencia de versión/SHA pública. La evidencia final de commit/CI/SHA se informa en el cierre de la tarea.

## Recuperación

Revertir únicamente el commit de esta entrega mediante una nueva entrega versionada en la misma rama; sin migraciones ni rollback de datos. No se deben descartar otros trabajos ni modificar main.
