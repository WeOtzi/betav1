/* register-nav-header.js
   Mobile drawer behaviour for the Bauhaus nav header used on /register-artist/
   and /registerclosedbeta/. Also provides a fallback login-modal handler for
   pages that do not load main.js (e.g. register-artist), reusing the _supabase
   client exposed at the global script scope. */

(function () {
    'use strict';

    function initDrawer() {
        const burger = document.querySelector('.rnh-burger');
        const drawer = document.querySelector('.rnh-drawer');
        const backdrop = document.querySelector('.rnh-drawer-backdrop');
        if (!burger || !drawer) return;

        function setOpen(open) {
            burger.setAttribute('aria-expanded', String(open));
            drawer.setAttribute('aria-hidden', String(!open));
            if (backdrop) backdrop.setAttribute('aria-hidden', String(!open));
            document.body.style.overflow = open ? 'hidden' : '';
        }

        setOpen(false);

        burger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = burger.getAttribute('aria-expanded') === 'true';
            setOpen(!isOpen);
        });

        drawer.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => setOpen(false));
        });

        if (backdrop) {
            backdrop.addEventListener('click', () => setOpen(false));
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
                setOpen(false);
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) setOpen(false);
        });
    }

    function initFallbackLoginModal() {
        // Only define if main.js has not already provided these handlers.
        // Keeps /register-artist/ consistent with the registerclosedbeta flow
        // (which redirects to /artist/login/ instead of opening a modal).
        if (typeof window.openLoginModal === 'function') return;

        window.openLoginModal = function openLoginModal() {
            const params = new URLSearchParams();
            const currentReturnTo = new URLSearchParams(window.location.search).get('returnTo');
            if (currentReturnTo) params.set('returnTo', currentReturnTo);
            const query = params.toString();
            window.location.href = '/artist/login' + (query ? '?' + query : '');
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initDrawer();
            initFallbackLoginModal();
        });
    } else {
        initDrawer();
        initFallbackLoginModal();
    }
})();
