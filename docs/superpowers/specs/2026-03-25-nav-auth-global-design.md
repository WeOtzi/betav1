# Nav Auth Global — Design Spec
**Fecha:** 2026-03-25
**Estado:** Aprobado
**Opción elegida:** A — Stark Bauhaus

---

## Objetivo

Añadir botones de iniciar/cerrar sesión en el menú de navegación de todas las páginas del sitio. Para artistas autenticados, incluir acceso directo al Dashboard. Para clientes, acceso a Mis Citas. Totalmente responsive con hamburguesa en mobile.

---

## Diseño Visual (Opción A — Stark Bauhaus)

Sigue el lenguaje visual existente: botones planos tipo estampilla con borde `3px solid var(--fg)`, tipografía `JetBrains Mono`, `text-transform: uppercase`. Sin ornamentos añadidos.

### Estados del nav (desktop)

| Estado sesión | Botones en nav-row |
|---|---|
| Sin sesión | `[− +]` `[LOG IN]` `[Ö]` |
| Artista autenticado | `[− +]` `[◼ DASHBOARD]` `[LOG OUT]` `[Ö]` |
| Cliente autenticado | `[− +]` `[◼ MIS CITAS]` `[LOG OUT]` `[Ö]` |

### Mobile (≤768px)

- Los botones de auth se ocultan
- Aparece botón hamburguesa `[≡]` (44×44px, borde `3px solid var(--fg)`)
- Al pulsar: drawer lateral desde la derecha (280px de ancho, `border-left: 3px solid var(--fg)`)
- El drawer contiene los mismos ítems según estado de sesión

### Colores de botones

- **LOG IN:** `background: var(--primary-red)` (`#E23E28`), `color: var(--bg)` (`#F2F0E9`)
- **DASHBOARD:** `background: var(--primary-blue)` (`#1A4B8E`), `color: var(--bg)` (`#F2F0E9`)
- **MIS CITAS:** `background: var(--primary-yellow)` (`#F4B942`), `color: var(--fg)` (`#0A0A0A`)
- **LOG OUT:** `background: transparent`, `border: 3px solid var(--fg)` (`#0A0A0A`)

---

## Arquitectura

### Nuevo archivo: `public/shared/js/nav-auth.js`

Script que se añade a cada página con un `<script src="/shared/js/nav-auth.js">`. Responsabilidades:

1. **Detectar contexto de página** — evitar doble render en páginas que ya tienen lógica de auth propia (ej. `registerclosedbeta` reutiliza su modal existente)
   - **Injection target:** seleccionar `.nav-row` del `.top-nav-header` existente; si no existe, crear el header mínimo y appenderlo al `<body>`
2. **Inicializar Supabase** — esperar a que `window._supabase` o la instancia global esté disponible (máx. 3s timeout)
3. **Consultar sesión** — `supabase.auth.getSession()`
4. **Determinar rol** — consultar `artists_db` WHERE `user_id = session.user.id`; si no existe, consultar `clients_db` WHERE `user_id = session.user.id`
5. **Render de botones** — inyectar en `.nav-row` los elementos correctos según rol
6. **Hamburguesa + Drawer** — en mobile, reemplaza botones inline por `[≡]` que abre drawer lateral
7. **Evento logout** — llama `supabase.auth.signOut()` y redirige a `/registerclosedbeta`
8. **Observar cambios de auth** — `supabase.auth.onAuthStateChange()` ejecuta re-render completo del nav (sin reload de página)
9. **Timeout de Supabase** — si Supabase no inicializa en 3s, renderiza nav de invitado y muestra `console.warn('[nav-auth] Supabase timeout')`

### CSS: inyectado por `nav-auth.js` vía `<style>` en `<head>`

Las páginas usan distintos CSS base (`landing-style.css`, `quotations.css`, inline styles), por lo que **no hay un único archivo compartido**. El script inyecta un bloque `<style id="nav-auth-styles">` al iniciar para garantizar que los estilos están disponibles en todas las páginas:

- `.nav-auth-login` — `background: #E23E28`, `color: #F2F0E9`
- `.nav-auth-dashboard` — `background: #1A4B8E`, `color: #F2F0E9`
- `.nav-auth-client` — `background: #F4B942`, `color: #0A0A0A`
- `.nav-auth-logout` — `background: transparent`, `border: 3px solid currentColor`
- `.nav-hamburger` — 44×44px, `border: 3px solid currentColor`
- `.nav-drawer` — `width: 280px`, `transform: translateX(100%)` → `.open` = `translateX(0)`
- `.nav-drawer-overlay` — `background: rgba(10,10,10,0.5)` (fallback sin `backdrop-filter`)
- Media query `@media (max-width: 768px)`: oculta botones inline, muestra hamburguesa

