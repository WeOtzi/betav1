# Dashboard Location Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar autocompletado de dirección con Google Places y botón de geolocalización automática (GPS + fallback IP) al campo de ubicación en el formulario de edición del dashboard del artista.

**Architecture:** Se carga el script de Google Maps API dinámicamente (polling hasta que `window.CONFIG` esté disponible), se inicializa el autocomplete en `input-location` al entrar al modo edición, y el botón de geolocalización usa `navigator.geolocation` con fallback a `ipapi.co`. El grupo de ubicación se muestra/oculta junto con los demás inputs del formulario de edición mediante `toggleEditMode()`.

**Tech Stack:** Google Maps Places API (ya configurada en `app-config.json`), Vanilla JS, CSS puro con variables CSS del sistema de diseño Bauhaus existente.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `public/artist/dashboard/index.html` | Modificar | HTML del grupo de ubicación + carga dinámica de Google Maps |
| `public/shared/js/dashboard.js` | Modificar | Lógica de autocomplete y geolocalización |
| `public/shared/css/dashboard.css` | Modificar | Estilos del grupo de ubicación y botón de geolocalización |

---

### Task 1: Estilos CSS para el grupo de ubicación en el dashboard

**Files:**
- Modify: `public/shared/css/dashboard.css` (al final del archivo, antes de los media queries finales)

- [ ] **Step 1: Leer el final del archivo CSS del dashboard para saber dónde insertar**

  Leer `public/shared/css/dashboard.css` desde la línea 1900 en adelante para identificar los media queries existentes y encontrar el lugar correcto para insertar los nuevos estilos.

- [ ] **Step 2: Agregar estilos del grupo de ubicación**

  Insertar justo ANTES del primer `@media` de los media queries finales (buscar el bloque `@media (max-width: 1200px)` o similar al final del archivo):

  ```css
  /* ============================================
     LOCATION INPUT GROUP (Dashboard Edit Mode)
     ============================================ */

  .dashboard-location-group {
      display: none; /* controlled by toggleEditMode */
      flex-direction: column;
      gap: 0.5rem;
  }

  .dashboard-location-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 1rem;
  }

  .dashboard-location-wrapper .form-input-dashboard {
      flex: 1;
      min-width: 0;
  }

  .dashboard-geolocation-btn {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      background: transparent;
      color: var(--fg);
      border: none;
      border-bottom: 3px solid var(--fg);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: border-color 0.2s ease, color 0.2s ease;
      padding: 0;
  }

  .dashboard-geolocation-btn:hover {
      border-color: var(--primary-blue);
      color: var(--primary-blue);
  }

  .dashboard-geolocation-btn.loading {
      animation: dashboard-pulse 1s ease-in-out infinite;
  }

  @keyframes dashboard-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
  }

  .dashboard-geolocation-btn svg {
      pointer-events: none;
  }

  .dashboard-location-hint {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--fg);
      opacity: 0.7;
      min-height: 1.2em;
      transition: all 0.3s ease;
  }
  ```

  En los **media queries existentes** de `@media (max-width: 768px)` agregar:

  ```css
  .dashboard-location-wrapper {
      flex-direction: column;
      align-items: stretch;
  }

  .dashboard-geolocation-btn {
      width: 100%;
      height: 44px;
      border: none;
      border-bottom: 3px solid var(--fg);
  }
  ```

- [ ] **Step 3: Verificar visualmente que no hay conflictos de nombres de clase**

  Buscar en `dashboard.css` si ya existe alguna clase con nombre `dashboard-location` o `dashboard-geolocation`:
  ```
  Grep: "dashboard-location|dashboard-geolocation" en dashboard.css
  ```
  Debe retornar vacío (no hay conflictos).

---

### Task 2: HTML — Restructurar el campo de ubicación y cargar Google Maps

**Files:**
- Modify: `public/artist/dashboard/index.html`

