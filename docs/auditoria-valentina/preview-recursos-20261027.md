# Preview: auditoría de páginas y recursos (27/10/2026)

Se recorrieron las 51 páginas HTML versionadas en navegador, tanto en preview.weotzi.chat como en beta.weotzi.com, a 1280 px. La preview usa la sesión ficticia; beta se abrió sin iniciar sesión real. En 22 rutas beta redirige por autenticación: no se declara comparación visual completa de su contenido privado. Se verificaron recursos, tipografías, iconos e imágenes estáticas visibles; no todos los estados, modales ni acciones de cada flujo.

## Correcciones

- Font Awesome Free 6.4.0: CSS y ocho archivos de fuentes locales para las páginas de estudios y backoffice.
- Quill 1.3.7: JavaScript y CSS locales para Archivo. Flatpickr 4.6.13: CSS local para el cotizador. Conservan las versiones de las referencias originales; orígenes, SHA-256 y licencias están en scripts/release/preview-assets.json y preview-assets/NOTICE.md.
- El catálogo de componentes puede abrir sus marcos del mismo dominio. Los marcos externos y las APIs reales siguen bloqueados.
- Los archivos originales de spots ya coincidían en el servidor, pero el CDN de preview transformaba dos PNG de 2500x1663 a 1600x1064 y recomprimía otros dos. Se añadió Cache-Control: no-store, no-transform al gateway y al proxy público para conservar la respuesta original de beta.
- El control de preview queda cerrado como un ojo de 44x44 px. Se arrastra con puntero/ratón/tacto, también se mueve con las flechas. El clic abre/cierra y Escape cierra. La posición se guarda por origen y se conserva entre páginas, recargas y commits. Se ajusta al viewport; no ocupa espacio de layout y no se duplica dentro de los iframes del catálogo.

## Evidencia

- HTTP: 51/51 páginas responden; 171 recursos de HTML/CSS comprobados contra ambos dominios. Antes de corregir: 167 idénticos en bytes, dos con los mismos píxeles y dos PNG reducidos por el CDN. Se corrigió la transformación en la entrega HTTP: al repetir la revisión, los 171/171 recursos son idénticos en bytes a beta. Los manifiestos originales listan 314 archivos públicos en cada entorno, sin faltantes.
- Navegador: 51/51 recorridas, cero iconos Feather visibles sin SVG, cero iconos Font Awesome visibles sin glifo y cero imágenes estáticas visibles rotas en la revisión. La auditoría esperó la hidratación de iconos antes de contar.
- Ojo: arrastre de (16,660) a (1128,178), clic sin apertura accidental tras arrastrar, recarga y navegación, movimiento con flechas y cierre con Escape. A 390x844 el ojo y su panel permanecen dentro de la pantalla. Es emulación; no prueba un teléfono físico.
- Los JSON de evidencia HTTP y DOM y las capturas quedan en output/preview-audit-20261027 del checkout del propietario; no contienen sesiones ni credenciales.

## Matriz de páginas

