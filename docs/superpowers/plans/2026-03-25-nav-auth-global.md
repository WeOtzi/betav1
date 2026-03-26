# Nav Auth Global — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir botones de login/logout/dashboard en el nav de todas las páginas públicas del sitio, usando un script compartido auto-contenido que detecta el rol del usuario vía Supabase.

**Architecture:** Un único archivo `nav-auth.js` inyecta sus propios estilos CSS vía `<style>` tag, detecta el rol del usuario consultando `artists_db` y `clients_db`, y renderiza botones inline en `.nav-row`. En mobile (≤768px) muestra hamburguesa + drawer lateral. El script maneja casos especiales por pathname.

**Tech Stack:** Vanilla JS, Supabase JS v2 (ya cargado en las páginas), CSS inyectado via DOM.

**Spec:** `docs/superpowers/specs/2026-03-25-nav-auth-global-design.md`

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `public/shared/js/nav-auth.js` | Crear | Script completo: CSS, init, auth, render, drawer |
| `public/registerclosedbeta/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/artist/dashboard/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/artist/profile/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/marketplace/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/quotation/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/my-quotations/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/my-quotations/statistics/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/calendar/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/archive/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/tutorial/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/client/dashboard/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/client/login/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/client/register/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/register-artist/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/job-board/index.html` | Modificar | Añadir `<script>` antes de `</body>` |
| `public/job-board/request/index.html` | Modificar | Añadir `<script>` antes de `</body>` |

---

## Task 1: Crear nav-auth.js — Esqueleto + CSS inyectado

**Files:**
- Create: `public/shared/js/nav-auth.js`

- [ ] **Step 1: Crear el archivo con el esqueleto IIFE y la inyección de CSS**

Crear `public/shared/js/nav-auth.js` con el siguiente contenido:

