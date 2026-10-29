# Ajustes finales de las cuatro pantallas

Versión: `2.2.3-valentina.rediseno-laura.12`. Rama: `valentina/rediseno-laura`.
Referencia: archivo Figma `w3JA83CcP5ISKjyOu87mx1`, nodos releídos con contexto y metadatos.

## Alcance y evidencia

| Pantalla | Nodo | Diferencia comprobada | Corrección |
| --- | --- | --- | --- |
| 1 · `/inicio/` | `797:269` | Etiquetas de 26.375 px en vez de 24; títulos de 37 en vez de 34; primera imagen de 341.328 en vez de 342; ancho interior seleccionado y espaciado acumulado | Ajustes locales de caja, interlineado, texto descriptivo, marca y alineación. Figuras geométricas conservadas por aprobación explícita de Laura y Valentina. |
| 2 · `/artist/login/` | `801:585` | Cartel con interlineado 68.4 en vez de 69 y glifos desplazados unos 3 px hacia abajo | Caja de 327 px, interlineado 69 y compensación de línea base desktop. Formulario y acciones intactos. |
| 3 · `/client/login/` | `801:1124` | Formulario x=875 en vez de 873 y cartel con el mismo desvío de línea base | Proporciones de columnas y padding equivalentes al acceso artista; formulario medido x=872.984. |
| 4 · `/client/register/` | `801:1120` | CONTINUAR x=1242.531, y=747, ancho=165.469 frente a x=1248.34, y=745.8, ancho=164.66 | Ancho explícito, margen derecho desktop de 27 px (el footer de Figma está desplazado 5 px), altura del shell del primer paso. Resultado x=1248.344, y=745.797, ancho=164.656. |

Los cambios de runtime están limitados a cuatro hojas CSS ya específicas de estas pantallas. No se modifican lógica, permisos, consultas, rutas ni datos. Registro conserva placeholders vacíos y el texto literal «or browse files». Los pasos posteriores no reciben estos overrides.

## Pruebas

- Entorno local: `http://localhost:4647/preview/preview-local-safe/`, comprobado `window.WEOTZI_PREVIEW === true`, adaptador ficticio.
- Referencias desktop: Inicio 1440×1168, accesos 1440×1024, registro 1440×857. Responsive adicional a 768 y 390 px.
- Aserciones de geometría primero fallidas con los valores anteriores, luego aprobadas. La medición DOM del cartel incluye la compensación óptica de línea base; no se confunde el borde del glifo con la caja de texto de Figma.
- Inicio: selección cliente/artista con teclado, cambio de destino y navegación al acceso artista. Se conserva el destino existente de cliente a `/marketplace/`.
- Accesos: formularios vacíos, formato de email, contraseña requerida, recuperación artista visible y enlace de registro cliente. Imágenes locales cargadas, contenido visible, sin overflow horizontal ni excepciones JS en las tres anchuras.
- Registro: placeholders, ancho/alineación del botón, campos requeridos y foco, email/usuario/contraseña, rechazo de archivo no imagen, cuatro SVG locales, avanzar/volver y restaurar borrador sin persistir contraseña. No se crea una cuenta.
- Browser disponible para captura en Review. Mediciones y recorridos automatizados adicionales con Edge aislado/CDP y Playwright. Las capturas esperan fuentes e iconos; las primeras imágenes de la auditoría anterior podían mostrar iconos aún sin hidratar.
- Capturas y scripts temporales, fuera del repositorio: `C:/Users/Dev/AppData/Local/Temp/opencode/geometry.cjs`, `four-screen-qa.cjs`, `register-qa.cjs`, `final-{inicio,artist,client}-{1440,768,390}.png`, `geometry-register.png` y `register-{1440,768,390}.png`.

## Clasificación y límites

Visual: diferencias geométricas identificadas corregidas; excepción aprobada en las ilustraciones de Inicio. No se certifica igualdad binaria de píxeles: el borde rasterizado de los glifos del cartel difiere hasta 1 px entre Figma y Edge, aun coincidiendo las filas iniciales (403, 486 y 555). Se mantienen ojo flotante y soporte, ajenos a Figma. Funcional: interacción local **Probada**; servicios del entorno **Simulados**. Autenticación, emails, integraciones y persistencia remota **No probados**.

Publicación: la entrega automática verifica tests, política de release, CI y SHA pública. Preview: https://preview.weotzi.chat/ . PR existente: https://github.com/WeOtzi/betav1/pull/12 . La SHA y el resultado final se adjuntan al PR una vez publicados; este documento no anticipa su aprobación.

Recuperación: revertir el commit de esta entrega y generar una nueva versión en la misma rama; no hay migraciones ni cambios de datos. El rollback operativo corresponde a Isaí.
