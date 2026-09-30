# Primera tarea de Valentina: completar el rediseño y probar los flujos

Lee primero [HANDOFF-VALENTINA.md](HANDOFF-VALENTINA.md). Trabaja desde tu copia local en una rama `valentina/<tarea>` y verifica cada entrega en su preview. Isaí aprueba el PR a `main`.

## Objetivo

Comparar una por una las pantallas actuales de **artista y cliente** con la auditoría de Laura y el rediseño original. Implementar las diferencias pendientes usando el sistema de diseño. Probar los flujos y corregir los defectos que puedas reproducir dentro del alcance de cada tarea; reportar los demás con evidencia.

No se considera terminado un flujo porque su pantalla inicial se vea bien. Deben revisarse sus pasos, menús, modales, validaciones, estados y navegación, incluyendo móvil.

## Las tres fuentes

| Fuente | Para qué usarla | Páginas verificadas al 30/09/2026 |
| --- | --- | --- |
| [Auditoría de Laura](https://www.figma.com/design/YyppETJDvHCC98scjrZnlO/Auditoria-Rediseno-We-Otzi?node-id=0-1) | Inventario de recorridos y capturas actuales; notas y dudas | Artistas `0:1`, Clientes `1:2` |
| [Rediseño original](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=0-1) | Referencia de composición, texto, estados y acciones | Flujo artistas `0:1`, Flujo clientes `205:302` |
| [Design System](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi?node-id=11-782) | Tokens, componentes, variantes y reglas visuales | UI Kit + Mood Board `0:1`, Atomic Design `11:782`, Auditoría `21:7455` |

No modifiques el original para hacerlo coincidir con el código. Para cada tarea comparte con la IA el **enlace del nodo concreto**, además del sistema de diseño. Los IDs son una ayuda de navegación; verifica la versión actual de Figma.

La lectura inicial confirmó capturas de ambos roles y múltiples estados. No produjo una clasificación completa y verificable de qué está implementado o pendiente. Por eso el primer paso es comparar la app actual, no asumir que todos los frames del inventario requieren reescritura.

## 1. Crea un inventario antes de editar

Abre la página Artistas y luego Clientes en la auditoría. Recorre los caminos dibujados, localiza su URL y ubica el frame equivalente del original. Incluye cada estado que cambie el comportamiento o la composición.

Guarda una tabla en `docs/auditoria-valentina/<tarea>.md` con estas columnas:

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-001 | Cliente · acceso · error de contraseña | enlace | enlace | Por revisar | Por revisar | entorno, versión y captura | pendiente |

Para **Visual**, usa `Coincide`, `Con desvíos`, `Sin rediseño` o `Falta referencia`. Para **Funcional**, usa `Probado`, `Falla`, `Simulado`, `Bloqueado` o `No probado`. No mezcles ambas clasificaciones. Una preview con fixtures debe marcarse como simulada cuando corresponda.

Prioriza defectos que bloqueen entrar, navegar, cotizar o responder. Después corrige diferencias de la pantalla y sus componentes. Si dos cambios tienen objetivos independientes, usa ramas y PR separados.

## 2. Guía de pantallas y nodos

Estos pares fueron leídos en Figma el 30/09/2026. Son puntos de entrada al inventario, no una declaración de faltantes. Los frames repetidos representan estados diferentes: revisa cada uno.

| Área | Ruta de la app | Auditoría | Original |
| --- | --- | --- | --- |
| Artista: ingreso | `/artist/login/` | `1:19989` | `24:1261` |
| Artista: registro | `/register-artist/` | desde `1:27711` | desde `72:12357` |
| Artista: dashboard | `/artist/dashboard/` | `1:20071` | `24:1424` |
| Artista: perfil público | `/artist/profile/` | `1:29900` | `344:1184` |
| Artista: cotizaciones | `/my-quotations/` | `1:6842`, `1:7275`, `1:8004` | `33:5758`, `547:1824`, `547:2262` |
| Artista: detalle pendiente/respondida | drawer/detalle desde cotizaciones | `1:16313`, `1:16622` | `62:11137`, `555:5228` |
| Artista: detalle aprobada/progreso/completada | mismo detalle con distintos estados | `1:17830`, `1:18239`, `1:19106` | `555:5537`, `557:6272`, `557:8018` |
| Artista: agenda | `/calendar/` | desde `1:2501`, más sus editores | desde `52:8311`, más sus editores |
| Artista: estadísticas | `/my-quotations/statistics/` | `1:2746` | `122:12196` |
| Artista: Job Board | `/job-board/` | `1:20552`, `1:21403`, `1:21806` | `28:1856`, `104:2707`, `105:4079` |
| Artista: postulaciones | `/artist/applications/` | desde `1:21887` | desde `105:4480` |
| Artista: spots/invitaciones | `/studio-spots/`, `/artist/invitations/` | desde `1:1054`, `1:1947` | desde `28:3877`, `42:6903` |
| Artista: Travel | `/artist/travel/` | `1:24228` y estados hasta `1:26996` | `68:11882` y estados hasta `173:28256` |
| Artista: Inbox | `/artist/inbox/` | `1:27348` | `144:1250` |
| Artista: cuenta | `/artist/account/` | desde `1:12681` | desde `156:10014` |
| Cliente: crear cuenta/ingreso | `/client/register/`, `/client/login/` | desde `1:32625`, `1:33149` | desde `205:632`, `205:649` |
| Cliente: dashboard | `/client/dashboard/` | `1:33320` | `251:4793` |
| Cliente: marketplace | `/marketplace/` | `1:33677` | `277:6587` |
| Cliente: solicitud/Job Board | `/client/requests/` y publicación | desde `1:34706` | desde `286:8577` |
| Cliente: cotizador | `/quotation/` | desde `1:36562` | desde `286:9421` |
| Cliente: mapa/globo | `/explore/`, `/explore/globe/` | `1:37911` para globo | `286:10265` para globo |
| Cliente: chats | `/client/chats/` | `1:38322`, `1:38768` | `286:11109`, `333:1540` |
| Cliente: cuenta | `/client/profile/` | `1:39178` | `286:11953` |
| Público: recuperar contraseña | `/recover/` | desde `1:29615` | desde `243:2530` |

La auditoría también contiene recordatorios, notificaciones, menú de usuario, soporte, templates de mensajes y emails. Agrégalos al inventario. Notas como “Cotización manual (?)”, “Nuevo cliente desde dashboard (?)” o “Aceptar no lleva a otra pantalla” son dudas/observaciones: reproduce el caso y define esperado/observado antes de hacer cambios.

## 3. Cómo pedir el rediseño a la IA

Ejemplo:

> En mi rama valentina/rediseno-[flujo], aplica esta pantalla y sus estados: auditoría [nodo], rediseño [nodo], sistema de diseño [enlace]. Primero compara la app local y ubica los archivos. Reutiliza la biblioteca CSS/JS existente. Conserva datos, permisos, acciones y navegación. No inventes textos ni controles. Valida desktop, tablet y móvil con capturas y prueba cada interacción de este flujo. Dime qué pruebas son simuladas y cuáles requieren el entorno real. Actualiza changelog, versión y evidencia del PR.

El sistema de diseño del código está en `public/shared/css/ds/` y `public/shared/js/ds/`. Consulta la [guía de uso](../public/shared/css/ds/README.md) y los catálogos `/componentes/` y `/componentes/compuestos/` antes de crear un componente nuevo.

Comprueba tipografía, colores semánticos, bordes, espaciado, iconos, estados de botones/campos y foco. Conserva el texto literal del diseño. El header y el footer son compartidos: si corriges una pieza global, revisa las otras rutas que la usan.

## 4. Recorrido funcional mínimo

**Cuenta y acceso:** entrar/salir, contraseña incorrecta, validaciones, duplicado, volver atrás, recarga, modo cliente/tatuador, activación del perfil faltante y recuperación. El registro auténtico y la recuperación por email necesitan el entorno de prueba autorizado.

**Artista:** perfil y galería, cotizaciones (filtros, detalle, respuesta, diseño, sesiones, notas y estados), agenda (vistas, crear/editar/bloquear/reprogramar), oportunidades/postulaciones, invitaciones, Travel, Inbox y cuenta. No interpretes “simulado” como persistencia remota.

**Cliente:** buscar/filtrar/favoritos, perfil público, cotizador completo (todos los pasos, referencias, borrador, validaciones, resumen, envío/confirmación), cotizaciones y propuestas, chats, solicitudes, cuenta y cambio de modo.

**Emails y servicios externos:** registra qué evento los dispara y quién debe recibirlo. Su entrega y el destino del enlace se validan con un buzón de prueba real autorizado. Las previews evitan esas operaciones reales; una simulación no las acredita.

Usa dos perfiles de navegador y cuentas de prueba distintas para probar el intercambio entre cliente y artista. Comprueba datos después de recargar cuando haya persistencia real. Reporta permisos incorrectos, llamadas fallidas o acciones que solo muestran éxito sin producir el resultado esperado.

## 5. Cómo reportar y corregir un fallo

```text
ID: V-...
Entorno + versión + commit:
Rol y URL:
Datos de prueba:
Pasos para reproducir:
Resultado esperado:
Resultado observado:
Captura / consola / respuesta API sin secretos:
Impacto: bloquea el flujo / impide una acción / visual
Causa y corrección, si se conocen:
Prueba posterior:
PR o bloqueo concreto:
```

Si puedes arreglar un defecto reproducible dentro de la misma pantalla/flujo, hazlo y vuelve a probar. Si requiere otra tarea, permisos, un proveedor o datos reales, crea el reporte y enlázalo desde tu PR. No lo escondas como “pendiente de diseño”.

## 6. Cuándo está terminada una entrega

- Cada pantalla y estado del alcance tiene comparación y clasificación en el inventario.
- Se conserva el funcionamiento existente y se verifica el comportamiento afectado.
- Hay capturas comparables a la referencia y controles a 1440, 768 y 390 px, sin overflow ni controles inaccesibles.
- Se comprobaron validaciones, menús, modales, errores y foco relevantes.
- Los defectos encontrados están corregidos o registrados con bloqueo concreto.
- El código, changelog, versión y explicación del commit son coherentes.
- El workflow de la rama pasa; la preview muestra el mismo commit que el PR.
- El PR está listo para revisión de Isaí, con Figma, evidencia y rollback. El merge de Isaí cierra la entrega; la aceptación global del rediseño requiere completar el inventario de ambos roles.
