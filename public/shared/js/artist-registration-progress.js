(function (root, factory) {
    const exported = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }

    if (root) {
        root.ArtistRegistrationProgress = exported;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function hasText(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function hasArrayValues(value) {
        return Array.isArray(value) && value.some(item => hasText(String(item)));
    }

    function normalizeUsername(username) {
        const value = String(username || '').trim();
        if (!value) return '';
        return value.replace(/\.wo$/i, '').trim();
    }

    function normalizeEmailPrefix(email) {
        const localPart = String(email || '').trim().split('@')[0] || '';
        return localPart.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isBootstrapName(name) {
        return String(name || '').trim().toLowerCase() === 'artista';
    }

    function isBootstrapUsername(artist) {
        const username = normalizeUsername(artist?.username).toLowerCase();
        if (!username) return false;

        const emailPrefix = normalizeEmailPrefix(artist?.email);
        if (!emailPrefix) return false;

        return isBootstrapName(artist?.name) && username === emailPrefix;
    }

    function hasPortfolioData(artist) {
        return hasText(artist?.instagram) || hasText(artist?.portafolio);
    }

    function hasWorkTypeData(artist) {
        return hasText(artist?.work_type) || hasText(artist?.estudios);
    }

    function hasNewsletterSelection(artist) {
        return typeof artist?.subscribed_newsletter === 'boolean';
    }

    function toInteger(value) {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isInteger(parsed) ? parsed : null;
    }

    const STEP_DEFINITIONS = [
        {
            step: 1,
            label: 'Nombre artistico',
            required: true,
            isDone: (artist) => {
                const username = normalizeUsername(artist?.username);
                return hasText(username) && !isBootstrapUsername(artist);
            }
        },
        {
            step: 2,
            label: 'Nombre completo',
            required: true,
            isDone: (artist) => hasText(artist?.name) && !isBootstrapName(artist?.name)
        },
        {
            step: 3,
            label: 'Email',
            required: true,
            isDone: (artist) => hasText(artist?.email)
        },
        {
            step: 4,
            label: 'Ubicacion',
            required: true,
            isDone: (artist) => hasText(artist?.ubicacion)
        },
        {
            step: 5,
            label: 'Estilos',
            required: true,
            isDone: (artist) => hasArrayValues(artist?.styles_array) || hasText(artist?.estilo)
        },
        {
            step: 6,
            label: 'Experiencia',
            required: true,
            isDone: (artist) => hasText(artist?.years_experience)
        },
        {
            step: 7,
            label: 'Tarifa por sesion',
            required: true,
            isDone: (artist) => hasText(artist?.session_price)
        },
        {
            step: 8,
            label: 'Portfolio',
            required: true,
            isDone: (artist) => hasPortfolioData(artist)
        },
        {
            step: 9,
            label: 'Bio',
            required: false,
            isDone: (artist) => hasText(artist?.bio_description)
        },
        {
            step: 10,
            label: 'Modalidad de trabajo',
            required: true,
            isDone: (artist) => hasWorkTypeData(artist)
        },
        {
            step: 11,
            label: 'Fecha de nacimiento',
            required: true,
            isDone: (artist) => hasText(artist?.birth_date)
        },
        {
            step: 12,
            label: 'Newsletter',
            required: true,
            isDone: (artist) => hasNewsletterSelection(artist)
        }
    ];

    function withResumeStep(registerArtistUrl, nextStep) {
        const [path, queryString = ''] = String(registerArtistUrl || '/register-artist').split('?');
        const params = new URLSearchParams(queryString);

        if (Number.isInteger(nextStep) && nextStep > 1) {
            params.set('resumeStep', String(nextStep));
        } else {
            params.delete('resumeStep');
        }

        const query = params.toString();
        return query ? `${path}?${query}` : path;
    }

    function analyzeArtistProfile(artist) {
        const source = artist || {};
        const steps = STEP_DEFINITIONS.map((definition) => {
            const done = Boolean(definition.isDone(source));
            return {
                step: definition.step,
                label: definition.label,
                required: definition.required,
                done
            };
        });

        const requiredSteps = steps.filter(step => step.required);
        const completedRequired = requiredSteps.filter(step => step.done);
        const remainingRequired = requiredSteps.filter(step => !step.done);
        const profileCompleteness = toInteger(source?.profile_completeness);
        const legacyComplete = Boolean(source?.ms_profile_complete) || profileCompleteness >= 100;

        const isComplete = remainingRequired.length === 0 || legacyComplete;
        const nextStep = isComplete ? null : (remainingRequired[0]?.step || 1);

        return {
            isComplete,
            isLegacyComplete: legacyComplete,
            nextStep,
            steps,
            requiredCount: requiredSteps.length,
            completedCount: completedRequired.length,
            completedLabels: completedRequired.map(step => step.label),
            remainingLabels: remainingRequired.map(step => step.label),
            percentComplete: requiredSteps.length > 0
                ? Math.round((completedRequired.length / requiredSteps.length) * 100)
                : 100
        };
    }

    return {
        STEP_DEFINITIONS,
        analyzeArtistProfile,
        withResumeStep
    };
});

