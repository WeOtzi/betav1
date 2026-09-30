# Borrador de correo para Valentina

**Para:** Valentina — dirección pendiente de confirmar.

**Asunto:** We Ötzi — entorno de trabajo y primera tarea de rediseño

Hola Valentina,

Te dejamos preparado el proyecto We Ötzi para que puedas trabajar con IA y revisar tus cambios en una web de prueba antes de integrarlos a la beta.

Vas a usar tu propio usuario Windows en este PC, tu cuenta de ChatGPT/Codex, GitHub y Figma. Tu carpeta de trabajo es `C:\WeOtzi-Valentina\weotzi-unified` y el repositorio es [WeOtzi/betav1](https://github.com/WeOtzi/betav1). Al iniciar, abre esa carpeta en Codex y pídele al agente que lea `AGENTS.md` y el handoff. Para arrancar el entorno seguro: `npm ci`, luego `npm run dev:safe`, y abre http://localhost:4647.

Tu guía principal es [HANDOFF-VALENTINA.md](https://github.com/WeOtzi/betav1/blob/main/docs/HANDOFF-VALENTINA.md). Incluye qué hace el producto, su stack, estructura, entorno, cómo conversar con la IA, cómo probar y cómo entregar. La [primera tarea](https://github.com/WeOtzi/betav1/blob/main/docs/VALENTINA-FIRST-TASK.md) incluye los recorridos y nodos Figma para comenzar el inventario.

Vas a trabajar en ramas `valentina/<tarea>`. Al hacer commit y push, GitHub Actions ejecuta **Verify delivery**. Cuando pasa, el controlador del servidor descarga ese commit y publica la preview. Comprueba el resultado en [Actions](https://github.com/WeOtzi/betav1/actions) y busca tu rama en el índice https://preview.weotzi.com para copiar su enlace. El dominio debe estar habilitado por Isaí; si sigue pendiente, trabaja con `npm run dev:safe` y anótalo en el reporte. Después abre un PR a `main`; Isaí revisa e integra. Al integrarse y pasar CI, el servidor publica la beta principal: https://beta.weotzi.com. No necesitas acceso SSH ni contraseña del servidor.

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

**Nota de preparación:** este texto es un borrador; no está enviado. La dirección de correo y el usuario GitHub de Valentina deben confirmarse para asignar los accesos personales. CI se comprueba en GitHub Actions, y la publicación en el índice de previews y su commit/versión; no se entrega una contraseña SSH.