### Modificación de páginas HTML (16 archivos)

Añadir **justo antes del `</body>`**, después de cualquier otro `<script>` existente (para garantizar que Supabase y config-manager ya están cargados):

```html
<script src="/shared/js/nav-auth.js"></script>
```

**Páginas incluidas (16):**
1. `public/registerclosedbeta/index.html`
2. `public/artist/dashboard/index.html`
3. `public/artist/profile/index.html`
4. `public/marketplace/index.html`
5. `public/quotation/index.html`
6. `public/my-quotations/index.html`
7. `public/my-quotations/statistics/index.html`
8. `public/calendar/index.html`
9. `public/archive/index.html`
10. `public/tutorial/index.html`
11. `public/client/dashboard/index.html`
12. `public/client/login/index.html`
13. `public/client/register/index.html`
14. `public/register-artist/index.html`
15. `public/job-board/index.html`
16. `public/job-board/request/index.html`

**Páginas excluidas** (auth interna independiente, no necesitan nav público):
- `public/backoffice/index.html`
- `public/support/dashboard/index.html`
- `public/support/login/index.html`

---

## Casos especiales

### `registerclosedbeta` (landing page)
- Ya tiene `#login-btn` y `openLoginModal()` — el script detecta su existencia (`document.getElementById('login-btn')`) y no inyecta un botón LOG IN adicional
- Si `#login-btn` NO existe (cambio futuro), el script inyecta el botón LOG IN normalmente como en cualquier otra página (fallback estándar)
- Si hay sesión activa: `#login-btn` se oculta con `display:none` y el script inyecta DASHBOARD + LOG OUT en el `.nav-row`. Los dos botones reemplazan al #login-btn; no coexisten

### `artist/dashboard`
- Ya tiene `handleLogout()` definida globalmente en `dashboard.js` (firma: `async function handleLogout()`, sin parámetros, hace signOut y redirige)
- El script comprueba `typeof window.handleLogout === 'function'` antes de reusarla; si no existe, usa el signOut genérico como fallback
- No renderiza botón DASHBOARD (ya estás en el dashboard)

### `client/login` y `client/register`
- Si hay sesión activa, los botones de nav aparecen normalmente
- Si no hay sesión, solo muestra LOG IN (sin duplicar los formularios de la página)

---

## Flujo de detección de rol

```
getSession()
  ├── Sin sesión → renderGuestNav()
  └── Con sesión (user.id disponible)
        ├── query artists_db WHERE user_id = session.user.id
        │     ├── encontrado → renderArtistNav()
        │     └── no encontrado → query clients_db WHERE user_id = session.user.id
        │           ├── encontrado → renderClientNav()
        │           └── no encontrado → renderGuestNav()
        │                             (usuario autenticado sin perfil, ej. registro incompleto)
        └── Error en queries → renderGuestNav()
                              + console.warn('[nav-auth] Error al determinar rol', error)
                              (silencioso para el usuario, visible en DevTools)

onAuthStateChange(event, session):
  → SIGNED_IN: limpiar botones de auth previos del `.nav-row` (por id), re-ejecutar flujo completo
  → SIGNED_OUT: limpiar botones previos, renderGuestNav()
  → TOKEN_REFRESHED: ignorar (no re-render necesario)
  El drawer también se cierra automáticamente al hacer resize por encima de 768px (listener en `window.resize`)
```

---

## Responsividad

| Breakpoint | Comportamiento |
|---|---|
| > 768px | Botones inline en `.nav-row` |
| ≤ 768px | Solo hamburguesa `[≡]` visible; drawer lateral al pulsar |

El hamburguesa se añade dinámicamente al `.nav-row` en mobile. Los botones auth se ocultan con `display: none` en el media query correspondiente de `landing-style.css`.

---

## Compatibilidad entre navegadores

- Sin uso de CSS Container Queries ni features experimentales
- `backdrop-filter` en overlay del drawer con fallback `background: rgba(0,0,0,0.5)`
- Soporte: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

## Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `public/shared/js/nav-auth.js` | Nuevo (incluye estilos inyectados vía `<style>`) |
| 16 archivos HTML | Añadir 1 línea `<script src="/shared/js/nav-auth.js">` antes de `</body>` |
