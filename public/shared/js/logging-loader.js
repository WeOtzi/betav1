/* ============================================
   WE OTZI - LOGGING SYSTEM LOADER
   Single script to load all logging components
   ============================================ */

(function() {
    'use strict';

    // Load pako for compression (only if not already loaded)
    if (typeof pako === 'undefined') {
        const pakoScript = document.createElement('script');
        pakoScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
        pakoScript.async = false;
        document.head.appendChild(pakoScript);
    }

    // Load Logging Service
    const loggingScript = document.createElement('script');
    loggingScript.src = '/shared/js/logging-service.js';
    loggingScript.async = false;
    document.head.appendChild(loggingScript);

    // Load Error Reporter
    const errorReporterScript = document.createElement('script');
    errorReporterScript.src = '/shared/js/error-reporter.js';
    errorReporterScript.async = false;
    document.head.appendChild(errorReporterScript);

    // Log that the logging system was loaded
    loggingScript.onload = function() {
        if (window.LoggingService) {
            console.log('[LoggingLoader] Logging system initialized');
        }
    };
})();
