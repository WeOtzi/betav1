# Registro de fidelidad Figma

Fecha de comparación: 13 de agosto de 2026.

La fuente visual aceptada es el archivo Figma `oRrqTTEZIQm6SCgRn9QUz8`, página `3981:5804` (`✨ Prototype`). La comparación principal se hizo sobre capturas móviles de `393 × 852 px`, revisando estructura, copy, escala tipográfica, paleta, espaciado, recortes, navegación fija y estados funcionales. Una captura adicional de `1440 × 1000 px` verifica el shell centrado en escritorio. No se aplicó una métrica automática de diferencia por píxel.

## Referencias comparadas

| Superficie | Figma | Render local |
|---|---|---|
| Landing | [nodo 3981:6881](references/figma/landing-3981-6881.png) | [captura](references/rendered/landing-mobile.png) |
| Onboarding, slide 1 | [nodo 3981:7644](references/figma/onboarding-3981-7644.png) | [captura](references/rendered/onboarding-mobile.png) |
| Inspiración | [nodo 3981:5862](references/figma/inspiration-3981-5862.png) | [captura](references/rendered/inspiration-mobile.png) |
| Negocio | [nodo 3981:5841](references/figma/business-home-3981-5841.png) | [captura](references/rendered/business-mobile.png) |
| Perfil público | [nodo 3981:7153](references/figma/public-profile-3981-7153.png) | [captura](references/rendered/profile-mobile.png) |
| Reserva personalizada | [nodo 3981:8159](references/figma/custom-booking-3981-8159.png) | [datos iniciales](references/rendered/booking-custom-mobile.png) · [referencia seleccionada](references/rendered/booking-reference-mobile.jpg) |
| Reserva Flash | [nodo 3981:7844](references/figma/flash-booking-3981-7844.png) | Sin captura final separada; comparte el shell de reserva validado en la variante personalizada. |
| Éxito y chat | No hay frame equivalente en el conjunto guardado. | [éxito](references/rendered/booking-success-mobile.png) · [chat](references/rendered/chat-mobile.png) |
| Shell de escritorio | La especificación pide una superficie móvil centrada. | [captura 1440 × 1000](references/rendered/desktop-shell.png) |

## Ledger de fidelidad