- [ ] **Step 1: Agregar el script de carga dinámica de Google Maps en el `<head>`**

  En `public/artist/dashboard/index.html`, luego de la línea:
  ```html
  <script src="/shared/js/logging-loader.js"></script>
  ```
  Agregar:

  ```html
  <!-- Google Maps Places API - Key configured in config-manager.js -->
  <script>
      // Define callback before loading the script
      window.initDashboardGooglePlaces = function() {
          // Will be overridden by dashboard.js once it loads
          // This prevents "callback not defined" errors from Google Maps
          if (window._dashboardPlacesReady) window._dashboardPlacesReady();
      };
      function loadDashboardGoogleMapsWhenReady() {
          if (window.CONFIG && window.CONFIG.googleMaps && window.CONFIG.googleMaps.apiKey) {
              const script = document.createElement('script');
              script.src = `https://maps.googleapis.com/maps/api/js?key=${window.CONFIG.googleMaps.apiKey}&libraries=places&loading=async&callback=initDashboardGooglePlaces`;
              script.async = true;
              document.head.appendChild(script);
          } else {
              if (!window._dashboardGMapsRetry) window._dashboardGMapsRetry = 0;
              window._dashboardGMapsRetry++;
              if (window._dashboardGMapsRetry < 50) {
                  setTimeout(loadDashboardGoogleMapsWhenReady, 100);
              }
          }
      }
      document.addEventListener('DOMContentLoaded', loadDashboardGoogleMapsWhenReady);
  </script>
  ```

- [ ] **Step 2: Reemplazar el campo de ubicación con el nuevo grupo**

  Localizar en `public/artist/dashboard/index.html` el bloque:
  ```html
  <!-- Location -->
  <div class="form-row">
      <label class="form-label">Ubicacion</label>
      <div class="form-value" id="display-location">-</div>
      <input type="text" class="form-input-dashboard" id="input-location" style="display: none;">
  </div>
  ```

  Reemplazarlo por:
  ```html
  <!-- Location -->
  <div class="form-row">
      <label class="form-label">Ubicacion</label>
      <div class="form-value" id="display-location">-</div>
      <div class="dashboard-location-group" id="location-input-group">
          <div class="dashboard-location-wrapper">
              <input type="text" class="form-input-dashboard" id="input-location"
                  placeholder="Ciudad, País" autocomplete="off">
              <button type="button" class="dashboard-geolocation-btn"
                  id="dashboard-geolocation-btn"
                  onclick="getDashboardGeolocation()"
                  aria-label="Detectar mi ubicación automáticamente"
                  title="Detectar ubicación">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                  </svg>
              </button>
          </div>
          <p class="dashboard-location-hint" id="dashboard-location-hint"></p>
      </div>
  </div>
  ```

  **Nota importante:** Se removió `style="display: none;"` del input porque ahora el grupo padre `#location-input-group` controla la visibilidad con `display: none` en CSS.

- [ ] **Step 3: Verificar que el HTML resultante es válido**

  Leer las líneas del bloque modificado en el HTML para confirmar que la estructura está correcta y no hay etiquetas sin cerrar.

---

### Task 3: JS — Funciones de autocomplete y geolocalización en dashboard.js

**Files:**
- Modify: `public/shared/js/dashboard.js`

- [ ] **Step 1: Leer el contexto al inicio de dashboard.js para entender las variables globales**

  Leer `dashboard.js` líneas 1-30 para identificar las variables globales declaradas al inicio y agregar `placesAutocompleteDashboard` ahí.

- [ ] **Step 2: Agregar variable global para el autocomplete**

  En el bloque de variables globales al inicio de `dashboard.js`, agregar:
  ```js
  let placesAutocompleteDashboard = null;
  ```