```javascript
/**
 * WE ÖTZI — Nav Auth
 * Script compartido que gestiona el estado de autenticación en el nav.
 * Auto-inyecta sus estilos CSS. No depende de ningún CSS externo.
 */
(function () {
  'use strict';

  // ── CONSTANTES ──────────────────────────────────────────────────────
  var SUPABASE_TIMEOUT_MS = 3000;
  var MOBILE_BREAKPOINT   = 768;
  var ARTIST_DASHBOARD    = '/artist/dashboard';
  var CLIENT_DASHBOARD    = '/client/dashboard';
  var LOGIN_PAGE          = '/registerclosedbeta';

  var COLORS = {
    bg:      '#F2F0E9',
    fg:      '#0A0A0A',
    red:     '#E23E28',
    yellow:  '#F4B942',
    blue:    '#1A4B8E',
  };

  // ── INYECTAR CSS ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nav-auth-styles')) return;
    var style = document.createElement('style');
    style.id = 'nav-auth-styles';
    style.textContent = [
      /* Contenedor de auth en el nav */
      '#nav-auth-section {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 0;',
      '}',

      /* Botones base compartidos */
      '.nav-auth-btn {',
      '  font-family: "JetBrains Mono", "Consolas", monospace;',
      '  font-weight: 700;',
      '  font-size: 0.75rem;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.06em;',
      '  border: 3px solid ' + COLORS.fg + ';',
      '  height: 44px;',
      '  padding: 0 18px;',
      '  cursor: pointer;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  text-decoration: none;',
      '  white-space: nowrap;',
      '  transition: background 0.2s, color 0.2s, transform 0.2s;',
      '  -webkit-font-smoothing: antialiased;',
      '}',
      '.nav-auth-btn + .nav-auth-btn {',
      '  border-left: none;',
      '}',

      /* LOG IN */
      '.nav-auth-login {',
      '  background: ' + COLORS.red + ';',
      '  color: ' + COLORS.bg + ';',
      '}',
      '.nav-auth-login:hover {',
      '  background: ' + COLORS.fg + ';',
      '  transform: translateY(-2px);',
      '}',

      /* DASHBOARD */
      '.nav-auth-dashboard {',
      '  background: ' + COLORS.blue + ';',
      '  color: ' + COLORS.bg + ';',
      '}',
      '.nav-auth-dashboard:hover {',
      '  background: ' + COLORS.fg + ';',
      '}',

      /* MIS CITAS */
      '.nav-auth-client {',
      '  background: ' + COLORS.yellow + ';',
      '  color: ' + COLORS.fg + ';',
      '}',
      '.nav-auth-client:hover {',
      '  background: ' + COLORS.fg + ';',
      '  color: ' + COLORS.bg + ';',
      '}',

      /* LOG OUT */
      '.nav-auth-logout {',
      '  background: transparent;',
      '  color: ' + COLORS.fg + ';',
      '}',
      '.nav-auth-logout:hover {',
      '  background: ' + COLORS.fg + ';',
      '  color: ' + COLORS.bg + ';',
      '}',

      /* HAMBURGUESA */
      '.nav-hamburger {',
      '  display: none;',
      '  width: 44px;',
      '  height: 44px;',
      '  border: 3px solid ' + COLORS.fg + ';',
      '  background: transparent;',
      '  cursor: pointer;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: 5px;',
      '  padding: 10px;',
      '}',
      '.nav-hamburger span {',
      '  display: block;',
      '  width: 20px;',
      '  height: 2px;',
      '  background: ' + COLORS.fg + ';',
      '  transition: all 0.3s;',
      '}',
      '.nav-hamburger.is-open span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }',
      '.nav-hamburger.is-open span:nth-child(2) { opacity: 0; }',
      '.nav-hamburger.is-open span:nth-child(3) { transform: rotate(-45deg) translate(5px, -5px); }',

      /* DRAWER OVERLAY */
      '.nav-drawer-overlay {',
      '  display: none;',
      '  position: fixed;',
      '  inset: 0;',
      '  background: rgba(10,10,10,0.5);',
      '  z-index: 2000;',
      '}',
      '.nav-drawer-overlay.is-open { display: block; }',

      /* DRAWER PANEL */
      '.nav-drawer {',
      '  position: fixed;',
      '  top: 0;',
      '  right: 0;',
      '  width: 280px;',
      '  height: 100%;',
      '  background: ' + COLORS.bg + ';',
      '  border-left: 3px solid ' + COLORS.fg + ';',
      '  z-index: 2001;',
      '  transform: translateX(100%);',
      '  transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '.nav-drawer.is-open { transform: translateX(0); }',

      /* DRAWER HEADER */
      '.nav-drawer-header {',
      '  display: flex;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '  padding: 20px 24px;',
      '  border-bottom: 3px solid ' + COLORS.fg + ';',
      '}',
      '.nav-drawer-title {',
      '  font-family: "JetBrains Mono", monospace;',
      '  font-size: 0.7rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.1em;',
      '  opacity: 0.6;',
      '}',
      '.nav-drawer-close {',
      '  background: transparent;',
      '  border: 2px solid ' + COLORS.fg + ';',
      '  width: 32px;',
      '  height: 32px;',
      '  cursor: pointer;',
      '  font-size: 1rem;',
      '  font-weight: 900;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  color: ' + COLORS.fg + ';',
      '}',

      /* DRAWER ITEMS */
      '.nav-drawer-body { display: flex; flex-direction: column; flex: 1; }',
      '.nav-drawer-item {',
      '  display: flex;',
      '  align-items: center;',
      '  padding: 20px 24px;',
      '  border-bottom: 2px solid ' + COLORS.fg + ';',
      '  font-family: "JetBrains Mono", monospace;',
      '  font-weight: 700;',
      '  font-size: 0.85rem;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.05em;',
      '  cursor: pointer;',
      '  background: transparent;',
      '  border-left: 6px solid transparent;',
      '  border-right: none;',
      '  border-top: none;',
      '  color: ' + COLORS.fg + ';',
      '  text-align: left;',
      '  text-decoration: none;',
      '  width: 100%;',
      '  transition: background 0.15s, padding-left 0.15s;',
      '}',
      '.nav-drawer-item:hover {',
      '  background: ' + COLORS.fg + ';',
      '  color: ' + COLORS.bg + ';',
      '  padding-left: 32px;',
      '}',
      '.nav-drawer-item.is-red   { border-left-color: ' + COLORS.red + '; }',
      '.nav-drawer-item.is-blue  { border-left-color: ' + COLORS.blue + '; background: ' + COLORS.blue + '; color: ' + COLORS.bg + '; }',
      '.nav-drawer-item.is-blue:hover { background: ' + COLORS.fg + '; }',
      '.nav-drawer-item.is-yellow { border-left-color: ' + COLORS.yellow + '; background: ' + COLORS.yellow + '; color: ' + COLORS.fg + '; }',
      '.nav-drawer-item.is-yellow:hover { background: ' + COLORS.fg + '; color: ' + COLORS.bg + '; }',

      /* DRAWER FOOTER */
      '.nav-drawer-footer {',
      '  padding: 16px 24px;',
      '  border-top: 3px solid ' + COLORS.fg + ';',
      '  font-family: "JetBrains Mono", monospace;',
      '  font-size: 0.6rem;',
      '  text-transform: uppercase;',
      '  opacity: 0.35;',
      '}',

      /* MOBILE: mostrar hamburguesa, ocultar botones */
      '@media (max-width: ' + MOBILE_BREAKPOINT + 'px) {',
      '  .nav-auth-btn { display: none !important; }',
      '  .nav-hamburger { display: flex !important; }',
      '}',

      /* DARK MODE compat */
      '[data-theme="dark"] .nav-auth-logout,',
      '.dark-mode .nav-auth-logout {',
      '  color: #F2F0E9;',
      '  border-color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-auth-logout:hover,',
      '.dark-mode .nav-auth-logout:hover {',
      '  background: #F2F0E9;',
      '  color: #0A0A0A;',
      '}',
      '[data-theme="dark"] .nav-hamburger span,',
      '.dark-mode .nav-hamburger span {',
      '  background: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-hamburger,',
      '.dark-mode .nav-hamburger {',
      '  border-color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-drawer,',
      '.dark-mode .nav-drawer {',
      '  background: #0A0A0A;',
      '  border-color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-drawer-item,',
      '.dark-mode .nav-drawer-item {',
      '  color: #F2F0E9;',
      '  border-color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-drawer-item:hover,',
      '.dark-mode .nav-drawer-item:hover {',
      '  background: #F2F0E9;',
      '  color: #0A0A0A;',
      '}',
      '[data-theme="dark"] .nav-drawer-close,',
      '.dark-mode .nav-drawer-close {',
      '  border-color: #F2F0E9;',
      '  color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-drawer-header,',
      '.dark-mode .nav-drawer-header {',
      '  border-color: #F2F0E9;',
      '}',
      '[data-theme="dark"] .nav-btn + .nav-auth-btn,',
      '.dark-mode .nav-auth-btn + .nav-auth-btn {',
      '  border-left: none;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── PLACEHOLDER (resto en Task 2) ────────────────────────────────
  function init() {
    injectStyles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 2: Abrir `public/registerclosedbeta/index.html` en el navegador y verificar que no hay errores en consola**

Abrir DevTools → Console. El script no debe producir errores. El nav no cambia aún (solo se inyectan estilos).

- [ ] **Step 3: Commit**

```bash
git add public/shared/js/nav-auth.js
git commit -m "feat: add nav-auth.js skeleton with injected CSS styles"
```

---

## Task 2: Supabase init + detección de sesión y rol

**Files:**
- Modify: `public/shared/js/nav-auth.js`

- [ ] **Step 1: Añadir la función de inicialización de Supabase y detección de rol**

Reemplazar el bloque `// ── PLACEHOLDER...` y la función `init` completa con el siguiente código. Pegar a partir de la línea que dice `// ── PLACEHOLDER`:

