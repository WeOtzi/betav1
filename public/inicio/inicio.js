(() => {
    'use strict';

    // Revisión 12/11 (p. 1): la tarjeta elegida pasa al centro y las otras
    // quedan más chicas a los costados, en su orden original. Sin elección se
    // conserva el orden del Figma (cliente · artista · estudio).
    const DEFAULT_ORDER = ['client', 'artist', 'studio'];

    function layoutFor(selected) {
        if (!DEFAULT_ORDER.includes(selected)) return DEFAULT_ORDER.slice();
        const rest = DEFAULT_ORDER.filter((value) => value !== selected);
        return [rest[0], selected, rest[1]];
    }

    const root = typeof window !== 'undefined' ? window : globalThis;
    root.WoInicio = { DEFAULT_ORDER, layoutFor };

    if (typeof document === 'undefined' || !document.querySelector) return;

    const selection = document.querySelector('#inicio-selection');
    const deck = document.querySelector('#inicio-cards');
    if (!selection || !deck) return;

    const cards = Array.from(deck.querySelectorAll('.inicio-card[data-experience]'));
    const reduceMotion = typeof root.matchMedia === 'function'
        ? root.matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false };

    function currentValue() {
        const checked = selection.querySelector('.inicio-radio:checked');
        return checked ? checked.value : '';
    }

    // FLIP: se mide la posición de layout (offsetLeft/Top no incluyen la
    // escala) antes y después de reordenar, y se anima el desvío con la
    // propiedad `translate`, que se compone con la `scale` del CSS.
    function apply(selected, animate) {
        const before = new Map(cards.map((card) => [card, { x: card.offsetLeft, y: card.offsetTop }]));
        const order = layoutFor(selected);
        cards.forEach((card) => {
            card.dataset.pos = String(order.indexOf(card.dataset.experience));
        });
        deck.classList.toggle('has-selection', Boolean(selected));

        if (!animate || reduceMotion.matches || typeof Element === 'undefined' || !Element.prototype.animate) return;
        cards.forEach((card) => {
            const from = before.get(card);
            const dx = from.x - card.offsetLeft;
            const dy = from.y - card.offsetTop;
            if (!dx && !dy) return;
            card.animate(
                [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
                { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)' }
            );
        });
    }

    selection.addEventListener('change', () => apply(currentValue(), true));
    // El navegador puede restaurar el radio al volver atrás (bfcache).
    root.addEventListener('pageshow', () => apply(currentValue(), false));
    apply(currentValue(), false);
})();
