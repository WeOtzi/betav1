(function () {
    const FOOTER_STYLE_ID = 'bauhaus-footer-component-style';

    const SOCIAL_CATALOG = {
        instagram: {
            href: 'https://instagram.com/weotzi',
            label: 'Instagram',
            icon: `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
            `
        },
        tiktok: {
            href: 'https://tiktok.com/@weotzi',
            label: 'TikTok',
            icon: `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
                </svg>
            `
        },
        x: {
            href: 'https://twitter.com/weotzi',
            label: 'X/Twitter',
            icon: `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M4 4l11.733 16h4.267l-11.733-16zM4 20l6.4-8M20 4l-6.4 8" />
                </svg>
            `
        },
        youtube: {
            href: 'https://youtube.com/@weotzi',
            label: 'YouTube',
            icon: `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
                    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
                </svg>
            `
        }
    };

    const FOOTER_VARIANTS = {
        dashboard: {
            text: 'Hecho con amor por We Ötzi, para artistas.',
            copyright: '© 2025 We Ötzi. Todos los derechos reservados.',
            social: ['instagram', 'tiktok', 'x', 'youtube']
        },
        profilePublic: {
            text: 'Hecho con amor por We Ötzi, para artistas.',
            copyright: '© 2025 We Ötzi. Todos los derechos reservados.',
            social: ['instagram', 'tiktok', 'x', 'youtube']
        }
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getVariantConfig(node) {
        const variant = node.dataset.footerVariant || 'dashboard';
        return FOOTER_VARIANTS[variant] || FOOTER_VARIANTS.dashboard;
    }

    function getSocialItems(node, variantConfig) {
        const socialCsv = node.dataset.footerSocial || variantConfig.social.join(',');
        return socialCsv
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((key) => SOCIAL_CATALOG[key])
            .filter(Boolean);
    }

    function renderFooter(node) {
        if (!node) return;
        const variantConfig = getVariantConfig(node);
        const text = node.dataset.footerText || variantConfig.text;
        const copyright = node.dataset.footerCopyright || variantConfig.copyright;
        const socialItems = getSocialItems(node, variantConfig);

        node.classList.add('bauhaus-footer', 'bauhaus-footer-component');
        if (node.dataset.footerWidth !== 'contained') {
            node.classList.add('bauhaus-footer--full-width');
        }

        const socialHtml = socialItems.map((item) => `
            <a href="${escapeHtml(item.href)}" target="_blank" rel="noopener" aria-label="${escapeHtml(item.label)}" class="social-icon">
                ${item.icon}
            </a>
        `).join('');

        node.innerHTML = `
            <div class="footer-content">
                <p class="footer-text">${escapeHtml(text)}</p>
                <div class="footer-social">${socialHtml}</div>
                <p class="footer-copyright">${escapeHtml(copyright)}</p>
            </div>
        `;
    }

    function initBauhausFooterComponent() {
        injectFooterStyle();
        document.querySelectorAll('footer.bauhaus-footer, [data-bauhaus-footer]').forEach((node) => {
            renderFooter(node);
        });
    }

    function injectFooterStyle() {
        if (document.getElementById(FOOTER_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = FOOTER_STYLE_ID;
        style.textContent = `
            .bauhaus-footer.bauhaus-footer-component {
                position: relative !important;
                left: 0 !important;
                right: 0 !important;
                width: 100vw !important;
                max-width: 100vw !important;
                margin-left: calc(50% - 50vw) !important;
                margin-right: calc(50% - 50vw) !important;
                margin-top: auto !important;
                margin-bottom: 0 !important;
                padding: 0.6rem 1.5rem !important;
                border: 0 !important;
                border-top: 2px solid #ffffff !important;
                background: #060606 !important;
                color: #ffffff !important;
                z-index: 50 !important;
                box-sizing: border-box !important;
            }

            .bauhaus-footer.bauhaus-footer-component .footer-content {
                width: 100% !important;
                max-width: 1600px !important;
                margin: 0 auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 1.15rem !important;
                flex-wrap: nowrap !important;
                box-sizing: border-box !important;
                text-align: center !important;
            }

            .bauhaus-footer.bauhaus-footer-component .footer-text,
            .bauhaus-footer.bauhaus-footer-component .footer-copyright {
                font-family: "JetBrains Mono", monospace !important;
                font-size: 0.7rem !important;
                font-weight: 700 !important;
                letter-spacing: 0.05em !important;
                text-transform: uppercase !important;
                color: #ffffff !important;
                white-space: nowrap !important;
                margin: 0 !important;
            }

            .bauhaus-footer.bauhaus-footer-component .footer-copyright {
                opacity: 0.82 !important;
            }

            .bauhaus-footer.bauhaus-footer-component .footer-social {
                display: flex !important;
                align-items: center !important;
                gap: 0.5rem !important;
                flex-shrink: 0 !important;
            }

            .bauhaus-footer.bauhaus-footer-component .social-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 28px !important;
                height: 28px !important;
                color: #ffffff !important;
                transition: transform 0.18s ease, color 0.18s ease !important;
                text-decoration: none !important;
            }

            .bauhaus-footer.bauhaus-footer-component .social-icon:hover,
            .bauhaus-footer.bauhaus-footer-component .social-icon:focus-visible {
                color: #f2b705 !important;
                transform: translateY(-2px) !important;
                outline: none !important;
            }

            .bauhaus-footer.bauhaus-footer-component .social-icon svg {
                width: 16px !important;
                height: 16px !important;
            }

            @media (max-width: 768px) {
                .bauhaus-footer.bauhaus-footer-component {
                    padding: 0.5rem 1rem !important;
                }

                .bauhaus-footer.bauhaus-footer-component .footer-content {
                    flex-direction: column !important;
                    justify-content: flex-start !important;
                    align-items: center !important;
                    text-align: center !important;
                    flex-wrap: nowrap !important;
                    gap: 0.55rem !important;
                }

                .bauhaus-footer.bauhaus-footer-component .footer-text,
                .bauhaus-footer.bauhaus-footer-component .footer-copyright {
                    font-size: 0.6rem !important;
                }

                .bauhaus-footer.bauhaus-footer-component .footer-social {
                    order: -1 !important;
                    margin-bottom: 0.15rem !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    window.BauhausFooter = {
        render: renderFooter,
        init: initBauhausFooterComponent
    };

    document.addEventListener('DOMContentLoaded', initBauhausFooterComponent);
})();