```javascript
  // ── SUPABASE INIT ────────────────────────────────────────────────
  /**
   * Obtiene la instancia de Supabase. Primero busca la global de la página
   * (_supabase o supabase). Si no existe, la crea con las credenciales de CONFIG.
   * Timeout de 3s para evitar bloqueo indefinido.
   */
  function getSupabaseClient() {
    return new Promise(function (resolve) {
      // Instancia ya disponible en la página
      if (window._supabase && typeof window._supabase.auth === 'object') {
        return resolve(window._supabase);
      }

      var elapsed = 0;
      var interval = setInterval(function () {
        if (window._supabase && typeof window._supabase.auth === 'object') {
          clearInterval(interval);
          return resolve(window._supabase);
        }
        elapsed += 100;
        if (elapsed >= SUPABASE_TIMEOUT_MS) {
          clearInterval(interval);
          // Intentar crear cliente propio si el SDK global está disponible
          if (window.supabase && window.CONFIG && window.CONFIG.supabase) {
            try {
              var client = window.supabase.createClient(
                window.CONFIG.supabase.url,
                window.CONFIG.supabase.anonKey
              );
              return resolve(client);
            } catch (e) { /* fall through */ }
          }
          console.warn('[nav-auth] Supabase no disponible después de ' + SUPABASE_TIMEOUT_MS + 'ms');
          return resolve(null);
        }
      }, 100);
    });
  }

  // ── DETECCIÓN DE ROL ────────────────────────────────────────────
  /**
   * Dado un userId, determina el rol consultando artists_db y clients_db.
   * Retorna 'artist', 'client', o 'guest'.
   */
  async function detectRole(supabaseClient, userId) {
    try {
      var artistRes = await supabaseClient
        .from('artists_db')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (artistRes.data) return 'artist';

      var clientRes = await supabaseClient
        .from('clients_db')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (clientRes.data) return 'client';

      return 'guest';
    } catch (err) {
      console.warn('[nav-auth] Error al determinar rol del usuario:', err);
      return 'guest';
    }
  }

  // ── INIT PRINCIPAL ───────────────────────────────────────────────
  async function init() {
    injectStyles();
    buildDrawer();

    var sb = await getSupabaseClient();
    if (!sb) {
      renderNav('guest');
      return;
    }

    // Sesión inicial
    var sessionRes = await sb.auth.getSession();
    var session    = sessionRes && sessionRes.data && sessionRes.data.session;

    if (!session) {
      renderNav('guest');
    } else {
      var role = await detectRole(sb, session.user.id);
      renderNav(role);
    }

    // Escuchar cambios de auth
    sb.auth.onAuthStateChange(async function (event, newSession) {
      if (event === 'SIGNED_OUT') {
        renderNav('guest');
      } else if (event === 'SIGNED_IN' && newSession) {
        var role = await detectRole(sb, newSession.user.id);
        renderNav(role);
      }
      // TOKEN_REFRESHED: ignorar
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
```

