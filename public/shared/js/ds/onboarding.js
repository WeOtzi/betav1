// Shared public onboarding shell, using the product's brand primitives.
// Pasos con ✓ (is-done) como el registro de artistas rediseñado; el wizard
// marca el paso actual con aria-current="step" y los completos con .is-done.
// Pie con los documentos legales reales (/legal/privacy/ y /legal/terms/).
(function () {
    'use strict';
    const base = () => window.WEOTZI_BASE_PATH || (location.pathname.startsWith('/beta/') ? '/beta' : '');
    class OnboardingHeader extends HTMLElement {
        connectedCallback() {
            if (this.childElementCount) return;
            const steps = ['Cuenta', 'Identidad', 'Sedes', 'Fotos', 'Confirmar'];
            this.innerHTML = '<header class="wo-topbar wo-onboarding-header">' +
                '<a class="wo-topbar-brand" href="/inicio/" aria-label="We Ötzi, inicio"><span class="wo-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>WE ÖTZI</a>' +
                '<nav class="wo-onboarding-nav" aria-label="Progreso del registro">' + steps.map((label, i) => '<button type="button" data-go-step="' + (i + 1) + '"><span class="wo-onboarding-check" aria-hidden="true"></span>' + String(i + 1).padStart(2, '0') + ' ' + label + '<span class="wo-onboarding-done-label"> (completo)</span></button>').join('') + '</nav>' +
                '<button type="button" class="wo-btn wo-btn--secondary wo-onboarding-menu" aria-expanded="false" aria-controls="onboarding-menu">Menú</button></header>' +
                '<nav id="onboarding-menu" class="wo-onboarding-mobile-menu" aria-label="Menú de registro" hidden><a class="wo-btn wo-btn--secondary" href="/studio/login/">Ingresar</a><button type="button" class="wo-btn wo-btn--secondary" data-close-menu>Cerrar menú</button></nav>';
            const toggle = this.querySelector('.wo-onboarding-menu');
            const menu = this.querySelector('#onboarding-menu');
            this.querySelectorAll('a[href^="/"]').forEach(link => { link.href = base() + link.getAttribute('href'); });
            const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
            toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
            this.querySelector('[data-close-menu]').addEventListener('click', () => { close(); toggle.focus(); });
            this.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
        }
    }
    class OnboardingFooter extends HTMLElement {
        connectedCallback() {
            if (this.childElementCount) return;
            this.innerHTML = '<footer class="wo-onboarding-footer"><strong>WE ÖTZI</strong><a href="https://weotzi.com/faqs/" target="_blank" rel="noopener">Centro de ayuda</a>' +
                '<span><a href="/legal/privacy/" target="_blank" rel="noopener">Privacidad</a> · <a href="/legal/terms/" target="_blank" rel="noopener">Términos y condiciones</a></span></footer>';
            this.querySelectorAll('a[href^="/"]').forEach(link => { link.href = base() + link.getAttribute('href'); });
        }
    }
    if (!customElements.get('weotzi-onboarding-header')) customElements.define('weotzi-onboarding-header', OnboardingHeader);
    if (!customElements.get('weotzi-onboarding-footer')) customElements.define('weotzi-onboarding-footer', OnboardingFooter);
})();
