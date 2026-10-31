# Área cuenta · Centro de la cuenta del artista (`/artist/account`)

Figma final "We Otzi Pantallas final" (oct 2026). 11 frames implementados en una sola página con ruteo por hash. Capturas finales en `output/figma-final-artista/shots/cuenta/<nodo>.png`, retomadas después de la **ronda 2 de auditoría** (801:569 y 801:573).

## Qué quedó

| Frame | Sección | Resultado | Fidelidad |
| --- | --- | --- | --- |
| 801:565 | Mi perfil y redes (`#perfil`) | Rediseñada | Alta |
| 801:566 | Gestionar portafolio (`#portafolio`) | Rediseñada | Alta |
| 801:568 | We Ötzi Wallet (`#cobros`) | Creada | Alta |
| 801:570 | We Ötzi Card · aviso (`?modal=card#cobros`) | Estado nuevo | Alta |
| 801:569 | Agregar destino de retiro (`?modal=agregar-destino#cobros`) | Estado nuevo | Alta |
| 801:571 | Disponibilidad por ubicación (`#disponibilidad`) | Rediseñada | Alta |
| 801:1110 | Confirmación de cambios (`?vista=editar` / `?vista=guardado`) | Estado nuevo | Alta |
| 801:572 | Notificaciones (`#notificaciones`) | Rediseñada | Exacta |
| 801:575 | Seguridad y recuperación (`#seguridad`) | Rediseñada | Alta |
| 801:573 | Verificación y documentos (`#verificacion`) | Rediseñada | Alta |
| 801:574 | Configuración y accesibilidad (`#configuracion`) | Rediseñada | Alta |

