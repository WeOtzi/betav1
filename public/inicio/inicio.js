(() => {
    'use strict';
    const selection = document.querySelector('#inicio-selection');
    const next = document.querySelector('#inicio-continue');
    function updateDestination() {
        next.setAttribute('href', selection.elements.experience.value === 'client' ? '/marketplace/' : '/artist/login/');
    }
    selection.addEventListener('change', updateDestination);
    updateDestination();
})();
