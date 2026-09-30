# Proteger main antes de incorporar una colaboradora

Estado verificado el 30/09/2026: `main` no está protegida y no hay rulesets. CI y CODEOWNERS están publicados, pero por sí solos no impiden un push directo. El conector GitHub permite publicar código, pero no administrar reglas de protección. No otorgar todavía acceso de escritura a Valentina hasta aplicar y comprobar esta regla.

Isaí debe abrir https://github.com/WeOtzi/betav1/settings/branches con su cuenta propietaria y crear una regla para el patrón `main`:

- Require a pull request before merging: activado; una aprobación.
- Dismiss stale pull request approvals when new commits are pushed: activado.
- Require review from Code Owners: activado. CODEOWNERS identifica a @WeOtzi.
- Require status checks to pass before merging: activado; seleccionar `Tests and release policy` y exigir que la rama esté actualizada.
- Require conversation resolution before merging: activado.
- Do not allow bypassing the above settings: activado.
- Allow force pushes y Allow deletions: desactivados.
- Restrict who can push to matching branches: si el repositorio permite esta opción, sólo la cuenta administradora; el trabajo junior debe llegar por PR.

Guardar la regla, comprobar que `main` aparece como protegida y hacer una entrega posterior por PR con revisión y CI. Las ramas `valentina/*` siguen permitiendo push y publicaciones de preview.

Para facilitar la acción del propietario, están preparados [scripts manuales de inspección, aplicación y reversión](DEV-GITHUB-SETUP.md). Primero verifican una sesión GitHub con administración, respaldan el estado, aplican y comprueban la protección; solo después gestionan las invitaciones de escritura. Preparar esos archivos no aplica los permisos. La cuenta CLI `isai-weotzi` sigue teniendo lectura y debe aceptar su invitación si el propietario la crea.

La configuración administrativa la ejecuta Isaí: no existe un endpoint de escritura de protección en el conector disponible, y Computer Use prohíbe cambiar opciones de seguridad dentro de aplicaciones. La guía explica el login personal y los comandos que debe ejecutar el propietario; no requiere otra contraseña SSH.
