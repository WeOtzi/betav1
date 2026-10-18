# Inicio · tarjetas de elección de rol

Referencia: [Pantallas We Ötzi — copia ampliada, nodo 238:2335](https://www.figma.com/design/WHCgICsA3ipbAE2srVls9A/Pantallas--We-Otzi--copia-?node-id=238-2335). La captura del nodo facilitada en la conversación muestra una zona neutra para ilustraciones aún no disponibles. Por indicación expresa, no se muestra el texto provisional ni se agregan imágenes.

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción / PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-INICIO-01 | Público · `/inicio/` · tarjetas Cliente y Tatuador | Captura con anotaciones facilitada en la conversación | Copia ampliada `238:2335` (captura facilitada) | Con desvíos: las figuras de color se reemplazaron por zonas neutras; no se reproduce el estado seleccionado porque `/inicio/` navega directamente | Simulado: ambos enlaces navegan en preview segura | `local-safe` en `http://localhost:4647/preview/preview-local-safe/inicio/`: ambas zonas sin figuras ni texto, Cliente → `/marketplace/`, Tatuador → `/artist/login/`; inspección a 800 CSS px sin desborde horizontal | Corrección en `valentina/inicio-placeholders`; revisión pendiente |

La preview usa datos ficticios y no prueba autenticación ni persistencia real. El icono de imagen era opcional y se omitió porque la preview bloquea la carga externa de iconos. La composición desktop de dos columnas y el breakpoint móvil se conservaron sin modificar.