- **Sidebar**: 8 secciones con nombres, orden e íconos del Figma; se quitó **Integraciones**. Ítem activo con el azul claro del Figma (#EEF3FF). En Cobros aparece la nota "Facturación e impuestos → Ver datos fiscales".
- **Mi perfil**: termina en Sitio web + GUARDAR CAMBIOS como el frame. "Oficio y tarifa" (estilos, experiencia, tarifa, WhatsApp) quedó **plegado debajo del botón** con su propio guardado: es la única edición de esos datos tras retirar `/artist/profile/details` y no tiene diseño (desvío pendiente de aprobación). Banner de 254px y dropzones con el gris neutro del Figma.
- **Portafolio**: en reposo coincide con el Figma; las herramientas de cada trabajo aparecen al pasar el mouse o con foco (siempre en táctiles).
- **Wallet**: saldo + 4 estados en un bloque de 1082px 50/50, próximas liberaciones, actividad con filtros, retiro rápido que sigue al destino predeterminado, fondos bloqueados, destinos (alta, edición, detalle, eliminar, predeterminar), We Ötzi Card y datos fiscales. El modal de destinos rechaza **números de tarjeta** (12–19 dígitos con Luhn, con cualquier separador que no sea letra: espacios, guiones, puntos, guiones bajos) en el modelo y en el repositorio, y renombra el destino si cambia el método.
- **Disponibilidad**: pestañas por ubicación con flechas y desvanecido si no entran, edición con validación, pausar/reactivar, banner que nombra la ubicación **editada**, `?vista=guardado` que espera a las ubicaciones, y a 390px inicio — fin en una línea.
- **Seguridad**: MFA como switch, dispositivos conectados con "Cerrar todas las demás sesiones" y Recuperación (teléfono por OTP y pregunta de seguridad). Se quitó el "Cerrar sesión" por dispositivo que dibuja el Figma porque en realidad cerraba todas.
- **Verificación**: en reposo solo el badge, como el Figma, también cuando las acciones están deshabilitadas (documentos sin backend); Reemplazar/Subir/Eliminar en hover o foco (atenuadas si están deshabilitadas).
- **Configuración**: filas de accesibilidad de 56px, ritmo vertical del frame y las preferencias seguidas ya no se pierden (cola de escrituras en `Prefs.saveSection`).
- **Página**: se quitó el margen de 8px del body (topbar y footer no llegaban al borde). Los diálogos abren con el foco en el título (sin anillo en la ×).

## Ronda 1 de auditoría
Corregidos los 2 P1 y 18 P2 de los archivos del área (el de pestañas, parcial). Quedan fuera:
- **Footer y topbar** (contadores, subrayado activo): son del área Dashboard.
- **Selector "Agenda" en edición** (Disponibilidad): no está en el Figma; lo pidió el orquestador por la migración 20261028160000. Falta aprobación de diseño.
- **Subtítulo de Recuperación**: se mantiene "Configurá cómo recuperar el acceso a tu cuenta." en lugar del texto heredado de Privacidad; falta confirmarlo con diseño.
- **Contraseña, 2FA, SMS y abrir documentos** fallan en el preview porque `scripts/release/preview-bootstrap.js` no los simula: verificar en staging.
- **CHECK anti-tarjeta en la base**: la migración `20261028150000_artist_wallet.sql` no se tocó; decide el orquestador.

## Ronda 2 de auditoría
Corregidos los 2 P1, ambos dentro del área:
- **801:569 · PAN con puntos**: `4111.1111.1111.1111` (y `_`, `/`, dígitos de ancho completo) se guardaba como destino en texto plano. `looksLikeCardNumber` (`wallet-model.js`) y `looksLikeRawPan`/`looksLikeCardNumber` (`account-repo.js`) ahora toman como separador todo lo que no sea letra antes de Luhn. Verificado por CDP en Chrome headless limpio: error visible, la lista sigue en 3 destinos, y un alias con puntos se sigue guardando. Evidencia: `shots/cuenta/801-569-pan-con-puntos.png`. Si se suma un CHECK en la base, tiene que quitar todo lo que no sea dígito, no solo espacios y guiones.
- **801:573 · acciones deshabilitadas visibles**: `.aac-doc-action:disabled` fijaba opacidad 0.4 en reposo y le ganaba a `opacity:0`. Ahora en reposo quedan en 0 y se atenúan (0.4, `not-allowed`) solo al pasar el mouse por la fila o en táctiles. Medido por CDP. Evidencia: `shots/cuenta/801-573-acciones-deshabilitadas.png`.

## Quitado de la página
Integraciones; bloque Privacidad; ingresos del mes / próximo pago / métodos de pago tokenizados (reemplazados por el Wallet); notas al pie; Apple Calendar y el horario semanal único. En la ronda 1: "Oficio y tarifa" sale del formulario (plegado), el "Cerrar sesión" por dispositivo y los extras del modal de destinos ("Elegido", ayuda visible, chevrons).

## Rutas
Las rutas propuestas (`/artist/profile/details`, `/artist/profile/gallery`) ya fueron retiradas por el orquestador (`lib/legacy-routes.js`). El área no tiene links a rutas retiradas.

## Backend (no aplicado)
`supabase/migrations/20261028150000_artist_wallet.sql` + rollback: destinos de retiro (trigger que impide auto-verificarse), movimientos (solo lectura para el artista), RPC de retiro `security definer` con lock y validación de saldo, RPC de destino predeterminado y lista de espera de la Card. RLS dueño + soporte, `anon` sin acceso.

## Lo que necesita un proveedor o una decisión
Retiros efectivos, ingreso de fondos al Wallet, KYC y verificación de destinos (y cifrar o tokenizar `account_identifier`), disputas, emisión de la Card, OAuth de Google Calendar, SMS para verificar el teléfono, que `/recover` use la pregunta de seguridad, revocar una sesión puntual (endpoint/RPC con service role) y un diseño para "Oficio y tarifa".

## Copy corregido
"or browse files" → "o buscá archivos". En Recuperación, "Controlá qué información es pública en tu perfil." (texto heredado de Privacidad) → "Configurá cómo recuperar el acceso a tu cuenta."

## Estados por URL (QA)
`?modal=agregar-destino|card|datos-fiscales#cobros` · `?vista=editar|guardado#disponibilidad` · `?modal=travel#disponibilidad` · `?modal=telefono|pregunta#seguridad` · `?vista=oficio#perfil`.

## Tests
`tests/figma-final-cuenta.test.js`: 16 tests (4 de la ronda 1; 3 nuevos de la ronda 2: PAN con separadores en el modelo y en el repo, y acciones de documentos deshabilitadas ocultas en reposo). `account-center-runtime.test.js` sigue en verde. Suite completa: 601 de 605 pasan. Las únicas fallas son las 3 preexistentes de PowerShell 7.

## Para tener en cuenta
- Las fixtures suman ubicaciones a `artist_tattoo_locations` con un setter encadenado con el de perfil-estadisticas. El store del preview se comparte entre pestañas por localStorage: si Disponibilidad muestra solo la base, usá "Reiniciar datos".
- `artist_payment_methods` deja de usarse en esta página. El repo se mantiene.
- Instagram ahora se guarda sin "@".