- [ ] **Step 2: Verificar en navegador — abrir DevTools → Network**

Cargar `registerclosedbeta`. En Network debe verse una petición a `artists_db` y otra a `clients_db`. En Console no debe haber errores (puede haber el warn si no hay sesión — eso es normal).

- [ ] **Step 3: Commit**

```bash
git add public/shared/js/nav-auth.js
git commit -m "feat: nav-auth — Supabase init and role detection"
```

---

## Task 3: Funciones de render del nav

**Files:**
- Modify: `public/shared/js/nav-auth.js`

- [ ] **Step 1: Añadir las funciones de render después de `injectStyles()`**

Insertar el siguiente bloque de funciones justo después de la función `injectStyles()` y antes de `getSupabaseClient()`:

```javascript
  // ── UTILIDADES DOM ───────────────────────────────────────────────
  function getNavRow() {
    return document.querySelector('.top-nav-header .nav-row') ||
           document.querySelector('.nav-row');
  }

  function clearAuthSection() {
    var existing = document.getElementById('nav-auth-section');
    if (existing) existing.remove();
    // Restaurar #login-btn si fue ocultado
    var loginBtn = document.getElementById('login-btn');
    if (loginBtn) loginBtn.style.removeProperty('display');
  }

  function makeBtn(tag, cls, text, onClick, href) {
    var el = document.createElement(tag === 'a' ? 'a' : 'button');
    el.className = 'nav-auth-btn ' + cls;
    el.textContent = text;
    if (tag === 'a' && href) {
      el.href = href;
    } else if (onClick) {
      el.addEventListener('click', onClick);
    }
    return el;
  }

  function getLogoutHandler(sb) {
    return async function () {
      // Reusar handleLogout de la página si existe (ej. artist/dashboard)
      if (typeof window.handleLogout === 'function') {
        await window.handleLogout();
      } else {
        await sb.auth.signOut();
        window.location.href = LOGIN_PAGE;
      }
    };
  }

  // ── RENDER ───────────────────────────────────────────────────────
  /**
   * renderNav crea o actualiza #nav-auth-section en .nav-row.
   * Se llama con 'guest', 'artist', o 'client'.
   * Guarda el sb client en closure para el logout handler.
   */
  var _sbClient = null; // guardado en primer uso

  function renderNav(role) {
    var navRow = getNavRow();
    if (!navRow) return;

    clearAuthSection();

    var pathname = window.location.pathname;

    // ─ CASO ESPECIAL: registerclosedbeta guest ─
    // El #login-btn existente ya maneja el login; no lo duplicamos.
    var loginBtn = document.getElementById('login-btn');
    if (loginBtn && role === 'guest') return; // dejar que el botón original funcione

    // ─ Ocultar #login-btn si hay sesión ─
    if (loginBtn && role !== 'guest') {
      loginBtn.style.display = 'none';
    }

    var section = document.createElement('div');
    section.id = 'nav-auth-section';
    section.style.display = 'contents'; // no altera el layout del flex parent

    var sb = _sbClient;

    if (role === 'guest') {
      var btnLogin = makeBtn('button', 'nav-auth-login', 'Log In', function () {
        // Si hay openLoginModal en la página (landing), usarla
        if (typeof window.openLoginModal === 'function') {
          window.openLoginModal();
        } else {
          window.location.href = LOGIN_PAGE;
        }
      });
      section.appendChild(btnLogin);

    } else if (role === 'artist') {
      // No mostrar DASHBOARD si ya estamos en /artist/dashboard
      if (!pathname.includes(ARTIST_DASHBOARD)) {
        var btnDash = makeBtn('a', 'nav-auth-dashboard', '◼ Dashboard', null, ARTIST_DASHBOARD);
        section.appendChild(btnDash);
      }
      var btnOut = makeBtn('button', 'nav-auth-logout', 'Log Out', getLogoutHandler(sb));
      section.appendChild(btnOut);

    } else if (role === 'client') {
      // No mostrar MIS CITAS si ya estamos en /client/dashboard
      if (!pathname.includes(CLIENT_DASHBOARD)) {
        var btnCitas = makeBtn('a', 'nav-auth-client', '◼ Mis Citas', null, CLIENT_DASHBOARD);
        section.appendChild(btnCitas);
      }
      var btnOutC = makeBtn('button', 'nav-auth-logout', 'Log Out', getLogoutHandler(sb));
      section.appendChild(btnOutC);
    }

    // Hamburguesa (siempre presente cuando hay auth section)
    var ham = document.createElement('button');
    ham.className = 'nav-hamburger';
    ham.setAttribute('aria-label', 'Abrir menú');
    ham.innerHTML = '<span></span><span></span><span></span>';
    ham.addEventListener('click', openDrawer);
    section.appendChild(ham);

    // Insertar al inicio de nav-row (antes del zoom/theme)
    navRow.insertBefore(section, navRow.firstChild);

    // También actualizar contenido del drawer
    updateDrawerContent(role, sb, pathname);
  }
```

