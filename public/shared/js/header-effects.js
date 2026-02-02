/**
 * We Ötzi Header Scroll Effects
 * Creative Bauhaus "Deconstruction" animation on scroll
 */

class HeaderScrollManager {
    constructor() {
        this.header = document.querySelector('.top-nav-header');
        this.lastScrollY = window.scrollY;
        this.ticking = false;
        this.threshold = 50; // Minimum scroll before hiding
        
        if (this.header) {
            this.init();
        }
    }

    init() {
        // Initial state
        this.header.classList.add('header-visible');
        
        window.addEventListener('scroll', () => {
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.updateHeader();
                    this.ticking = false;
                });
                this.ticking = true;
            }
        }, { passive: true });
    }

    updateHeader() {
        const currentScrollY = window.scrollY;
        
        // Don't do anything if we haven't scrolled much (prevents flickering on mobile)
        if (Math.abs(currentScrollY - this.lastScrollY) < 5) return;

        if (currentScrollY > this.lastScrollY && currentScrollY > this.threshold) {
            // Scrolling DOWN - Hide
            if (this.header.classList.contains('header-visible')) {
                this.header.classList.remove('header-visible');
                this.header.classList.add('header-hidden');
            }
        } else if (currentScrollY < this.lastScrollY) {
            // Scrolling UP - Show
            if (this.header.classList.contains('header-hidden')) {
                this.header.classList.remove('header-hidden');
                this.header.classList.add('header-visible');
            }
        }

        // Always show if at the very top
        if (currentScrollY <= 0) {
            this.header.classList.remove('header-hidden');
            this.header.classList.add('header-visible');
        }

        this.lastScrollY = currentScrollY;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.headerScrollManager = new HeaderScrollManager();
});
