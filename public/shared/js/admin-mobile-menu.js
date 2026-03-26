// ============================================
// WE OTZI - Admin Panel Mobile Menu
// ============================================

(() => {
    const MOBILE_BREAKPOINT = 768;

    function setAdminMobileMenuOpen(isOpen) {
        const toggleBtn = document.getElementById('admin-mobile-menu-toggle');
        const menu = document.getElementById('admin-mobile-menu');
        if (!toggleBtn || !menu) return;

        const shouldOpen = Boolean(isOpen);
        menu.hidden = !shouldOpen;
        toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
    }

    function setupAdminMobileMenu() {
        const toggleBtn = document.getElementById('admin-mobile-menu-toggle');
        const menu = document.getElementById('admin-mobile-menu');
        if (!toggleBtn || !menu) return;

        setAdminMobileMenuOpen(false);

        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const shouldOpen = toggleBtn.getAttribute('aria-expanded') !== 'true';
            setAdminMobileMenuOpen(shouldOpen);
        });

        menu.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                setAdminMobileMenuOpen(false);
            });
        });

        document.addEventListener('click', (event) => {
            if (menu.hidden) return;
            if (menu.contains(event.target)) return;
            if (toggleBtn.contains(event.target)) return;
            setAdminMobileMenuOpen(false);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setAdminMobileMenuOpen(false);
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > MOBILE_BREAKPOINT) {
                setAdminMobileMenuOpen(false);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', setupAdminMobileMenu);
})();