- [ ] **Step 2: Verificar en navegador con sesión de artista activa**

Iniciar sesión como artista. El nav debe mostrar `[◼ DASHBOARD]` y `[LOG OUT]` antes del zoom y el theme toggle.

- [ ] **Step 3: Verificar con sesión de cliente activa**

Iniciar sesión como cliente. El nav debe mostrar `[◼ MIS CITAS]` y `[LOG OUT]`.

- [ ] **Step 4: Verificar sin sesión**

Sin sesión: se muestra el `[LOG IN]` original (en registerclosedbeta) o el botón inyectado (en otras páginas).

- [ ] **Step 5: Commit**

```bash
git add public/shared/js/nav-auth.js
git commit -m "feat: nav-auth — render functions for guest/artist/client"
```

---

## Task 4: Drawer mobile (hamburguesa)

**Files:**
- Modify: `public/shared/js/nav-auth.js`

- [ ] **Step 1: Añadir funciones del drawer después de `injectStyles()`**

Insertar el siguiente bloque justo después de la función `injectStyles()`:

```javascript
  // ── DRAWER ───────────────────────────────────────────────────────
  var _drawer  = null;
  var _overlay = null;
  var _ham     = null;

  function buildDrawer() {
    if (document.getElementById('nav-drawer')) return;

    // Overlay
    _overlay = document.createElement('div');
    _overlay.id = 'nav-drawer-overlay';
    _overlay.className = 'nav-drawer-overlay';
    _overlay.addEventListener('click', closeDrawer);

    // Panel
    _drawer = document.createElement('div');
    _drawer.id = 'nav-drawer';
    _drawer.className = 'nav-drawer';
    _drawer.setAttribute('role', 'dialog');
    _drawer.setAttribute('aria-modal', 'true');
    _drawer.setAttribute('aria-label', 'Menú de navegación');

    _drawer.innerHTML = [
      '<div class="nav-drawer-header">',
      '  <span class="nav-drawer-title">Menú</span>',
      '  <button class="nav-drawer-close" aria-label="Cerrar menú" id="nav-drawer-close-btn">✕</button>',
      '</div>',
      '<div class="nav-drawer-body" id="nav-drawer-body"></div>',
      '<div class="nav-drawer-footer">We Ötzi · Beta Cerrada</div>',
    ].join('');

    document.body.appendChild(_overlay);
    document.body.appendChild(_drawer);

    document.getElementById('nav-drawer-close-btn').addEventListener('click', closeDrawer);

    // Cerrar con Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    // Cerrar al redimensionar a desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > MOBILE_BREAKPOINT) closeDrawer();
    });
  }

  function openDrawer() {
    if (!_drawer) return;
    _ham = document.querySelector('.nav-hamburger');
    _drawer.classList.add('is-open');
    _overlay.classList.add('is-open');
    if (_ham) _ham.classList.add('is-open');
    // Focus al primer item del drawer
    var firstItem = _drawer.querySelector('.nav-drawer-item, .nav-drawer-close');
    if (firstItem) firstItem.focus();
  }

  function closeDrawer() {
    if (!_drawer) return;
    _ham = document.querySelector('.nav-hamburger');
    _drawer.classList.remove('is-open');
    _overlay.classList.remove('is-open');
    if (_ham) _ham.classList.remove('is-open');
  }

  function makeDrawerItem(text, cls, onClick, href) {
    var el = document.createElement(href ? 'a' : 'button');
    el.className = 'nav-drawer-item ' + (cls || '');
    el.textContent = text;
    if (href) {
      el.href = href;
    } else if (onClick) {
      el.addEventListener('click', function () { closeDrawer(); onClick(); });
    }
    return el;
  }

  function updateDrawerContent(role, sb, pathname) {
    var body = document.getElementById('nav-drawer-body');
    if (!body) return;
    body.innerHTML = '';

    if (role === 'guest') {
      body.appendChild(makeDrawerItem('Log In', 'is-red', function () {
        if (typeof window.openLoginModal === 'function') {
          window.openLoginModal();
        } else {
          window.location.href = LOGIN_PAGE;
        }
      }));

    } else if (role === 'artist') {
      if (!pathname.includes(ARTIST_DASHBOARD)) {
        body.appendChild(makeDrawerItem('◼ Dashboard', 'is-blue', null, ARTIST_DASHBOARD));
      }
      body.appendChild(makeDrawerItem('Log Out', 'is-red', getLogoutHandler(sb)));

    } else if (role === 'client') {
      if (!pathname.includes(CLIENT_DASHBOARD)) {
        body.appendChild(makeDrawerItem('◼ Mis Citas', 'is-yellow', null, CLIENT_DASHBOARD));
      }
      body.appendChild(makeDrawerItem('Log Out', 'is-red', getLogoutHandler(sb)));
    }
  }
```

