'use strict';

// ── perfil ── Eventos de email del frente "perfil" (ronda 2).
//
// artist_most_wanted_awarded: aviso al artista cuando su perfil gana la
// insignia Most Wanted de su zona. Lo envía solo el servidor
// (lib/routes/perfil.js, después de recalcular), una vez por racha: si sale
// del top y vuelve a entrar, se le avisa de nuevo. Nunca incluye conteos de
// otros perfiles.

module.exports = {
    artist_most_wanted_awarded: {
        name: 'Artista: perfil Most Wanted',
        description: 'Aviso al artista cuando su perfil entra al top de tendencia de su zona y gana la insignia Most Wanted.',
        templateHint: 'artist-most-wanted',
        serverOnly: true,
        recipient: p => p.artist_email,
        attribs: p => ({
            artist_name: p.artist_name || 'Artista',
            zone_label: p.zone_label || '',
            rank: p.rank || '',
            profile_url: p.profile_url || ''
        }),
        render: {
            audience: 'artist',
            category: 'account',
            subject: d => (d.zone_label ? `Tu perfil es Most Wanted en ${d.zone_label}` : 'Tu perfil es Most Wanted'),
            preheader: () => 'Tu perfil está entre los más buscados de tu zona. Compártelo y aprovecha el impulso.',
            eyebrow: 'MOST WANTED',
            headline: () => 'Tu perfil está en tendencia',
            intro: d => `${d.zone_label ? `Estás entre los perfiles más buscados de ${d.zone_label}` : 'Estás entre los perfiles más buscados de tu zona'} en los últimos 30 días. Desde hoy tu perfil público muestra la insignia Most Wanted. La calculamos con las visitas a tu perfil, las cotizaciones que recibes, las veces que te guardan en favoritos, las veces que se comparte tu perfil y tus trabajos completados.`,
            rows: d => [
                ['Zona', d.zone_label || ''],
                ['Puesto', d.rank ? `N.º ${d.rank}` : '']
            ],
            cta: (d, ctx) => ({ label: 'Ver mi perfil', url: ctx.f.url(d.profile_url) || ctx.url('/artist/dashboard') })
        }
    }
};
