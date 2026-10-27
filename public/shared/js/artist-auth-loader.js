/** Pantalla de transición exclusiva del acceso y recuperación de artistas. */
(function () {
    'use strict';

    let redirectPending = false;

    function show({ targetUrl, delayMs = 1400 } = {}) {
        let screen = document.querySelector('.artist-auth-loader');
        if (!screen) {
            screen = document.createElement('div');
            screen.className = 'artist-auth-loader';
            screen.setAttribute('role', 'status');
            screen.setAttribute('aria-live', 'polite');
            screen.innerHTML =
                '<div class="artist-auth-loader__content">' +
                    '<span class="artist-auth-loader__spinner" aria-hidden="true"></span>' +
                    '<div class="artist-auth-loader__brand" aria-label="WE ÖTZI">' +
                        '<span class="wo-marks" aria-hidden="true">' +
                            '<span class="wo-mark-square"></span><span class="wo-mark-circle"></span><span class="wo-mark-triangle"></span>' +
                        '</span>' +
                        '<span class="artist-auth-loader__name" aria-hidden="true">WE ÖTZI</span>' +
                    '</div>' +
                    '<p class="artist-auth-loader__caption">Organizando tu agenda…</p>' +
                '</div>';
            document.body.appendChild(screen);
        }
        if (targetUrl && !redirectPending) {
            redirectPending = true;
            window.setTimeout(() => { window.location.href = targetUrl; }, delayMs);
        }
        return screen;
    }

    window.ArtistAuthLoader = { show };
})();