- [ ] **Step 2: Verificar drawer en viewport mobile**

En DevTools, cambiar a vista mobile (≤768px). El nav debe mostrar solo la hamburguesa. Al pulsarla, el drawer debe deslizarse desde la derecha. Los ítems deben coincidir con el estado de sesión.

- [ ] **Step 3: Verificar cierre con tecla Escape y con overlay**

Abrir drawer → pulsar Escape → debe cerrarse. Abrir drawer → pulsar el overlay oscuro → debe cerrarse.

- [ ] **Step 4: Verificar cierre al redimensionar**

Con el drawer abierto, arrastrar el borde de la ventana a >768px → el drawer debe cerrarse.

- [ ] **Step 5: Commit**

```bash
git add public/shared/js/nav-auth.js
git commit -m "feat: nav-auth — mobile hamburger and drawer"
```

---

## Task 5: Guardar el cliente Supabase en closure y verificar dark mode

**Files:**
- Modify: `public/shared/js/nav-auth.js`

- [ ] **Step 1: Actualizar la función `init` para guardar `_sbClient`**

En la función `init`, después de `var sb = await getSupabaseClient();`, añadir la línea:

```javascript
    _sbClient = sb;
```

Esto garantiza que las llamadas a `renderNav` posteriores (desde `onAuthStateChange`) tengan acceso al cliente.

