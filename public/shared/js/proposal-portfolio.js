/**
 * WE ÖTZI - Adjunto de portfolio en la propuesta del Job Board (801:1068/1073)
 * ---------------------------------------------------------------------------
 * job_board_applications.portfolio_links se llena al enviar la propuesta con
 * el mismo criterio que spots: el perfil público del artista primero ("Portfolio
 * en We Ötzi" en /artist/applications) y, si tiene, su sitio web
 * (artists_db.portafolio). No se adjuntan fotos sueltas de la galería: las
 * importadas de Instagram pueden estar ocultas hasta validar la cuenta.
 * UMD: window.WoProposalPortfolio en el navegador, require() en los tests.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WoProposalPortfolio = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function httpUrl(value) {
        var raw = String(value || '').trim();
        if (!raw || (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))) return '';
        try {
            var url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
            return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.indexOf('.') > 0 ? url.href : '';
        } catch (e) { return ''; }
    }

    /**
     * @param {{username?:string, portafolio?:string}} artist
     * @param {string} origin    p. ej. https://beta.weotzi.com
     * @param {string} [basePath] p. ej. /beta
     * @returns {string[]}
     */
    function buildLinks(artist, origin, basePath) {
        var links = [];
        var username = String((artist && artist.username) || '').trim();
        var base = String(basePath || '').replace(/\/$/, '');
        var host = String(origin || '').replace(/\/$/, '');
        if (username && /^https?:\/\//i.test(host)) {
            links.push(host + base + '/artist/profile?artist=' + encodeURIComponent(username));
        }
        var site = httpUrl(artist && artist.portafolio);
        if (site && links.indexOf(site) < 0) links.push(site);
        return links;
    }

    return { buildLinks: buildLinks };
});
