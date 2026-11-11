# Pantalla [5] — Dashboard de cliente

- Referencia: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1126
- Ruta única: `/client/dashboard/`.
- Versión: `2.2.3-valentina.rediseno-laura.13`, rama `valentina/rediseno-laura`.
- Entorno local: `http://localhost:4647/preview/preview-local-safe/client/dashboard/`, identificado por `WEOTZI_PREVIEW`, `WeotziPreview.isSimulated` y el control flotante de entorno de prueba.
- Preview de entrega: https://preview.weotzi.chat/client/dashboard/ . La herramienta de entrega verifica CI y la misma SHA en `/api/release`.

## Alcance y decisiones confirmadas

Valentina confirmó copiar **también el encabezado literal** aunque incluya accesos de artista en el dashboard de cliente. Se reutilizan rutas existentes; no se otorgan permisos nuevos ni se modifican esas pantallas. Inbox conserva el destino de chats del cliente. El selector automático de modo y el botón flotante de soporte no forman parte del frame: se ocultan solo en esta ruta; Soporte y Centro de ayuda siguen disponibles en el footer. El cambio de modo también está disponible desde `/client/profile/`.

El frame es de 1440×2694. Se leyeron `get_design_context`, captura a resolución original y geometría/tipografía mediante lectura de Plugin API, sin editar Figma. Sistema de diseño consultado: `jLxPQyG2rxrq5bvfQgNcBd`, además de tokens y componentes vanilla existentes.

## Inventario

| ID | Rol / URL / estado | Nodo | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- | --- |
| P5-01 | Cliente / dashboard / próxima cita y actividad | `801:1126` | Coincide | Simulado | Comparación completa a 1440; fuentes Archivo Black regular, Inter y JetBrains Mono cargadas; globo y placeholder originales locales; detalle y cuenta abiertos/cerrados. |
| P5-02 | Cliente / dashboard / sin próxima cita o error | Sin variante adicional provista | Falta referencia | Probado | Tests: no mostrar citas vencidas/canceladas/completadas, ajenas al listado del cliente o inventadas tras un error. |
| P5-03 | Cliente / dashboard / responsive | Adaptación del mismo frame | Coincide | Simulado | Anchos de iframe real 1920, 1440, 1366, 1280, 1024, 768 y 390; media queries efectivas, sin overflow horizontal ni CTA fuera del ancho. |

Los bordes e imágenes que sobrepasan sus columnas en Figma se reproducen a tamaño de referencia; fuera de ese intervalo se redistribuyen las columnas. No se afirma igualdad de píxel entre motores de renderizado distintos.

## Datos y contratos conservados

- CSS nuevo cargado exclusivamente por el HTML de esta pantalla; no se alteran `client.css`, tokens, iconos ni componentes compartidos.
- `client-dashboard-reference.js` no hace escrituras y solo expone presentación ficticia si ambos indicadores de preview segura están activos. No modifica el store compartido ni la sesión. Sophie, Lauu, Kenji, Emma y los cuatro contadores corresponden al frame.
- En preview, Ver detalle abre la primera cotización **ficticia existente**: el contenido de ese modal pertenece al fixture del simulador, no a una reserva real de Lauu. Las tarjetas de artistas de referencia abren Marketplace, no perfiles inventados. Los contadores de referencia no representan actividad real.
- Fuera de preview se conserva el saludo, perfil, contadores, feed y ranking reales. Las fotos reales quedan sobre el placeholder; se reprodujo la regresión por hit-testing y luego se verificó corregida.
- La cita utiliza `WeotziData.Sessions.listByQuotationIds` y `quotations_db.id` numérico; abre el detalle con `quote_id`. No hay cambio de RLS, identidad, esquema, endpoints ni migración.

## Verificación

- `npm test`: **427/427**. Cinco tests nuevos cubren selección/escape, vacío, fallo de consulta, fixtures inaccesibles fuera de preview y ausencia de consulta sin cotizaciones del cliente. Los primeros tres fallaron inicialmente por ausencia de la implementación.
- Browser disponible, sin Playwright externo. Desktop y responsive medidos en iframe same-origin a ancho real porque la herramienta no expone cambio del viewport de la ventana. También se recorrió el dashboard directamente en su pestaña.
- Página/título correctos, contenido no vacío, sin overlay ni excepciones JS relevantes. Advertencia existente: soporte remoto responde 501 en este simulador, no demuestra un servicio conectado.
- Ver detalle → modal `DEMO-P01` visible → cerrar → contador de pendientes → pestaña Pendientes y tres cotizaciones ficticias visibles; Ö → centro de cuenta visible.
- Archivos estáticos no vacíos y con dimensiones verificadas en render: globo 652.4×534 a 1440, placeholder 28×29.1. Recursos temporales de Figma descargados; sin URLs temporales en runtime.

Capturas locales (fuera del repositorio, sin datos reales):

- Figma: `C:/Users/Dev/AppData/Local/Temp/opencode/pantalla5-figma.png`.
- Comparación desktop: `C:/Users/Dev/AppData/Local/Temp/opencode-browser-Niixb1/0/screenshot.png`.
- Interacción detalle: `C:/Users/Dev/AppData/Local/Temp/opencode-browser-7NnevL/0/screenshot.png`.

## Límites y reversión

No se verificaron autenticación real, autorización de los destinos de artista con una cuenta exclusivamente cliente, reservas, intercambio de mensajes, escritura en Supabase ni envío de correos. Preview es **simulada**. No se alteran otras rutas para resolver esas limitaciones. Para revertir: `git revert` del commit de esta entrega y nueva publicación versionada; no hay datos ni migraciones que revertir. Isaí administra el rollback operativo.