- [ ] **Step 2: Verificar dark mode**

Alternar modo oscuro con el botón `Ö`. Los botones de auth, la hamburguesa y el drawer deben verse correctamente en dark mode (texto claro sobre fondo oscuro).

- [ ] **Step 3: Verificar que onAuthStateChange actualiza el nav sin reload**

Con DevTools abierto, abrir otra pestaña, cerrar sesión manualmente con `_supabase.auth.signOut()` en consola. El nav en la primera pestaña no hará reload, pero si se regresa y hay un evento de auth, el nav se actualizará.

- [ ] **Step 4: Commit**

```bash
git add public/shared/js/nav-auth.js
git commit -m "feat: nav-auth — wire sb client to closure and auth state listener"
```

---

## Task 6: Añadir el script a las 16 páginas HTML

**Files:**
- Modify: 16 archivos HTML (ver lista abajo)

En cada archivo, añadir la siguiente línea justo **antes de `</body>`**:

```html
    <script src="/shared/js/nav-auth.js"></script>
```

- [ ] **Step 1: Añadir a `public/registerclosedbeta/index.html`**

- [ ] **Step 2: Añadir a `public/artist/dashboard/index.html`**

- [ ] **Step 3: Añadir a `public/artist/profile/index.html`**

- [ ] **Step 4: Añadir a `public/marketplace/index.html`**

- [ ] **Step 5: Añadir a `public/quotation/index.html`**

- [ ] **Step 6: Añadir a `public/my-quotations/index.html`**

- [ ] **Step 7: Añadir a `public/my-quotations/statistics/index.html`**

- [ ] **Step 8: Añadir a `public/calendar/index.html`**

- [ ] **Step 9: Añadir a `public/archive/index.html`**

- [ ] **Step 10: Añadir a `public/tutorial/index.html`**

- [ ] **Step 11: Añadir a `public/client/dashboard/index.html`**

- [ ] **Step 12: Añadir a `public/client/login/index.html`**

- [ ] **Step 13: Añadir a `public/client/register/index.html`**

