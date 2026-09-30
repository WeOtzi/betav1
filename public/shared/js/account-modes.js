(function () {
    'use strict';
    function applicationPath() {
        const base = String(window.WEOTZI_BASE_PATH || '').replace(/\/$/, '');
        const pathname = window.location.pathname;
        return base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname;
    }
    async function sessionClient() {
        await window.ConfigManager?.ready?.();
        return window._supabase || window.ConfigManager?.getSupabaseClient?.();
    }
    async function activate(mode) {
        const client = await sessionClient();
        const { data } = await client.auth.getSession();
        if (!data.session) { window.location.href = '/client/login'; return; }
        const response = await fetch('/api/account/mode', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({mode})});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No pudimos cambiar de modo.');
        localStorage.setItem('weotzi_active_mode',mode);
        window.location.href = result.url;
    }
    window.WeotziAccountModes = { activate };
    let mounting = false;
    async function mount() {
        if (mounting || document.querySelector('[data-account-mode-switch]')) return;
        const selector = '.wo-org-product-nav__account, .client-topbar .wo-topbar-right, .cpa-topbar .wo-topbar-right, header .wo-topbar-right';
        if (!document.querySelector(selector)) return;
        mounting = true;
        try {
            const client = await sessionClient();
            if (!client) return;
            const {data} = await client.auth.getSession();
            if (!data.session || document.querySelector('[data-account-mode-switch]')) return;
            const target = document.querySelector(selector);
            if (!target) return;
            const mode = /^\/client(?:\/|$)/.test(applicationPath()) ? 'artist' : 'client';
            const button = document.createElement('button');
            button.type='button'; button.dataset.accountModeSwitch=mode;
            button.className='wo-btn wo-btn--ghost wo-btn--s';
            button.textContent=mode==='client' ? 'Modo cliente' : 'Modo tatuador';
            button.style.cssText='font:inherit;font-size:12px;white-space:nowrap;padding:8px;border:1px solid currentColor;cursor:pointer;background:transparent;color:inherit';
            button.addEventListener('click',async()=>{button.disabled=true;try{await activate(mode);}catch(e){button.disabled=false;const msg=document.createElement('p');msg.setAttribute('role','alert');msg.textContent=e.message;target.append(msg);}});
            target.prepend(button);
        } catch(e) { console.warn('[account-mode] No se pudo cargar el selector.'); }
        finally { mounting = false; }
    }
    function start() {
        if (/^\/client(?:\/|$)/.test(applicationPath())) {
            const style = document.createElement('style');
            style.textContent='@media(max-width:600px){.wo-topbar{flex-wrap:wrap;gap:8px}.wo-topbar-right{gap:8px;max-width:100%;flex-wrap:wrap}.client-suggested-grid{grid-template-columns:minmax(0,1fr)}.client-suggested-card{min-width:0}}';
            document.head.appendChild(style);
        }
        void mount(); new MutationObserver(()=>{void mount();}).observe(document.body,{childList:true,subtree:true});
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
