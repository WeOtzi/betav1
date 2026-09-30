# Borrador de correo para Valentina

**Para:** Valentina — dirección pendiente de confirmar.

**Asunto:** We Ötzi — entorno de trabajo y primera tarea de rediseño

Hola Valentina,

Preparé el código y las guías de We Ötzi para que puedas trabajar con IA y revisar tus cambios en una web de prueba antes de integrarlos a la beta. Antes de que empieces, falta crear y comprobar tu usuario Windows y habilitar tu acceso GitHub. Necesito tu correo y nombre de usuario GitHub para asignarte los accesos personales.

Vas a usar tu propio usuario Windows en este PC, tu cuenta de ChatGPT/Codex, GitHub y Figma. La carpeta prevista de trabajo es `C:\WeOtzi-Valentina\weotzi-unified` y el repositorio es [WeOtzi/betav1](https://github.com/WeOtzi/betav1). Cuando te confirme que tu usuario y clon están listos, abre esa carpeta en Codex y pídele al agente que lea `AGENTS.md` y el handoff. Para arrancar el entorno seguro: `npm ci`, luego `npm run dev:safe`, y abre http://localhost:4647.

Tu guía principal es [HANDOFF-VALENTINA.md](https://github.com/WeOtzi/betav1/blob/main/docs/HANDOFF-VALENTINA.md). Incluye qué hace el producto, su stack, estructura, entorno, cómo conversar con la IA, cómo probar y cómo entregar. La [primera tarea](https://github.com/WeOtzi/betav1/blob/main/docs/VALENTINA-FIRST-TASK.md) incluye los recorridos y nodos Figma para comenzar el inventario.

Ya puedes recorrer esta [preview de prueba](https://preview.weotzi.chat/preview/preview-valentina-prueba-entorno-f6aefa2d/inicio/). Tiene un artista con perfil, tres trabajos y agenda, y el modo cliente con cotizaciones y actividad. La barra amarilla identifica los datos ficticios. Usa **Modo cliente / Modo tatuador** para cambiar de experiencia con la misma cuenta. La guía explica también cómo salir y probar los formularios de acceso.

Vas a trabajar en ramas `valentina/<tarea>`. Al hacer commit y push, GitHub Actions ejecuta **Verify delivery** y el servidor publica el commit aprobado. Ese recorrido ya se probó con la rama de la preview anterior. Comprueba [Actions](https://github.com/WeOtzi/betav1/actions) y copia el enlace de tu rama desde el [índice de previews](https://preview.weotzi.chat). Después abre un PR a `main`; yo reviso e integro. El servidor publica la beta principal https://beta.weotzi.com tras aprobarse el commit de `main`. No necesitas SSH ni contraseña del servidor. Falta activar la protección de `main`; mientras tanto, conserva la revisión y mi autorización antes de integrar, como explica [esta guía](https://github.com/WeOtzi/betav1/blob/main/docs/MAIN-PROTECTION.md).

Tu agente debe comprobar que GitHub usa tu identidad y que puedes publicar en el repositorio. El acceso CLI guardado actualmente solo tiene lectura; la primera integración se publicó con el conector autorizado del propietario. No reutilices sus credenciales. Si faltan permisos, conserva tus cambios locales y avísame.

Tu primera tarea es comparar cada pantalla y estado de artista y cliente con estos archivos:

- [Auditoría realizada por Laura](https://www.figma.com/design/YyppETJDvHCC98scjrZnlO/Auditoria-Rediseno-We-Otzi?node-id=0-1): inventario del funcionamiento actual.
- [Rediseño original](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=0-1): referencia de las pantallas y estados de ambos roles.
- [Sistema de diseño](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi?node-id=11-782): componentes, tipografía, colores y reglas visuales.

Empieza creando un inventario: URL, rol, estado, nodo Figma, diferencia visual y resultado funcional. Luego toma un flujo pequeño, comparte sus nodos con la IA, aplica el rediseño pendiente y compruébalo en desktop y móvil. Conserva la lógica y los datos existentes. Si una acción falla, reprodúcela, arréglala dentro de la tarea cuando sea posible y vuelve a probar; si está bloqueada, registra pasos y evidencia para que Isaí pueda resolverla.

Local y las previews usan datos ficticios y no envían emails ni operan sobre usuarios reales. La prueba de guardar datos, recibir correos o usar integraciones reales necesita las cuentas y el entorno que te indique Isaí. En el reporte distingue “simulado”, “probado”, “falla” y “bloqueado”. No compartas contraseñas, tokens o información privada en capturas o commits.

Cada entrega debe tener changelog y versión actualizados, commit que explique problema/cambio/pruebas/rollback y un PR con Figma, capturas, preview y pendientes. La guía explica cómo volver atrás mediante un revert; Isaí dispone también del rollback del servidor.

Para comenzar, confirma que puedes entrar con tu usuario Windows, abrir los tres Figma con tu cuenta, publicar una rama `valentina/*` y ver su preview. Tu primer resultado debería ser el inventario inicial y un PR pequeño completamente revisado.

Gracias,
Isaí

---

**Nota de preparación:** este texto es un borrador; no está enviado. GitHub/CI, publicación automática de beta, preview y rollback real están comprobados. Solo quedan crear y probar la cuenta Windows (UAC cancelado), confirmar correo/usuario GitHub de Valentina y asignarle escritura, y activar la protección de `main`. No se entregan credenciales del propietario.
