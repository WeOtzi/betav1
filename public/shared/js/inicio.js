/* Selection stays local to the page; destinations retain the existing routes. */
(function () {
    'use strict';
    var choices = document.querySelectorAll('.inicio-choice');
    var continueLink = document.querySelector('.inicio-continue');
    function updateDestination() {
        var selected = document.querySelector('.inicio-choice:checked');
        if (selected) continueLink.setAttribute('href', selected.dataset.destination);
    }
    choices.forEach(function (choice) { choice.addEventListener('change', updateDestination); });
    updateDestination();
}());
