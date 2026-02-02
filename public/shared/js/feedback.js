/* ============================================
   WE ÖTZI - FEEDBACK SYSTEM LOGIC
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    const feedbackTrigger = document.getElementById('feedback-trigger');
    const feedbackModal = document.getElementById('feedback-modal');
    const feedbackClose = document.querySelector('.feedback-close');
    const feedbackForm = document.getElementById('feedback-form');
    const statusMessage = document.getElementById('feedback-message-status');
    const submitBtn = feedbackForm.querySelector('.btn-feedback-submit');

    if (!feedbackTrigger || !feedbackModal || !feedbackForm) return;

    // --- MODAL CONTROL ---
    
    const openModal = () => {
        feedbackModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent scroll
    };

    const closeModal = () => {
        feedbackModal.classList.remove('active');
        document.body.style.overflow = '';
        resetForm();
    };

    feedbackTrigger.addEventListener('click', openModal);
    feedbackClose.addEventListener('click', closeModal);

    // Close on outside click
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) closeModal();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && feedbackModal.classList.contains('active')) closeModal();
    });

    const resetForm = () => {
        feedbackForm.reset();
        statusMessage.textContent = '';
        statusMessage.className = 'form-message';
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            Enviar Feedback
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
        `;
    };

    // --- FORM SUBMISSION ---

    feedbackForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const reason = document.getElementById('feedback-reason').value;
        const cause = document.getElementById('feedback-cause').value;
        const message = document.getElementById('feedback-message').value;

        if (!reason || !cause || !message) {
            showMessage('Por favor completa todos los campos', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Enviando...';

        try {
            // Get Supabase Client from ConfigManager
            const supabase = window.ConfigManager ? window.ConfigManager.getSupabaseClient() : null;
            
            if (!supabase) {
                throw new Error('Supabase no está configurado');
            }

            // Capture Metadata
            const metadata = {
                url: window.location.href,
                userAgent: navigator.userAgent,
                resolution: `${window.screen.width}x${window.screen.height}`,
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                timestamp: new Date().toISOString(),
                language: navigator.language
            };

            // Get User ID if available (from global state or auth)
            // In this app, we don't have a formal "logged in" user for clients, 
            // but we might have a quote_id in formData if script.js is loaded
            let user_id = null;
            let session_log_id = null;
            let user_email = null;
            let user_ip = null;
            
            if (window.formData && window.formData.quote_id) {
                metadata.quote_id = window.formData.quote_id;
            }

            // Get LoggingService data if available
            if (window.LoggingService?.isInitialized) {
                try {
                    // Persist current logs first
                    await window.LoggingService.persist();
                    
                    session_log_id = window.LoggingService.sessionLogId;
                    const identifiers = window.LoggingService.userIdentifiers;
                    user_id = identifiers.userId || null;
                    user_email = identifiers.email || null;
                    user_ip = identifiers.ip || null;
                    metadata.sessionId = window.LoggingService.sessionId;
                } catch (e) {
                    console.warn('Could not get logging service data:', e);
                }
            }

            const { error } = await supabase
                .from('feedback_tickets')
                .insert([
                    {
                        reason,
                        cause,
                        message,
                        metadata,
                        user_id: user_id,
                        session_log_id: session_log_id,
                        user_email: user_email,
                        user_ip: user_ip
                    }
                ]);

            if (error) throw error;

            showMessage('¡Gracias! Tu feedback ha sido enviado.', 'success');
            
            // Close after delay
            setTimeout(() => {
                closeModal();
            }, 2000);

        } catch (err) {
            console.error('Feedback error:', err);
            showMessage('Error al enviar. Intenta de nuevo.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Enviar Feedback';
        }
    });

    const showMessage = (text, type) => {
        statusMessage.textContent = text;
        statusMessage.className = `form-message ${type}`;
    };

    // --- FOOTER POSITIONING ---
    
    const updateButtonPosition = () => {
        // Try multiple footer selectors for compatibility
        const footer = document.querySelector('.bauhaus-footer') || 
                       document.querySelector('.dashboard-footer') || 
                       document.querySelector('footer');
        if (footer) {
            const footerHeight = footer.offsetHeight;
            document.documentElement.style.setProperty('--footer-height', `${footerHeight}px`);
        }
    };

    // Initial position calculation
    updateButtonPosition();

    // Update on resize
    window.addEventListener('resize', updateButtonPosition);

    // --- TOOLTIP AUTO-SHOW ---
    
    const tooltip = document.getElementById('feedback-tooltip');
    
    if (tooltip) {
        // Show tooltip after a brief delay on page load
        setTimeout(() => {
            tooltip.classList.add('visible');
            
            // Hide tooltip after 5 seconds
            setTimeout(() => {
                tooltip.classList.add('fade-out');
                
                // Remove classes after animation completes
                setTimeout(() => {
                    tooltip.classList.remove('visible', 'fade-out');
                }, 300);
            }, 5000);
        }, 1000);
    }
});
