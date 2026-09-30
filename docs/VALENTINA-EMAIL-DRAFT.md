# Borrador de correo para Valentina

**Para:** Valentina — dirección pendiente de confirmar.

**Asunto:** We Ötzi — entorno de trabajo y primera tarea de rediseño

Hola Valentina,

Preparé el código y las guías de We Ötzi para que puedas trabajar con IA y revisar tus cambios en una web de prueba antes de integrarlos a la beta. Ya existe la cuenta Windows estándar **Dev**. Antes de que empieces a desarrollar y publicar, falta aplicar y comprobar su aislamiento y clon, activar y verificar la protección de `main` en GitHub y después habilitar tu acceso personal. Dejé scripts para completar esa preparación manualmente. Necesito tu correo y nombre de usuario GitHub para asignarte los accesos. Mientras tanto, puedes recorrer la preview ya publicada y preparar el inventario.

Vas a usar el usuario Windows **Dev** en este PC y tus propias cuentas de ChatGPT/Codex, GitHub y Figma. La carpeta prevista de trabajo es `C:\WeOtzi-Dev\weotzi-unified` y el repositorio es [WeOtzi/betav1](https://github.com/WeOtzi/betav1). Cuando te confirme que tu clon está listo y el aislamiento está comprobado, abre esa carpeta en Codex y pídele al agente que lea `AGENTS.md` y el handoff. Para arrancar el entorno seguro: `npm.cmd ci --ignore-scripts`, luego `npm.cmd run dev:safe`, y abre http://localhost:4647. El clon independiente trae el código público; no contiene mis archivos de configuración ni credenciales.

Tu guía principal es [HANDOFF-VALENTINA.md](https://github.com/WeOtzi/betav1/blob/main/docs/HANDOFF-VALENTINA.md). Incluye qué hace el producto, su stack, estructura, entorno, cómo conversar con la IA, cómo probar y cómo entregar. La [primera tarea](https://github.com/WeOtzi/betav1/blob/main/docs/VALENTINA-FIRST-TASK.md) incluye los recorridos y nodos Figma para comenzar el inventario.

Ya puedes recorrer esta [preview de prueba](https://preview.weotzi.chat/preview/preview-valentina-prueba-entorno-f6aefa2d/inicio/). Tiene un artista con perfil, tres trabajos y agenda, y el modo cliente con cotizaciones y actividad. La barra amarilla identifica los datos ficticios. Usa **Modo cliente / Modo tatuador** para cambiar de experiencia con la misma cuenta. La guía explica también cómo salir y probar los formularios de acceso. El 30/09 se comprobó la publicación automática de **2.1.1**, commit `ee702262fb765744b1df5dc1f42b68eb1da9c5ef`, con [CI de main aprobado](https://github.com/WeOtzi/betav1/actions/runs/36687126630) y [CI de preview aprobado](https://github.com/WeOtzi/betav1/actions/runs/36687128430); consulta la versión visible antes de cada recorrido porque las próximas entregas pueden cambiarla.

Cuando los accesos y la protección estén comprobados, vas a trabajar en ramas `valentina/<tarea>`. Al hacer commit y push, GitHub Actions ejecuta **Verify delivery** y el servidor publica el commit aprobado. Ese recorrido ya se probó con la rama de la preview anterior. Comprueba [Actions](https://github.com/WeOtzi/betav1/actions) y copia el enlace de tu rama desde el [índice de previews](https://preview.weotzi.chat). Después abre un PR a `main`; yo reviso e integro. El servidor publica la beta principal https://beta.weotzi.com tras aprobarse el commit de `main`. No necesitas SSH ni contraseña del servidor. Falta activar la [protección de `main`](https://github.com/WeOtzi/betav1/blob/main/docs/MAIN-PROTECTION.md): no habilitaremos tu primer push ni tu permiso de escritura hasta verificar las reglas efectivas. Mi revisión manual por sí sola no reemplaza ese bloqueo.

Antes del primer push, tu agente debe comprobar que GitHub usa tu identidad y que puedes publicar en el repositorio, después de que Isaí haya confirmado el aislamiento Windows/Codex y la protección efectiva de `main`. El acceso CLI guardado actualmente solo tiene lectura; la primera integración se publicó con el conector autorizado del propietario. No reutilices sus credenciales. Si falta alguno de los preparativos, conserva tus cambios locales y avísame.

Tu primera tarea es comparar cada pantalla y estado de artista y cliente con estos archivos:

- [Auditoría realizada por Laura](https://www.figma.com/design/YyppETJDvHCC98scjrZnlO/Auditoria-Rediseno-We-Otzi?node-id=0-1): inventario del funcionamiento actual.
- [Rediseño original](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=0-1): referencia de las pantallas y estados de ambos roles.
- [Sistema de diseño](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi?node-id=11-782): componentes, tipografía, colores y reglas visuales.

Empieza creando un inventario: URL, rol, estado, nodo Figma, diferencia visual y resultado funcional. Luego toma un flujo pequeño, comparte sus nodos con la IA, aplica el rediseño pendiente y compruébalo en desktop y móvil. Conserva la lógica y los datos existentes. Si una acción falla, reprodúcela, arréglala dentro de la tarea cuando sea posible y vuelve a probar; si está bloqueada, registra pasos y evidencia para que Isaí pueda resolverla.

Local y las previews usan datos ficticios y no envían emails ni operan sobre usuarios reales. La prueba de guardar datos, recibir correos o usar integraciones reales necesita las cuentas y el entorno que te indique Isaí. En el reporte distingue “simulado”, “probado”, “falla” y “bloqueado”. No compartas contraseñas, tokens o información privada en capturas o commits.

Cada entrega debe tener changelog y versión actualizados, commit que explique problema/cambio/pruebas/rollback y un PR con Figma, capturas, preview y pendientes. La guía explica cómo volver atrás mediante un revert; Isaí dispone también del rollback del servidor.

Para comenzar, confirma que puedes entrar con tu usuario Windows y que las pruebas de aislamiento también pasan desde tu Codex; comprueba el acceso a los tres Figma con tu cuenta. Una vez que Isaí confirme la protección efectiva de `main` y te otorgue escritura, publica una rama `valentina/*` y verifica su preview. Tu primer resultado debería ser el inventario inicial y un PR pequeño completamente revisado.

Gracias,
Isaí

---

**Nota de preparación:** este texto es un borrador; no está enviado. GitHub/CI, publicación automática de beta, preview y rollback real están comprobados. Dev ya existe como cuenta estándar; quedan aplicar y probar su aislamiento y clon, confirmar correo/usuario GitHub de Valentina y activar/verificar la protección de `main` antes de asignarle escritura. Las guías [Windows](DEV-WINDOWS-SETUP.md) y [GitHub](DEV-GITHUB-SETUP.md) incluyen los scripts manuales con respaldo y reversión. Las pruebas de aislamiento con su token Windows y con las herramientas de su Codex siguen pendientes. No se entregan credenciales del propietario.
