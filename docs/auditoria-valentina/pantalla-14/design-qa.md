# Pantalla 14 · Confirmá tu artista

Estado de QA local: **passed**. Entrega: `2.2.3-valentina.rediseno-laura.28`.

## Referencia y alcance

| ID | Rol / URL / estado | Nodo rediseño | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- | --- |
| P14 | Cliente · `/quotation/?artist=usuario` · confirmación | [2105:7177](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=2105-7177) | Coincide en composición, tipografía, colores, dimensiones e iconos del frame; adaptación fuera de su ancho | Simulado: navegación, selección, cuenta, soporte y salida probados | Capturas adjuntas y pruebas descritas abajo |

Se leyó el contexto completo, captura, medidas de la sección `2105:6049` y contexto específico del botón `2105:6099`. Sistema de diseño consultado: `jLxPQyG2rxrq5bvfQgNcBd`, más `public/shared/css/ds/README.md`, tokens, componentes y footer existentes. No se edita Figma.

La capa nueva solo se activa con `.q-artist-confirm-page`, al renderizar `screen.id === 'artist'`. Al continuar se restaura el encabezado/pie anterior. No cambia las otras pantallas, el backend, tablas, permisos, consultas ni contratos de guardado.

## Implementación y comparación

- HTML/CSS/JS vanilla existentes: `public/quotation/index.html`, `public/shared/css/quotation-ds.css`, `public/shared/js/script.js`.
- Reutiliza el mismo encabezado y sus clases DS, autenticación/cuenta, `handleClientLogout`, footer Bauhaus, soporte y `wo-icons.js`. No hay otro shell ni nueva página.
- A 1469 px: título x60/y145; tarjeta x262.5/y236, ancho900; avatar152; título56, nombre28, meta14, precio20; acciones65; continuar37. Se corrigieron el peso sintético de titulares, bordes incluidos en padding, interlineados, tracking, gap de navegación, alto del pie y tamaño del CTA tras comparar con las medidas de Figma.
- Tarjeta centrada en el contenido de ancho máximo1305; márgenes fluidos y ajustes de navegación para escritorio compacto. A mayor ancho no se estiran textos ni retratos. En ventanas de poca altura la página permite scroll hasta todas las acciones; no oculta contenido para forzar el frame dentro del viewport.
- Datos del artista, foto, precio, ubicación, estilos y enlace siguen siendo dinámicos. “Daniela Gomez / 300 USD” se usaron **solo en memoria de la pestaña QA** para comparar con el frame. No se alteran fixtures ni perfiles del runtime para imitar datos del diseño.
- Los SVG de TikTok16×18, X17×17, YouTube20×18 y soporte26.6667×26.6667 se descargaron del frame a `public/shared/assets/quotation-confirm/`, sin modificar sus bytes ni sus dimensiones raíz. Los otros iconos coinciden con Feather ya disponible. Todos los assets locales cargan, tienen contenido y están en su slot; no quedan URLs temporales en runtime.

## Verificación

Entorno: `http://localhost:4647/preview/preview-local-safe/`, identificado como entorno de prueba con datos ficticios. Browser integrado permitió inspección y recorridos; su captura falló con “Screenshot needs a visible tab”. La usuaria autorizó explícitamente usar Playwright alternativo. Se usó Chrome headless con el Playwright ya almacenado fuera del proyecto, sin instalar dependencias.

| Prueba | Resultado |
| --- | --- |
| Identidad de página, contenido y render sin overlay de error | Aprobado |
| Capturas a1469×1116, 1440×900, 1280×720, 1024×768, 1920×1080, 2560×1440, 768×1024, 800×600, 900×600 y390×844 | Sin overflow horizontal ni tarjeta fuera del viewport |
| Barrido de193 anchos entre768 y3840 px, paso16 | Sin desbordes ni solapamiento entre navegación y cuenta/salida |
| Cotizar con este artista | Abre la idea y conserva el artista seleccionado |
| Seguir sin artista definido | Abre la idea, `no_artist=true` y `artist_id=null` |
| Continuar | Abre la idea conservando el artista |
| Cuenta / Escape | Modal abre y cierra |
| Soporte | Panel abre y cierra; no se envía ningún mensaje |
| Log out | Cierra sesión ficticia y llega a `/client/login/` |
| Recursos del recorrido final / errores JS no capturados | Cero HTTP fallidos / cero errores JS |
| Aislamiento: idea, zona corporal, detalles y resumen a1440 y390 | Ocho capturas idénticas byte a byte a la versión anterior, usando CSS/JS originales de HEAD en una pestaña de comparación |
| TDD / suite | Test del chrome observado fallar antes de implementar; dos pruebas de regresión agregadas. `npm test`:465/465 |
| `git diff --check` | Aprobado |

En un probe independiente apareció un aviso CSP previo de worker de una biblioteca externa; la preview bloquea workers por seguridad. No se relaja esa política. El primer ensayo de salida agotó la espera porque el test esperaba `/client/login` y la ruta canónica termina en `/`; se verificó la navegación y se corrigió la expectativa del test, no el producto.

### Evidencia conservada

- [Fuente Figma](pantalla14-figma.png): la exportación incluye el sangrado exterior del footer del lienzo; no se añade ese desborde a la página web.
- [Implementación1469](pantalla14-1469.png).
- [Escritorio compacto1024](pantalla14-1024.png).
- [Adaptación390](pantalla14-390.png).
- Scripts y resultados ampliados locales: `C:/Users/Dev/AppData/Local/Temp/opencode/pantalla14-qa.cjs`, `pantalla14-qa.json`, `pantalla14-isolation.cjs`, `pantalla14-isolation.json`.

## Límites y recuperación

Esta entrega no acredita autenticación real, emails, envíos de cotización, persistencia Supabase ni atención de soporte: el entorno es simulado. La selección de artista conserva el comportamiento existente, sin nuevas escrituras. No se probaron otros motores de navegador ni cada resolución posible; el barrido y las capturas cubren los anchos indicados.

Publicación: rama permanente `valentina/rediseno-laura`; comprobar CI de push y la misma SHA en `https://preview.weotzi.chat/api/release`. Ruta revisable: `/quotation/?artist=valentina-preview.wo`. PR permanente para revisión de Isaí; no se mezcla a main.

Rollback: revertir el commit de esta entrega y preparar otra versión en la misma rama. Versión previa `.27`, SHA `28e8062057eda17e008992b153e8641ff96ae074`. Sin migraciones ni datos remotos que revertir.