| Punto | Referencia y decisión | Resultado o corrección observable | Diferencia conocida |
|---|---|---|---|
| Viewport | Composición base `393 × 852 px`; en escritorio se centra una superficie de ese tamaño y en móvil ocupa el viewport. | Las `7` capturas Figma y las `9` capturas móviles renderizadas miden exactamente `393 × 852`; una décima captura renderizada, de `1440 × 1000`, confirma el shell centrado. No se observan controles primarios cortados ni desborde horizontal. | A menos de `481 px` se elimina deliberadamente el marco de dispositivo para usar la pantalla real. |
| Copy visible | Se preservaron títulos, etiquetas, CTA y pestañas de Landing, Inspiración, Negocio, Perfil y reservas. | La comparación final muestra el mismo encabezado de landing, saludo, nombres de secciones, cuatro pestañas y CTA principal. | Los nombres, horarios y previews de Negocio cambian cuando existen reservas/conversaciones SQLite; es estado funcional, no copy estático. Los slides 2–3 se infirieron, como se detalla abajo. |
| Tipografía | Figma usa SF Pro. La pila implementada es `SF Pro Display` → `SF Pro Text` → `Inter Variable` → sistema, con Inter incluido localmente. | Se corrigieron pesos, escalas y alturas de línea visibles: hero `48/54`, títulos grandes `24/30`, marca `20/35`, headings/CTA `17/23` y cuerpo `15/21`. | En equipos sin SF Pro se renderiza Inter; puede variar el kerning o un salto de línea respecto de Figma aunque las métricas estén alineadas. |
| Colores y profundidad | Tokens principales: `#111112`, `#292d32`, `#72757a`, `#a7a7a7`, `#e8e8e9`, `#f9f9f9`, `#fff`, `#f1f4f4`, `#42be65`, `#f2ebdf` y `#e1f2f4`. | Las capturas reproducen fondo blanco, tinta oscura, grises, tarjeta cálida de ganancias, avatares fríos y disponibilidad verde. Se eliminaron sombras decorativas; la profundidad proviene de fades, gradientes y blur. | La mezcla producida por `backdrop-filter` puede variar levemente entre motores de navegador. |
| Espaciado y geometría | Gutter principal `24 px`, contenido `345 px`, gap de galería `12 px`, inputs/cards `6 px`, CTA/selecciones `12 px`, chip `29 px`, footer de wizard `88 px`. | Landing recupera el ritmo entre marca, hero, formulario y tarjetas; perfil alinea avatar, tabs, galería y CTA; la reserva conserva campos con ritmo de `32 px` y selector binario. | A `≤360 px` el gutter baja a `18 px` para mantener usabilidad; esa adaptación no pertenece al frame de `393 px`. |
| Estado inicial del selector binario | En los frames de reserva, “Sí” y “No” parten visualmente neutrales bajo “¿Es tu primer tatuaje?”. | Se eliminó la selección afirmativa implícita: ambos botones comienzan neutrales y “Siguiente” permanece deshabilitado hasta que la persona elige una respuesta; recién entonces se persiste el booleano correspondiente. | Sin diferencia conocida en este estado; una prueba específica protege la neutralidad y la elección explícita. |
| Assets y recortes | Los archivos se descargaron del Figma aceptado, se guardaron en `public/assets/figma` y tienen trazabilidad en `SOURCES.md`; no hay hotlinks. | El onboarding usa un recorte posicionado, no un `object-fit` centrado genérico. Landing, inspiración y perfil muestran los encuadres y gradientes inferiores observables en las referencias. | El navegador puede aplicar interpolación de imagen distinta a la exportación estática al escalar. |
| Masonry | Inspiración y Trabajos conservan dos columnas desiguales de aproximadamente `167 px`, separadas por `12 px`, con alturas individuales y captions sobre gradiente. | La secuencia visual Woman/Snake/Flowers y Bird/Inspiration/Little Kid coincide en la captura; el perfil conserva Pirate/Little Kid frente a Foto Polaroid/Pantera Negra. | Es una cuadrícula en dos columnas explícitas, no un algoritmo de masonry que reordene contenido dinámico. |
| Navegación y CTA fijas | Inspiración/Negocio usan navegación inferior de `72 px`; Perfil mantiene fade y CTA; las reservas mantienen footer de progreso. | Las capturas finales dejan la navegación y el CTA visibles mientras el contenido continúa debajo, sin recortar la galería. El estado activo cambia entre Inicio y Negocio. | La barra inferior suma el safe area del dispositivo cuando existe. |
| Cabecera compacta | En Inspiración, el saludo comienza con avatar de `67 px`; tras scroll se oculta y la galería sube `91 px`. | Se implementó el cambio a partir de `scrollTop > 54` con transición de `300 ms`; la cabecera de marca y mensajes permanece accesible. | El frame guardado documenta el estado expandido; el compacto se verificó por comportamiento, no contra una segunda captura Figma guardada. |
| Motion y reducción de movimiento | La implementación usa ruta `280 ms`, onboarding `420 ms`, cabecera `300 ms`, tarjetas `180 ms` con hover `-2 px`/press `0.985` y éxito `700 ms`; easing principal `(0.22, 1, 0.36, 1)`. | Hay transiciones direccionales, feedback de press, compactación y reveal de éxito. `prefers-reduced-motion` reduce o elimina animaciones. | **No son valores extraídos de Figma.** La cuota Starter agotó las llamadas antes de recuperar triggers, duraciones, easing, springs y secuencias originales. Por eso la diferencia numérica exacta Figma-versus-render no puede determinarse todavía; queda bloqueada hasta renovar cuota o usar un plan superior. |
| Estados funcionales | Figma aporta estados visuales; el prototipo añade favoritos, reservas y mensajes persistidos. | Negocio refleja solicitudes reales y chat conserva mensajes tras refrescar. La nueva captura de reserva hace visible cuál referencia está seleccionada y coincide con el estado accesible `aria-pressed`; Negocio y chat muestran el estado vivo persistido. | El contenido puede no coincidir fila por fila con un frame estático después de usar la demo. |

## Correcciones visibles consolidadas

- Landing: se recuperaron el mock de Safari/status, la escala del hero, el formulario y las tarjetas horizontales de `283 × 275 px`; el contenido inferior sigue siendo desplazable.
- Onboarding: se usó el asset exportado con recorte posicionado y gradiente inferior; el slide 1 conserva marca, texto, dots y CTA en la zona baja.
- Inspiración: se restauraron avatar, saludo, orden de imágenes, alturas desiguales, captions con gradiente y navegación fija.
- Perfil: se alinearon avatar de `100 px`, chip de disponibilidad, cuatro pestañas, crops de trabajos, fade inferior y CTA fija.
- Negocio: se conservaron la tarjeta oscura, ganancias, agenda horizontal, inbox y navegación; las filas visibles provienen del estado SQLite actual.
- Reservas: las variantes Flash y personalizada comparten encabezado, gutters, ritmo de formulario, selector binario y controles circulares de tres pasos. “Sí” y “No” ahora parten neutrales y exigen una elección explícita, como en la referencia; la captura de referencias confirma además el borde, el copy “Referencia elegida” y la selección única mostrada.

## Límites de la comparación

Los slides 2 y 3 del onboarding y sus transiciones se construyeron como una continuación coherente del slide 1, pero no se obtuvieron frames o metadatos específicos con los que afirmar fidelidad exacta. Del mismo modo, éxito y chat tienen capturas renderizadas y cobertura funcional, pero no un frame Figma equivalente dentro del conjunto guardado.
