# Valentina: trabajar y publicar en la misma rama

Desde el 27 de octubre de 2026 la rama de trabajo es **`valentina/rediseno-laura`** en [WeOtzi/betav1](https://github.com/WeOtzi/betav1/tree/valentina/rediseno-laura). Se creó desde main, commit `65de880b2544e65767643f93f6d41484bb26d5a2`. Usa tu cuenta `valen-rozes`, tu Windows Dev y tu copia `C:\WeOtzi-Dev\weotzi-unified`.

## Al empezar

```powershell
cd C:\WeOtzi-Dev\weotzi-unified
git status --short
git branch --show-current
git fetch origin
git pull --ff-only
npm run dev:safe
```

La rama debe ser `valentina/rediseno-laura`. Si es otra, conserva el trabajo pendiente y cambia a la permanente antes de editar; no crees otra rama. No apliques automáticamente stashes o cambios de las ramas anteriores. No uses reset, clean ni force push. El lanzador de onboarding verifica esta rama y avisa si se cambió por accidente.

La prueba local es http://localhost:4647/preview/preview-local-safe/inicio/ . Los archivos se ven al refrescar; no necesitas publicarlos para probarlos en local. Usa OpenCode con tu cuenta; Codex es opcional. No copies sesiones, .env ni credenciales de Isaí.

## Publicar cambios y verlos en el dominio

1. Revisa el flujo y sus estados en navegador, incluido móvil. Sigue el Figma de Laura y el Design System. Mantén datos, permisos, navegación y texto.
2. Prepara una versión única: en esta rama se usa `2.2.3-valentina.rediseno-laura.N`, incrementando N en cada entrega. Si cambia la versión base, calcula el siguiente patch desde la versión vigente. Ejecuta `npm run version:delivery -- <version> "Descripción concreta"` y completa `docs/CHANGELOG.md`.
3. Ejecuta `npm test` y `npm run check:release`. Revisa `git diff` y agrega solo los archivos de esa entrega con `git add <archivos>`.
4. Crea el commit con problema, cambio, validación y rollback, incluyendo las líneas `Version:` y `Validación:`. Revisa `git diff --cached` antes de confirmarlo.
5. Publica siempre en el mismo destino:

```powershell
git push origin valentina/rediseno-laura
```

6. En [GitHub Actions](https://github.com/WeOtzi/betav1/actions), espera a que **Verify delivery** termine aprobado para tu commit. El controlador del servidor lo publica después; la actualización no es instantánea. Si falla CI, la preview conserva la última entrega aprobada.
7. Abre [preview.weotzi.chat/inicio/](https://preview.weotzi.chat/inicio/) y refresca. Todas las páginas mantienen sus rutas, por ejemplo `/artist/login/` y `/marketplace/`, sin crear subcarpetas por entrega. Compara `git rev-parse HEAD` con el campo `commit` de [api/release](https://preview.weotzi.chat/api/release) antes de dar una entrega por publicada.
8. Abre o actualiza el PR de `valentina/rediseno-laura` a `main`, con alcance, capturas y pruebas. Isaí revisa y mezcla; tú continúas trabajando en esta misma rama. Los cambios nuevos de main se integran de forma revisada, sin sobreescribir el rediseño.

## Barra flotante y datos

La barra de datos ficticios flota sobre la página: no agrega altura ni desplaza el diseño. **Ocultar datos ficticios** la contrae; **Mostrar datos ficticios** la vuelve a abrir. La preferencia se conserva durante la navegación del mismo commit. Puedes entrar como artista o cliente de prueba y reiniciar los ejemplos.

Los iconos Feather 4.29.2 se sirven localmente en preview para mantener los mismos SVG que beta. La preview sigue sin conectar cuentas reales, emails, cobros o bases compartidas. Las acciones no simuladas se identifican explícitamente.

## Trabajo anterior conservado

El 27/10 se guardaron los cambios pendientes del clon en el stash `respaldo-antes-rama-permanente-valen-20261027`, sobre `valentina/inventario-flujos` (objeto `fbeb797764513ea9c039c096f7e7cb7f7a4d90d7`). Incluye Inicio, sus assets, auditoría y ajustes de onboarding. Las ramas y worktrees anteriores siguen conservados. Consulta `git stash list` y `git stash show --stat <stash>` para revisarlos. Recupera cambios concretos con revisión; no hagas `stash pop` a ciegas sobre la rama permanente.

## Recuperación

Una entrega de código se revierte con `git revert <commit>` y una nueva entrega versionada, pasando CI. Isaí administra el rollback del gateway y de las releases; Valentina no necesita SSH. Revertir código no revierte bases de datos.