- [ ] **Step 3: Agregar función `initDashboardGooglePlaces`**

  Buscar en `dashboard.js` la función `toggleEditMode` y agregar ANTES de ella el siguiente bloque:

  ```js
  // ============================================
  // LOCATION AUTOCOMPLETE & GEOLOCATION
  // ============================================

  // Initialize Google Places Autocomplete on the location input
  // Called by Google Maps callback and also when entering edit mode
  function initDashboardGooglePlaces() {
      const locationInput = document.getElementById('input-location');
      if (!locationInput || typeof google === 'undefined' || !google.maps || !google.maps.places) return;
      if (placesAutocompleteDashboard) return; // already initialized

      placesAutocompleteDashboard = new google.maps.places.Autocomplete(locationInput, {
          types: ['geocode'],
          fields: ['formatted_address', 'address_components']
      });

      placesAutocompleteDashboard.addListener('place_changed', () => {
          const place = placesAutocompleteDashboard.getPlace();
          if (place && place.formatted_address) {
              locationInput.value = place.formatted_address;
          }
      });
  }

  // Override the global callback defined in the HTML <head>
  // This ensures the function is available once dashboard.js loads
  window.initDashboardGooglePlaces = function() {
      initDashboardGooglePlaces();
  };

  // Cross-platform geolocation with GPS + IP fallback
  function getDashboardGeolocation() {
      const btn = document.getElementById('dashboard-geolocation-btn');
      const hint = document.getElementById('dashboard-location-hint');
      const locationInput = document.getElementById('input-location');

      btn.classList.add('loading');
      hint.textContent = 'Obteniendo ubicación...';
      hint.style.color = 'var(--fg)';

      // Reverse geocode coordinates to "Localidad, Provincia, País"
      async function reverseGeocode(latitude, longitude) {
          if (typeof google === 'undefined' || !google.maps) return null;
          const geocoder = new google.maps.Geocoder();
          const response = await geocoder.geocode({
              location: { lat: latitude, lng: longitude }
          });
          if (!response.results || !response.results[0]) return null;

          const components = response.results[0].address_components;
          let locality = '', province = '', country = '';
          for (const comp of components) {
              const types = comp.types;
              if ((types.includes('locality') || types.includes('administrative_area_level_2')) && !locality) {
                  locality = comp.long_name;
              }
              if (types.includes('administrative_area_level_1')) {
                  province = comp.long_name;
              }
              if (types.includes('country')) {
                  country = comp.long_name;
              }
          }
          const parts = [locality, province, country].filter(p => p);
          return parts.length ? parts.join(', ') : response.results[0].formatted_address;
      }

      async function handleLocationSuccess(latitude, longitude) {
          try {
              const address = await reverseGeocode(latitude, longitude);
              if (address) {
                  locationInput.value = address;
                  hint.textContent = '¡Ubicación detectada!';
                  hint.style.color = '#4CAF50';
              } else {
                  hint.textContent = 'No se pudo determinar la dirección. Ingrésala manualmente.';
                  hint.style.color = 'var(--primary-red, #e53935)';
              }
          } catch (err) {
              hint.textContent = 'Error al obtener la dirección.';
              hint.style.color = 'var(--primary-red, #e53935)';
          }
          btn.classList.remove('loading');
      }

      // Fallback: IP-based geolocation (no GPS required)
      async function tryIPGeolocation() {
          try {
              const response = await fetch('https://ipapi.co/json/');
              if (!response.ok) throw new Error('IP geolocation failed');
              const data = await response.json();
              if (data.latitude && data.longitude) {
                  await handleLocationSuccess(data.latitude, data.longitude);
              } else {
                  throw new Error('No coordinates in IP response');
              }
          } catch (err) {
              btn.classList.remove('loading');
              hint.textContent = 'No se pudo obtener la ubicación. Ingrésala manualmente.';
              hint.style.color = 'var(--primary-red, #e53935)';
          }
      }

      // Layer 1: Browser GPS
      if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
              async (position) => {
                  await handleLocationSuccess(position.coords.latitude, position.coords.longitude);
              },
              async (error) => {
                  if (error.code === error.PERMISSION_DENIED) {
                      btn.classList.remove('loading');
                      hint.textContent = 'Permiso de ubicación denegado. Ingrésala manualmente.';
                      hint.style.color = 'var(--primary-red, #e53935)';
                      return;
                  }
                  // POSITION_UNAVAILABLE or TIMEOUT → try IP fallback
                  hint.textContent = 'Intentando método alternativo...';
                  await tryIPGeolocation();
              },
              { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
          );
      } else {
          // Layer 2: No GPS support → IP fallback directly
          tryIPGeolocation();
      }
  }
  ```

- [ ] **Step 4: Modificar `toggleEditMode` para manejar el grupo de ubicación**

  En la función `toggleEditMode`, localizar la línea:
  ```js
  const inputElements = document.querySelectorAll('.form-input-dashboard, .form-select-dashboard, .price-input-group, .toggle-switch');
  ```
  Reemplazarla por:
  ```js
  const inputElements = document.querySelectorAll('.form-input-dashboard, .form-select-dashboard, .price-input-group, .dashboard-location-group, .toggle-switch');
  ```

  Luego, dentro del forEach de `inputElements`, localizar el bloque:
  ```js
  } else if (el.id === 'price-input-group') {
      el.style.display = isEditMode ? 'flex' : 'none';
  } else {
  ```
  Y reemplazarlo por:
  ```js
  } else if (el.id === 'price-input-group') {
      el.style.display = isEditMode ? 'flex' : 'none';
  } else if (el.classList.contains('dashboard-location-group')) {
      el.style.display = isEditMode ? 'flex' : 'none';
      // Initialize Google Places when entering edit mode
      if (isEditMode) initDashboardGooglePlaces();
  } else {
  ```

  **¿Por qué aquí?** El `location-input-group` necesita `display: flex` (no `block`) para que el wrapper interior con el botón funcione correctamente. Y aprovechar la entrada a edit mode para inicializar el autocomplete garantiza que funcione incluso si Google Maps cargó después del DOMContentLoaded.