| Página solicitada | Destino en preview | Destino en beta sin sesión | Iconos y recursos estáticos visibles |
| --- | --- | --- | --- |
| `/archive/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/artist/account/` | `/artist/login/` | `/artist/login/` | Sin faltantes detectados |
| `/artist/applications/` | `/artist/login/` | `/artist/login/` | Sin faltantes detectados |
| `/artist/dashboard/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/artist/inbox/` | `/login` | `/login` | Sin faltantes detectados |
| `/artist/invitations/` | `/artist/login/` | `/artist/login/` | Sin faltantes detectados |
| `/artist/login/` | `/artist/login/` | `/artist/login/` | Sin faltantes detectados |
| `/artist/profile/` | `/artist/profile/` | `/artist/profile/` | Sin faltantes detectados |
| `/artist/profile/details/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/artist/profile/gallery/` | `/artist/profile/gallery/` | `/artist/profile/gallery/` | Sin faltantes detectados |
| `/artist/travel/` | `/artist/login/` | `/artist/login/` | Sin faltantes detectados |
| `/artist/visitors/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/backoffice/` | `/backoffice/login/` | `/backoffice/login/` | Sin faltantes detectados |
| `/backoffice/login/` | `/backoffice/login/` | `/backoffice/login/` | Sin faltantes detectados |
| `/bienvenida/` | `/bienvenida/` | `/bienvenida/` | Sin faltantes detectados |
| `/calendar/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/client/chats/` | `/client/login/` | `/client/login/` | Sin faltantes detectados |
| `/client/dashboard/` | `/client/login/` | `/client/login/` | Sin faltantes detectados |
| `/client/login/` | `/client/login/` | `/client/login/` | Sin faltantes detectados |
| `/client/profile/` | `/client/login/` | `/client/login/` | Sin faltantes detectados |
| `/client/register/` | `/client/register/` | `/client/register/` | Sin faltantes detectados |
| `/client/requests/` | `/client/login/` | `/client/login/` | Sin faltantes detectados |
| `/componentes/` | `/componentes/` | `/componentes/` | Sin faltantes detectados |
| `/componentes/compuestos/` | `/componentes/compuestos/` | `/componentes/compuestos/` | Sin faltantes detectados |
| `/componentes/preview/` | `/componentes/preview/` | `/componentes/preview/` | Sin faltantes detectados |
| `/explore/` | `/explore/` | `/explore/` | Sin faltantes detectados |
| `/explore/globe/` | `/explore/globe/` | `/explore/globe/` | Sin faltantes detectados |
| `/inicio/` | `/inicio/` | `/inicio/` | Sin faltantes detectados |
| `/job-board/` | `/job-board/` | `/job-board/` | Sin faltantes detectados |
| `/job-board/request/` | `/job-board/request/` | `/job-board/request/` | Sin faltantes detectados |
| `/landing-tatuador/` | `/landing-tatuador/` | `/landing-tatuador/` | Sin faltantes detectados |
| `/marketplace/` | `/marketplace/` | `/marketplace/` | Sin faltantes detectados |
| `/migration-log/` | `/migration-log/` | `/migration-log/` | Sin faltantes detectados |
| `/my-quotations/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/my-quotations/detail/` | `/my-quotations/detail/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/my-quotations/statistics/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/pre-cotizador/` | `/pre-cotizador/` | `/pre-cotizador/` | Sin faltantes detectados |
| `/quotation/` | `/quotation/` | `/quotation/` | Sin faltantes detectados |
| `/quotations/` | `/quotation/` | `/quotation/` | Sin faltantes detectados |
| `/recover/` | `/recover/` | `/recover/` | Sin faltantes detectados |
| `/register-artist/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/registerclosedbeta/` | `/registerclosedbeta/` | `/registerclosedbeta/` | Sin faltantes detectados |
| `/studio/dashboard/` | `/studio/login/` | `/studio/login/` | Sin faltantes detectados |
| `/studio/login/` | `/studio/login/` | `/studio/login/` | Sin faltantes detectados |
| `/studio/profile/` | `/studio/profile/` | `/studio/profile/` | Sin faltantes detectados |
| `/studio/register/` | `/studio/register/` | `/studio/register/` | Sin faltantes detectados |
| `/studio-spots/` | `/studio-spots/` | `/studio-spots/` | Sin faltantes detectados |
| `/support/dashboard/` | `/support/dashboard/support-login.html` | `/support/dashboard/support-login.html` | Sin faltantes detectados |
| `/support/login/` | `/support/login/` | `/support/login/` | Sin faltantes detectados |
| `/travel/share/` | `/travel/share/` | `/travel/share/` | Sin faltantes detectados |
| `/tutorial/` | `/tutorial/` | `/tutorial/` | Sin faltantes detectados |

## Límites y recuperación

Los datos de perfiles, listas y estados de cuenta son ficticios en preview. Las páginas privadas de beta requieren cuentas de prueba autorizadas para comparar todos sus estados. Mapas con claves de proveedor, correos, soporte remoto y otras APIs reales continúan desactivados; esa limitación no es un recurso estático faltante. No se probó el producto completo en todos los tamaños ni se modificaron esas integraciones.

El respaldo de control es ~/weotzi-deploy/backups/valen-eye-20261027/. Para recuperar la barra anterior, restaurar preview-server.cjs, preview-bootstrap.js y proxy.php de ese respaldo (proxy.php vuelve a domains/preview.weotzi.chat/public_html/) y reiniciar solo weotzi-previews con su PM2_HOME privado. Las releases previas y los PNG anteriores quedan conservados; el código se revierte con git revert y nueva entrega versionada. No restaurar un mapa global de previews sobre publicaciones nuevas. Beta conserva su proceso, código y datos.
