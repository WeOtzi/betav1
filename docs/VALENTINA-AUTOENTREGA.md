# Entrega automática de Valentina en OpenCode

## Autorización vigente de Isaí

Por solicitud expresa del propietario del 27/10/2026, al terminar cada tarea de implementación o corrección de Valen, completa automáticamente pruebas, versión/changelog, commit, push a `valentina/rediseno-laura`, CI y comprobación de la misma SHA en `https://preview.weotzi.chat/api/release`. No pidas otra aprobación para esos pasos rutinarios dentro de la tarea autorizada. Esta instrucción reemplaza las guías históricas que pedían esperar una orden adicional para publicar.

Una entrega corresponde a una tarea coherente y terminada, no a cada tecla o guardado. Las preguntas, auditorías de solo lectura y solicitudes explícitas de plan/borrador no generan commits. Si Valen pide no publicar una tarea, respeta esa instrucción. No declares éxito si faltan pruebas, CI o la SHA pública.

## Sesión y carpeta obligatorias

- La implementación cotidiana y la entrega se ejecutan desde **Windows Dev**, dentro de la sesión de escritorio remoto de Valen, con su GitHub `valen-rozes` y su propia cuenta de OpenCode.
- Abre `C:\WeOtzi-Dev\weotzi-unified`. La rama y su upstream deben ser `valentina/rediseno-laura` y `origin/valentina/rediseno-laura`.
- No abras el checkout de Isaí, no uses su perfil de OpenCode, no copies credenciales ni sesiones. No crees ramas, clones o worktrees para estas tareas. No hagas merge a `main`, no operes SSH ni cambies bases de datos compartidas.
- La configuración está en `opencode.json` de este proyecto; no cambia modelos, proveedores ni credenciales globales de ninguno de los usuarios Windows. El agente predeterminado es Build. Los comandos de entrega se permiten de forma específica; no hace falta activar un modo global de aprobar todo.

## Procedimiento obligatorio del agente

1. Empieza comprobando carpeta, rama, cambios pendientes y el alcance pedido. Conserva el trabajo previo. No agregues archivos de otras tareas a la entrega.
2. Implementa y prueba el flujo, incluidos los estados y el navegador cuando corresponda. Corrige los fallos reproducibles de esta tarea antes de publicar.
3. Calcula una versión única siguiendo `docs/VALENTINA-PUBLICAR.md`. Usa `npm run version:delivery -- <version> "Descripción"` y completa validación y recuperación en `docs/CHANGELOG.md`. No reutilices versiones.
4. Revisa el diff y los archivos exactos de esta tarea. Ejecuta la entrega con un único comando, sin concatenar otros comandos:

```powershell
node scripts/release/valentina-delivery.cjs publish --title "fix(inicio): corregir el espaciado de las tarjetas" --validation "Prueba visual del flujo en desktop y móvil completada." --files public/inicio/index.html package.json package-lock.json docs/CHANGELOG.md
```

La lista es un ejemplo: incluye los archivos reales de la tarea. `--files` va al final. No uses `git add .` ni incluyas todo el checkout por comodidad.

5. La herramienta comprueba sesión, cuenta, carpeta, rama, conflictos, versión única y staging. Ejecuta `npm test` y `npm run check:release`, comprueba que los archivos no cambiaron durante las pruebas y agrega únicamente la lista indicada. Repite la política para incluir archivos nuevos en la revisión de credenciales. Crea un commit con versión, evidencia y rollback, hace push solo a la rama permanente y espera CI del evento push de esa SHA y la misma versión/SHA pública. Usa la identidad `gh` verificada de Valen para ese push.
6. Si falla una prueba o cambia el trabajo durante la verificación, corrige/revisa y vuelve a probar. Si ya se hizo push pero sigue pendiente la publicación, usa `npm run valen:wait`: no crees otro commit solo para esperar. Si falla la cuenta, no uses otra persona: Valen debe vincular su GitHub desde Dev.
7. Si Git rechaza un push o la rama remota avanzó, conserva el commit y explica el rechazo. No uses force push, reset, un merge automático ni una rama alternativa. Resolver un conflicto requiere revisar el trabajo involucrado.
8. Al finalizar, informa qué cambió, pruebas realizadas, SHA, enlace de CI, URL de preview y comprobación de publicación. Actualiza el PR de la misma rama para revisión de Isaí cuando sea posible; no lo mezcles. Las pruebas simuladas se identifican como tales.

## Cómo lo comprueba Valen desde su escritorio remoto

1. Entra a su Windows **Dev**. Puede comprobarlo con `whoami`: debe terminar en `\dev`.
2. Cierra y vuelve a abrir el proyecto en su OpenCode y empieza una conversación nueva para cargar esta configuración. No hace falta cerrar la sesión de Isaí ni usar su OpenCode. Selecciona exactamente `C:\WeOtzi-Dev\weotzi-unified` y verifica que el modo sea **Build**.
3. Escribe **`/verificar-valen`**. El comando es de solo lectura y debe mostrar:
   - `session.user`: Dev; `github`: valen-rozes; `canPublishHere`: true.
   - `branch`: valentina/rediseno-laura; `upstream`: origin/valentina/rediseno-laura.
   - `localCommit`, `remoteCommit` y `publishedCommit` iguales.
   - `ciPassed`: true; `pendingChanges`: false; `synchronized`: true.
4. Pide un cambio normalmente. Al completarlo, OpenCode debe entregar pruebas, commit y confirmación de publicación sin necesitar otro mensaje de “haz commit y push”. Refresca la página modificada en preview y vuelve a ejecutar `/verificar-valen`.
5. Si una conversación antigua no completa la entrega, escribe **`/publicar-valen`**. Retoma la tarea y aplica este procedimiento, conservando los archivos de otras tareas. Este comando no publica un checkout completo a ciegas.

También puede comprobarlo desde la terminal de **su** OpenCode:

```powershell
cd C:\WeOtzi-Dev\weotzi-unified
npm run valen:verify
```

`npm run valen:status` da el diagnóstico incluso cuando hay cambios pendientes. `synchronized: false` durante una tarea significa que aún hay trabajo local o falta CI/publicación. Una discrepancia no se convierte automáticamente en éxito. La herramienta permite consultar el estado desde otra sesión, pero rechaza publicar desde el Windows de Isaí.

## Alcance y recuperación

Son instrucciones persistentes del agente y una herramienta de entrega, no un vigilante que haga commits al guardar archivos. Una solicitud expresamente incompleta o un fallo pendiente no debe publicarse como trabajo terminado. Una política administrada de la instalación o falta de autenticación puede bloquear la ejecución; en ese caso muestra la causa concreta y conserva el trabajo.

No se ha iniciado sesión como Dev ni usado su OpenCode desde la sesión de Isaí para simular una entrega personal. La carga efectiva y su autenticación se confirman con los pasos anteriores en la sesión RDP de Valen. Las pruebas automatizadas cubren la secuencia y rechazos sin usar cuentas ajenas.

Para desactivar esta política, Isaí puede revertir su commit mediante una entrega versionada o retirar la instrucción automática y los comandos del `opencode.json` de este proyecto, conservando las guardias de rama. No se eliminan commits anteriores ni datos de la aplicación. Beta sigue requiriendo revisión de Isaí.