- [ ] **Step 5: Limpiar el hint cuando se cancela el modo edición**

  En la función `cancelEditMode` (línea ~582), agregar al inicio del bloque que cancela:
  ```js
  // Clear location hint when cancelling edit
  const locationHint = document.getElementById('dashboard-location-hint');
  if (locationHint) locationHint.textContent = '';
  ```

  Localizar `cancelEditMode`:
  ```js
  function cancelEditMode() {
      if (isEditMode) {
  ```
  Agregar la limpieza del hint dentro del `if (isEditMode)`.

- [ ] **Step 6: Verificar que no existe ninguna otra referencia a `input-location` con `style.display` hardcodeada**

  Buscar en `dashboard.js`:
  ```
  Grep: "input-location" en dashboard.js
  ```
  Solo deben aparecer las referencias a `.value` en `handleProfileSave` (línea ~891) y en la población de campos (línea ~295). Si hay alguna que setea `style.display`, removerla porque ahora lo controla el grupo padre.

---

### Task 4: Verificación final multiplataforma

**Files:**
- No code changes — solo verificación

- [ ] **Step 1: Verificar que el CSS de Google Places dropdown es compatible con el tema oscuro**

  Buscar en `dashboard.css` si ya existe algún override para `.pac-container` (el dropdown de Google Places):
  ```
  Grep: "pac-container|pac-item" en dashboard.css
  ```
  Si no existe y el dashboard tiene modo oscuro, agregar al final de los nuevos estilos CSS:
  ```css
  /* Google Places Autocomplete dropdown compatibility */
  .pac-container {
      font-family: 'Inter', sans-serif;
      border: 2px solid var(--fg);
      box-shadow: none;
      border-radius: 0;
  }

  .pac-item {
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
      cursor: pointer;
  }

  .pac-item:hover,
  .pac-item-selected {
      background-color: var(--fg);
      color: var(--bg);
  }
  ```

- [ ] **Step 2: Revisar el HTML final del dashboard para confirmar la estructura**

  Leer el bloque del `form-row` de ubicación en `dashboard/index.html` para confirmar:
  - El grupo `#location-input-group` tiene clase `dashboard-location-group`
  - El input `#input-location` NO tiene `style="display: none;"` inline
  - El botón tiene `id="dashboard-geolocation-btn"` y `onclick="getDashboardGeolocation()"`
  - El párrafo tiene `id="dashboard-location-hint"`

- [ ] **Step 3: Revisar dashboard.js para confirmar todas las funciones exportadas globalmente**

  Confirmar que en `dashboard.js` existe:
  - `window.initDashboardGooglePlaces = function() {...}`
  - `window.getDashboardGeolocation = getDashboardGeolocation` (asignación explícita a window)
  - Ambas funciones declaradas con `function`, no `const`

  **Importante:** Agregar también `window.getDashboardGeolocation = getDashboardGeolocation;` al final del bloque de autocomplete/geolocalización, inmediatamente después de `window.initDashboardGooglePlaces = function() {...};`. Esto garantiza que el `onclick="getDashboardGeolocation()"` del HTML funcione en cualquier contexto (incluso si en el futuro el archivo se convierte a módulo).

---

## Notas de implementación

### Por qué `display: flex` en el grupo
El wrapper interior `.dashboard-location-wrapper` usa flexbox para alinear el input y el botón. Si el grupo padre tuviera `display: block`, el flex del wrapper seguiría funcionando, pero el grupo propio no podría ser flex-item correctamente en su contexto.

### Por qué inicializar Places en `toggleEditMode` y no solo en el callback
Google Maps puede cargar antes o después que el usuario entre al modo edición. Inicializarlo en ambos lugares (callback + toggleEditMode) garantiza que el autocomplete funcione sin importar el orden de carga.

### Por qué no reutilizar `initGooglePlaces` de `register.js`
`register.js` no se carga en el dashboard. Además, esa función hace referencias a `formState` que no existe en dashboard. Se crea una función propia `initDashboardGooglePlaces` que es independiente.

### Compatibilidad iOS Safari
`navigator.geolocation` requiere HTTPS en iOS Safari. En producción ya se usa HTTPS, por lo que no hay problema. En desarrollo local (localhost) también funciona sin HTTPS en la mayoría de navegadores.
