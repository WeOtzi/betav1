(() => {
    'use strict';
    const selection = document.querySelector('#inicio-selection');
    const next = document.querySelector('#inicio-continue');
    function updateDestination() {
        const destinations = { client: '/marketplace/', studio: '/studio/register/' };
        next.setAttribute('href', destinations[selection.elements.experience.value] || '/artist/login/');
    }
    selection.addEventListener('change', updateDestination);
    updateDestination();
})();
