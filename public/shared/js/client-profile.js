(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    const _supabase = window._supabase = window._supabase || window.supabase.createClient(supabaseUrl, supabaseKey);

    document.addEventListener('DOMContentLoaded', loadClientProfile);

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function initials(name) {
        return String(name || 'C')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || '')
            .join('') || 'C';
    }

    async function loadClientProfile() {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('client') || params.get('u') || params.get('id');
        const errorEl = document.getElementById('client-public-error');
        const hero = document.getElementById('client-public-hero');

        if (!ref) {
            errorEl.textContent = 'Falta el parametro ?client=alias';
            return;
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
        let query = _supabase.from('client_public_profiles').select('*');
        query = isUuid ? query.eq('user_id', ref) : query.eq('public_username', ref.replace(/^@+/, ''));

        const { data: profile, error } = await query.maybeSingle();

        if (error || !profile) {
            errorEl.textContent = 'Cliente no encontrado o perfil no publico.';
            return;
        }

        const name = profile.public_username || 'Cliente';
        document.title = `${name} | We Otzi`;
        document.getElementById('client-public-name').textContent = `@${name}`;
        document.getElementById('client-public-meta').textContent = [profile.country, profile.city_residence].filter(Boolean).join(' · ') || 'Pais no indicado';
        const avatarEl = document.getElementById('client-public-avatar');
        avatarEl.innerHTML = profile.profile_picture
            ? `<img src="${escapeHtml(profile.profile_picture)}" alt="">`
            : `<span>${escapeHtml(initials(name))}</span>`;

        errorEl.hidden = true;
        hero.hidden = false;

        if (window.WeOtziReviews) {
            window.WeOtziReviews.renderPublicReviews({
                mount: 'client-reviews',
                revieweeType: 'client',
                revieweeId: profile.user_id,
                title: 'Resenas del cliente'
            });
        }
    }
})();