- [ ] **Step 14: Añadir a `public/register-artist/index.html`**

- [ ] **Step 15: Añadir a `public/job-board/index.html`**

- [ ] **Step 16: Añadir a `public/job-board/request/index.html`**

- [ ] **Step 17: Verificar que NO se añadió a páginas excluidas**

Confirmar que los siguientes archivos NO tienen el script:
- `public/backoffice/index.html`
- `public/support/dashboard/index.html`
- `public/support/login/index.html`

- [ ] **Step 18: Commit**

```bash
git add public/registerclosedbeta/index.html \
        public/artist/dashboard/index.html \
        public/artist/profile/index.html \
        public/marketplace/index.html \
        public/quotation/index.html \
        public/my-quotations/index.html \
        "public/my-quotations/statistics/index.html" \
        public/calendar/index.html \
        public/archive/index.html \
        public/tutorial/index.html \
        public/client/dashboard/index.html \
        public/client/login/index.html \
        public/client/register/index.html \
        public/register-artist/index.html \
        public/job-board/index.html \
        "public/job-board/request/index.html"
git commit -m "feat: add nav-auth.js to all 16 public pages"
```

---

## Task 7: Verificación final y limpieza

**Files:**
- Delete: `tmp_nav_mockup.html` (archivo temporal del mockup)
- Delete: `tmp_qr_mockup.html` (archivo temporal existente, si no se necesita)

- [ ] **Step 1: Prueba de regresión — página registerclosedbeta**

Sin sesión: el botón `LOG IN` original debe ser visible y funcional (abre el modal). El script no lo duplica.

- [ ] **Step 2: Prueba — artist/dashboard con sesión de artista**

Debe aparecer solo `[LOG OUT]` (sin DASHBOARD, porque ya estamos en el dashboard). El botón existente en el nav del dashboard no debe duplicarse.

- [ ] **Step 3: Prueba — artist/profile con sesión de artista**

Debe aparecer `[◼ DASHBOARD]` y `[LOG OUT]` en el nav.

- [ ] **Step 4: Prueba — client/dashboard con sesión de cliente**

Debe aparecer solo `[LOG OUT]` (sin MIS CITAS, porque ya estamos ahí).

- [ ] **Step 5: Prueba — job-board sin sesión**

El nav debe mostrar `[LOG IN]`. Al pulsarlo, redirige a `/registerclosedbeta`.

- [ ] **Step 6: Prueba responsiva en Chrome DevTools**

Cambiar a iPhone SE (375px): hamburguesa visible, drawer funcional, ítems correctos según sesión.

- [ ] **Step 7: Prueba en Safari (si disponible)**

Verificar que no hay errores de sintaxis JS (Safari es más estricto con ES5/ES6 mixed syntax).

- [ ] **Step 8: Limpiar archivos temporales**

```bash
git rm tmp_nav_mockup.html
git commit -m "chore: remove nav mockup temp file"
```

- [ ] **Step 9: Commit final de verificación**

```bash
git add -u
git commit -m "chore: nav-auth global implementation complete"
```

---

## Notas de implementación

### Sobre `display: contents` en el section container
`#nav-auth-section` usa `display: contents` para que sus hijos participen directamente en el flex layout de `.nav-row`, sin añadir un wrapper que rompa el gap/spacing existente.

### Sobre el timeout de Supabase
El polling de 100ms es suficientemente rápido para no causar flicker perceptible. El timeout de 3s cubre casos de red lenta sin bloquear indefinidamente.

### Sobre páginas sin `.top-nav-header`
Si una página no tiene `.top-nav-header .nav-row`, `getNavRow()` busca cualquier `.nav-row` como fallback. Si no encuentra ninguno, retorna `null` y `renderNav()` sale silenciosamente.

### Sobre artist/dashboard y su `handleLogout` existente
`dashboard.js` exporta `window.handleLogout` (línea 2343). El script lo reutiliza vía `typeof window.handleLogout === 'function'`. Esto garantiza que el logout del dashboard (que puede tener lógica extra) se ejecute correctamente.
