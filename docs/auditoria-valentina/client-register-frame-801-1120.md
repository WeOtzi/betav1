# Pantalla 4 · Registro de clientes · 801:1120

- Referencia: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1120
- Ruta: `/client/register/`, únicamente el primer paso «Creá tu cuenta».
- Versión: `2.2.3-valentina.rediseno-laura.9`, rama `valentina/rediseno-laura`.
- Comparación: `get_design_context` con captura y medidas del nodo exacto. Biblioteca CSS existente y búsqueda del sistema de diseño consultadas; sin modificar tokens globales.

| Estado | Visual | Funcional | Evidencia / corrección |
| --- | --- | --- | --- |
| Inicial vacío | Ajustado a referencia, excepto placeholders pedidos y controles flotantes del entorno | Probado | CONTINUAR antes quedaba a la izquierda; ahora margen derecho de 32 px desktop / 16 px móvil, altura 44 px. |
| Campos y foto opcional | Ajustado a referencia | Navegación probada; subida real no probada | Formulario desktop de 916 px: foto/columna de 180 px, gap de 44 px, campos de 692 px. Título Archivo Black 44/46.2 px; Inter 16 px y JetBrains Mono 12 px para labels. Cuatro SVG originales descargados localmente. |
| Requeridos | Conservado | Probado | CONTINUAR vacío muestra «Contanos tu nombre.» y enfoca Nombre. |
| Avanzar / volver | Pasos posteriores sin rediseñar | Probado | Datos ficticios válidos llevan al paso 02, aparece Atrás y permite volver al paso 01. No se crea una cuenta en este recorrido. |
| Recarga del borrador | Conservado | Simulado local | Nombre persiste tras recargar; contraseña vuelve vacía, sin guardarse en el borrador. |

## Alcance visual

Se agrega una hoja exclusiva de esta ruta, condicionada al paso 01 visible para topbar, progreso, contenido y footer. Se conservan el controlador, los IDs, validaciones, repositorios, prefill y almacenamiento existentes. No se modifica ninguna otra pantalla ni la hoja compartida del wizard.

Los campos muestran sus placeholders originales, nunca los datos personales de ejemplo de Figma. El bloque alternativo Google/login no aparece en el frame y queda oculto visualmente en este paso, conservando su código. La carga opcional conserva el selector de archivos y usa el texto literal del frame. Los iconos de cierre y flecha reutilizan Feather; foto, email, usuario y candado usan los SVG del nodo.

El ojo PREVIEW y el soporte son controles del entorno que no pertenecen a Figma; se conservan. El soporte se desplaza hacia arriba solo en este paso para no tapar CONTINUAR.

## Comprobaciones

- Entorno identificado como «Datos ficticios · Sin emails ni backend real». Ya había servidor seguro en 4647; no se cerró el proceso existente.
- Browser: DOM, medidas, estado e interacción inspeccionados. Su captura falla con «Screenshot needs a visible tab», incluso tras enfocar el tab.
- Alternativa: Edge headless con perfil temporal aislado, protocolo CDP y capturas a 1440×857, 768×857 y 390×857. Sin instalar dependencias ni modificar perfiles personales.
- Aserción de alineación falló antes del ajuste; pasó después. En 1440 px, CONTINUAR termina en x=1408; altura 44 px. Sin overflow horizontal a los tres anchos. Se descuentan las barras de scroll cuando existen.
- Capturas y script de comprobación en `C:\Users\Dev\AppData\Local\Temp\opencode\register-*.png` y `register-qa.cjs`, fuera del commit. Se revisaron las capturas desktop y móvil.
- Fuentes cargadas; cuatro SVG locales no vacíos y con dimensiones del diseño. Recursos dinámicos de foto permanecen dinámicos.
- Warning conocido de soporte: `/api/support-chat/conversation` responde 501 en preview. No se cambió ese servicio.
- No se verifican altas reales, emails, OAuth, almacenamiento remoto de fotos ni persistencia Supabase. No se envían datos a servicios reales.

## Publicación y recuperación

La entrega automática ejecuta `npm test` y `npm run check:release`, hace commit/push de archivos explícitos y comprueba CI y la SHA de `https://preview.weotzi.chat/api/release`.

Preview: https://preview.weotzi.chat/client/register/

Rollback: revertir el commit de esta versión con una nueva entrega versionada en la misma rama. Sin migraciones ni cambios de datos. Isaí mantiene el control de integración a main y rollback operativo.
