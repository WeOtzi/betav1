// Shared public onboarding shell, using the product's brand primitives.
(function () {
    'use strict';
    class OnboardingHeader extends HTMLElement {
        connectedCallback() {
            if (this.childElementCount) return;
            const steps = ['Cuenta', 'Identidad', 'Sedes', 'Fotos', 'Confirmar'];
            this.innerHTML = '<header class="wo-topbar wo-onboarding-header">' +
                '<a class="wo-topbar-brand" href="/inicio/" aria-label="We Ötzi, inicio"><span class="wo-marks" aria-hidden="true"><span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span></span>WE ÖTZI</a>' +
                '<nav class="wo-onboarding-nav" aria-label="Progreso del registro">' + steps.map((label, i) => '<button type="button" data-go-step="' + (i + 1) + '">' + String(i + 1).padStart(2, '0') + ' ' + label + '</button>').join('') + '</nav>' +
                '<button type="button" class="wo-btn wo-btn--secondary wo-onboarding-menu" aria-expanded="false" aria-controls="onboarding-menu">Menú</button></header>' +
                '<nav id="onboarding-menu" class="wo-onboarding-mobile-menu" aria-label="Menú de registro" hidden><a class="wo-btn wo-btn--secondary" href="/studio/login/">Ingresar</a><button type="button" class="wo-btn wo-btn--secondary" data-close-menu>Cerrar menú</button></nav>';
            const toggle = this.querySelector('.wo-onboarding-menu');
            const menu = this.querySelector('#onboarding-menu');
            this.querySelectorAll('a[href^="/"]').forEach(link => { link.href = (window.WEOTZI_BASE_PATH || (location.pathname.startsWith('/beta/') ? '/beta' : '')) + link.getAttribute('href'); });
            const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
            toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
            this.querySelector('[data-close-menu]').addEventListener('click', () => { close(); toggle.focus(); });
            this.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
        }
    }
    class OnboardingFooter extends HTMLElement {
        connectedCallback() {
            this.innerHTML = '<footer class="wo-onboarding-footer"><strong>WE ÖTZI</strong><a href="https://weotzi.com/faqs/" target="_blank" rel="noopener">Centro de ayuda</a><span><button type="button" data-document="Privacidad">Privacidad</button> · <button type="button" data-document="Términos y condiciones">Términos y condiciones</button></span></footer><dialog class="wo-onboarding-dialog" aria-labelledby="onboarding-dialog-title"><h2 id="onboarding-dialog-title"></h2><p>Este documento todavía no está disponible en la aplicación.</p><form method="dialog"><button class="wo-btn wo-btn--secondary">Cerrar</button></form></dialog>';
            this.querySelectorAll('[data-document]').forEach(button => button.addEventListener('click', () => {
                this.querySelector('h2').textContent = button.dataset.document;
                this.querySelector('dialog').showModal();
            }));
        }
    }
    if (!customElements.get('weotzi-onboarding-header')) customElements.define('weotzi-onboarding-header', OnboardingHeader);
    if (!customElements.get('weotzi-onboarding-footer')) customElements.define('weotzi-onboarding-footer', OnboardingFooter);
})();
