(function () {
    'use strict';

    const menuButton = document.querySelector('.menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');

    if (!menuButton || !mobileMenu) return;

    function setMenu(open) {
        menuButton.setAttribute('aria-expanded', String(open));
        menuButton.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
        mobileMenu.classList.toggle('is-open', open);
    }

    menuButton.addEventListener('click', function () {
        setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });

    mobileMenu.addEventListener('click', function (event) {
        if (event.target.closest('a')) setMenu(false);
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') setMenu(false);
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > 960) setMenu(false);
    });
})();
