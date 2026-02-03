// ============================================
// WE ÖTZI - CONFIGURATION MANAGER
// Centralized configuration with secure storage
// ============================================

const ConfigManager = (function () {
    'use strict';

    // Storage keys
    const STORAGE_KEY = 'weotzi_config';
    const CONFIG_FILE = '/shared/js/app-config.json';

    // Default configuration
    const defaultConfig = {
        version: '1.1.0',
        lastModified: null,

        supabase: {
            url: '',
            anonKey: '',
            storageBucket: 'quotation-references'
        },

        n8n: {
            webhookUrl: '',
            driveFolderId: '1sBpYYrMPiyIwiXcKCcOnSPPZOJM4vq3W',
            events: [
                {
                    id: 'artist_registration_completed',
                    name: 'Registro de Artista Completado',
                    description: 'Se dispara cuando un artista completa su registro y perfil',
                    webhookUrl: '',
                    enabled: false
                },
                {
                    id: 'client_registration_completed',
                    name: 'Registro de Cliente Completado',
                    description: 'Se dispara cuando un cliente crea su cuenta',
                    webhookUrl: '',
                    enabled: false
                },
                {
                    id: 'password_reset_temp',
                    name: 'Restablecimiento de Contrasena',
                    description: 'Se dispara cuando un usuario solicita restablecer su contrasena (envia contrasena temporal)',
                    webhookUrl: '',
                    enabled: false
                },
                {
                    id: 'client_quotation_submitted',
                    name: 'Cotizacion de Cliente Enviada',
                    description: 'Se dispara cuando un cliente completa y envia una cotizacion',
                    webhookUrl: '',
                    enabled: false
                }
            ]
        },

        googleDrive: {
            mainFolderId: '',
            folderLink: '',
            serviceAccountJson: ''
        },

        gemini: {
            apiKey: '',
            model: 'gemini-3-pro-image-preview', // or gemini-2.5-flash-image
            enabled: false,
            maxTokens: 1024,
            defaultStyle: 'Minimalist line art',
            defaultBackgroundColor: 'White'
        },

        emailjs: {
            serviceId: '',
            templateId: '',
            publicKey: ''
        },

        googleCalendar: {
            clientId: '',
            apiKey: '',
            enabled: false
        },

        app: {
            maxImages: 4,
            maxImageSizeMB: 5,
            defaultCurrency: 'USD',
            acceptedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
            totalSteps: 19
        },

        features: {
            demoMode: true,
            emailNotifications: true,
            imageUpload: true
        },

        demoArtists: [],

        bodyParts: [
            {
                id: 'brazo', label: 'Brazo', image: 'assets/icons/arm.png', sides: 'both',
                subparts: [
                    { id: 'hombro', label: 'Hombro', sides: 'both' },
                    { id: 'brazo_superior', label: 'Bíceps/Tríceps', sides: 'both' },
                    { id: 'codo', label: 'Codo', sides: 'both' },
                    { id: 'antebrazo', label: 'Antebrazo', sides: 'both' },
                    { id: 'muneca', label: 'Muñeca', sides: 'both' },
                    { id: 'mano', label: 'Mano', sides: 'both' },
                    { id: 'dedos', label: 'Dedos', sides: 'both' }
                ]
            },
            {
                id: 'pierna', label: 'Pierna', image: 'assets/icons/leg.png', sides: 'both',
                subparts: [
                    { id: 'muslo', label: 'Muslo', sides: 'both' },
                    { id: 'rodilla', label: 'Rodilla', sides: 'both' },
                    { id: 'pantorrilla', label: 'Pantorrilla', sides: 'both' },
                    { id: 'tobillo', label: 'Tobillo', sides: 'both' },
                    { id: 'pie', label: 'Pie', sides: 'both' }
                ]
            },
            {
                id: 'torso', label: 'Torso (Frente)', image: 'assets/icons/torso.png', sides: 'none',
                subparts: [
                    { id: 'cuello_frente', label: 'Cuello', sides: 'none' },
                    { id: 'clavicula', label: 'Clavícula', sides: 'both' },
                    { id: 'pecho', label: 'Pecho/Pectoral', sides: 'both' },
                    { id: 'costillas', label: 'Costillas', sides: 'both' },
                    { id: 'abdomen', label: 'Abdomen', sides: 'none' },
                    { id: 'pelvis', label: 'Pelvis/Cadera', sides: 'both' }
                ]
            },
            {
                id: 'espalda', label: 'Espalda', image: 'assets/icons/back.png', sides: 'none',
                subparts: [
                    { id: 'nuca', label: 'Nuca', sides: 'none' },
                    { id: 'omoplato', label: 'Omóplato', sides: 'both' },
                    { id: 'columna', label: 'Columna', sides: 'none' },
                    { id: 'espalda_alta', label: 'Espalda Alta', sides: 'both' },
                    { id: 'espalda_baja', label: 'Lumbar', sides: 'both' },
                    { id: 'gluteo', label: 'Glúteo', sides: 'both' }
                ]
            },
            {
                id: 'cabeza', label: 'Cabeza', image: 'assets/icons/head.png', sides: 'both',
                subparts: [
                    { id: 'rostro', label: 'Rostro', sides: 'none' },
                    { id: 'oreja', label: 'Oreja/Detrás de oreja', sides: 'both' },
                    { id: 'cuello_lat', label: 'Cuello Lateral', sides: 'both' }
                ]
            }
        ]
    };

    // Current configuration in memory
    let currentConfig = null;

    // ConfigManagerReady promise - resolves when init() completes
    let configManagerReadyResolve;
    const configManagerReadyPromise = new Promise(resolve => {
        configManagerReadyResolve = resolve;
    });

    // Cached n8n events (loaded from DB or config)
    let cachedN8NEvents = null;

    // ========== INITIALIZATION ==========

    /**
     * Initialize the configuration manager
     * Loads config from file or localStorage
     */
    async function init() {
        try {
            // Try to load from JSON file first
            const fileConfig = await loadFromFile();
            const storedConfig = loadFromStorage();

            // Start with defaults
            currentConfig = { ...defaultConfig };

            if (fileConfig) {
                currentConfig = mergeConfig(currentConfig, fileConfig);
                console.log('✅ Configuration loaded from file');
            }

            if (storedConfig) {
                // Merge stored config on top of file config to preserve user changes
                currentConfig = mergeConfig(currentConfig, storedConfig);
                console.log('✅ Configuration merged with localStorage');
            }

            // Resolve the ready promise
            if (configManagerReadyResolve) {
                configManagerReadyResolve(currentConfig);
            }

            return currentConfig;
        } catch (error) {
            console.error('❌ Error loading configuration:', error);
            currentConfig = { ...defaultConfig };
            // Still resolve on error with default config
            if (configManagerReadyResolve) {
                configManagerReadyResolve(currentConfig);
            }
            return currentConfig;
        }
    }

    /**
     * Returns a promise that resolves when ConfigManager is ready
     * @returns {Promise<Object>} Resolves with the current config
     */
    function ready() {
        return configManagerReadyPromise;
    }

    /**
     * Load configuration from JSON file
     */
    async function loadFromFile() {
        try {
            const response = await fetch(CONFIG_FILE + '?t=' + Date.now()); // Cache bust
            if (!response.ok) return null;

            const config = await response.json();
            return config;
        } catch (error) {
            console.warn('Could not load config file:', error.message);
            return null;
        }
    }

    /**
     * Load configuration from localStorage
     */
    function loadFromStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;

            return JSON.parse(stored);
        } catch (error) {
            console.warn('Could not load from localStorage:', error);
            return null;
        }
    }

    /**
     * Deep merge two configuration objects
     */
    function mergeConfig(base, override) {
        const result = { ...base };

        for (const key in override) {
            if (override.hasOwnProperty(key)) {
                if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
                    result[key] = mergeConfig(base[key] || {}, override[key]);
                } else {
                    result[key] = override[key];
                }
            }
        }

        return result;
    }

    // ========== GETTERS ==========

    /**
     * Get the current configuration
     */
    function get() {
        return currentConfig || defaultConfig;
    }

    /**
     * Get a specific configuration value by path
     * @param {string} path - Dot-separated path (e.g., 'supabase.url')
     * @param {*} defaultValue - Default value if not found
     */
    function getValue(path, defaultValue = null) {
        const config = get();
        const parts = path.split('.');

        let value = config;
        for (const part of parts) {
            if (value === undefined || value === null) return defaultValue;
            value = value[part];
        }

        return value !== undefined ? value : defaultValue;
    }

    /**
     * Check if Supabase is configured
     */
    function isSupabaseConfigured() {
        const url = getValue('supabase.url');
        const key = getValue('supabase.anonKey');
        return !!(url && key && !url.includes('YOUR_PROJECT'));
    }

    /**
     * Check if EmailJS is configured
     */
    function isEmailJSConfigured() {
        const serviceId = getValue('emailjs.serviceId');
        const publicKey = getValue('emailjs.publicKey');
        return !!(serviceId && publicKey && !publicKey.includes('YOUR_'));
    }

    /**
     * Check if demo mode is enabled
     */
    function isDemoMode() {
        return getValue('features.demoMode', true) || !isSupabaseConfigured();
    }

    /**
     * Get demo artists
     */
    function getDemoArtists() {
        return getValue('demoArtists', []);
    }

    /**
     * Get body parts configuration
     */
    function getBodyParts() {
        return getValue('bodyParts', defaultConfig.bodyParts);
    }

    // ========== SETTERS ==========

    /**
     * Set a configuration value by path
     * @param {string} path - Dot-separated path (e.g., 'supabase.url')
     * @param {*} value - Value to set
     */
    function setValue(path, value) {
        const config = get();
        const parts = path.split('.');

        let current = config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        current[parts[parts.length - 1]] = value;
        currentConfig = config;
        currentConfig.lastModified = new Date().toISOString();

        // Persist to localStorage
        saveToStorage();

        return currentConfig;
    }

    /**
     * Update multiple configuration values
     * @param {Object} updates - Object with updates to merge
     */
    function update(updates) {
        currentConfig = mergeConfig(currentConfig, updates);
        currentConfig.lastModified = new Date().toISOString();
        saveToStorage();
        return currentConfig;
    }

    /**
     * Save configuration to localStorage
     */
    function saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
            return true;
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            return false;
        }
    }

    // ========== EXPORT / IMPORT ==========

    /**
     * Export configuration as JSON string
     */
    function exportJSON() {
        return JSON.stringify(currentConfig, null, 2);
    }

    /**
     * Export configuration as downloadable file
     */
    function exportToFile(filename = 'app-config.json') {
        const blob = new Blob([exportJSON()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }

    /**
     * Import configuration from JSON string
     * @param {string} jsonString - JSON configuration string
     */
    function importJSON(jsonString) {
        try {
            const imported = JSON.parse(jsonString);
            currentConfig = mergeConfig(defaultConfig, imported);
            currentConfig.lastModified = new Date().toISOString();
            saveToStorage();
            return { success: true, config: currentConfig };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Import configuration from file
     * @param {File} file - File object to import
     */
    async function importFromFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const result = importJSON(e.target.result);
                resolve(result);
            };

            reader.onerror = () => {
                resolve({ success: false, error: 'Failed to read file' });
            };

            reader.readAsText(file);
        });
    }

    // ========== SUPABASE CLIENT ==========

    // Supabase client instance (Singleton)
    let supabaseInstance = null;

    /**
     * Get or create Supabase client (Singleton)
     */
    function getSupabaseClient() {
        if (!isSupabaseConfigured()) {
            console.warn('⚠️ Supabase not configured');
            return null;
        }

        if (typeof window.supabase === 'undefined') {
            console.error('❌ Supabase library not loaded');
            return null;
        }

        // Return existing instance if available
        if (supabaseInstance) return supabaseInstance;

        const url = getValue('supabase.url');
        const key = getValue('supabase.anonKey');

        try {
            supabaseInstance = window.supabase.createClient(url, key);
            console.log('✅ Supabase client initialized (Singleton)');
            return supabaseInstance;
        } catch (err) {
            console.error('❌ Error creating Supabase client:', err);
            return null;
        }
    }

    // ========== BODY PARTS - SUPABASE OPERATIONS ==========

    /**
     * Load body parts from Supabase database
     * Returns hierarchical structure (tree)
     */
    async function loadBodyPartsFromDB() {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available, using local config');
            return getBodyParts();
        }

        try {
            const { data, error } = await client
                .from('body_parts')
                .select('*')
                .order('sort_order');

            if (error) throw error;

            // Convert flat data to hierarchical tree
            const tree = buildBodyPartsTree(data);
            console.log('✅ Body parts loaded from Supabase:', data.length, 'items');
            return tree;
        } catch (err) {
            console.error('❌ Error loading body parts from DB:', err);
            return getBodyParts(); // Fallback to local
        }
    }

    /**
     * Convert flat database rows to hierarchical tree structure
     */
    function buildBodyPartsTree(flatData) {
        const map = {};
        const roots = [];

        // First pass: create map
        flatData.forEach(item => {
            map[item.id] = {
                id: item.part_id,
                db_id: item.id,
                label: item.label,
                image: item.image_url,
                sides: item.sides || 'both',
                sensitivity: item.sensitivity || 5,
                pain_level: item.pain_level || 5,
                description: item.description || '',
                tattoo_info: item.tattoo_info || '',
                experience_info: item.experience_info || '',
                sort_order: item.sort_order,
                parent_id: item.parent_id,
                // Expanded media settings
                expanded_media_type: item.expanded_media_type || 'none',
                expanded_media_url: item.expanded_media_url || '',
                expanded_media_bg: item.expanded_media_bg || '#1a1a1a',
                expanded_media_align_h: item.expanded_media_align_h || 'center',
                expanded_media_align_v: item.expanded_media_align_v || 'center',
                expanded_media_fit: item.expanded_media_fit || 'cover',
                subparts: []
            };
        });

        // Second pass: build hierarchy
        flatData.forEach(item => {
            const node = map[item.id];
            if (item.parent_id && map[item.parent_id]) {
                map[item.parent_id].subparts.push(node);
            } else {
                roots.push(node);
            }
        });

        // Sort subparts
        roots.forEach(r => r.subparts.sort((a, b) => a.sort_order - b.sort_order));

        return roots.sort((a, b) => a.sort_order - b.sort_order);
    }

    /**
     * Save a new body part to Supabase
     */
    async function createBodyPartInDB(partData, parentDbId = null) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { data, error } = await client
                .from('body_parts')
                .insert([{
                    part_id: partData.id,
                    label: partData.label,
                    parent_id: parentDbId,
                    image_url: partData.image || null,
                    sides: partData.sides || 'both',
                    sensitivity: partData.sensitivity || 5,
                    pain_level: partData.pain_level || 5,
                    description: partData.description || null,
                    tattoo_info: partData.tattoo_info || null,
                    experience_info: partData.experience_info || null,
                    sort_order: partData.sort_order || 0,
                    // Expanded media settings
                    expanded_media_type: partData.expanded_media_type || 'none',
                    expanded_media_url: partData.expanded_media_url || null,
                    expanded_media_bg: partData.expanded_media_bg || '#1a1a1a',
                    expanded_media_align_h: partData.expanded_media_align_h || 'center',
                    expanded_media_align_v: partData.expanded_media_align_v || 'center',
                    expanded_media_fit: partData.expanded_media_fit || 'cover'
                }])
                .select()
                .single();

            if (error) throw error;
            console.log('✅ Body part created:', data.part_id);
            return { data, error: null };
        } catch (err) {
            console.error('❌ Error creating body part:', err);
            return { data: null, error: err.message };
        }
    }

    /**
     * Update a body part in Supabase
     */
    async function updateBodyPartInDB(dbId, partData) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { data, error } = await client
                .from('body_parts')
                .update({
                    part_id: partData.id,
                    label: partData.label,
                    image_url: partData.image || null,
                    sides: partData.sides || 'both',
                    sensitivity: partData.sensitivity || 5,
                    pain_level: partData.pain_level || 5,
                    description: partData.description || null,
                    tattoo_info: partData.tattoo_info || null,
                    experience_info: partData.experience_info || null,
                    // Expanded media settings
                    expanded_media_type: partData.expanded_media_type || 'none',
                    expanded_media_url: partData.expanded_media_url || null,
                    expanded_media_bg: partData.expanded_media_bg || '#1a1a1a',
                    expanded_media_align_h: partData.expanded_media_align_h || 'center',
                    expanded_media_align_v: partData.expanded_media_align_v || 'center',
                    expanded_media_fit: partData.expanded_media_fit || 'cover'
                })
                .eq('id', dbId)
                .select()
                .single();

            if (error) throw error;
            console.log('✅ Body part updated:', data.part_id);
            return { data, error: null };
        } catch (err) {
            console.error('❌ Error updating body part:', err);
            return { data: null, error: err.message };
        }
    }

    /**
     * Delete a body part from Supabase (cascades to children)
     */
    async function deleteBodyPartFromDB(dbId) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { error } = await client
                .from('body_parts')
                .delete()
                .eq('id', dbId);

            if (error) throw error;
            console.log('✅ Body part deleted:', dbId);
            return { error: null };
        } catch (err) {
            console.error('❌ Error deleting body part:', err);
            return { error: err.message };
        }
    }

    // ========== QUESTIONS - SUPABASE OPERATIONS ==========

    /**
     * Load questions from Supabase database
     */
    async function loadQuestionsFromDB() {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for questions');
            return null;
        }

        try {
            const { data, error } = await client
                .from('quotation_flow_config')
                .select('*')
                .order('step_number');

            if (error) throw error;

            // Map DB rows to JS objects
            const questions = data.map(row => ({
                id: parseFloat(row.step_number),
                step: row.step_name,
                type: row.question_type,
                title: row.question_title,
                field: row.field_name,
                optional: !row.is_required,
                options: row.options,
                logic: row.logic,
                placeholder: row.placeholder,
                minLength: row.min_length,
                maxLength: row.max_length,
                editable: row.is_editable,
                hidden: row.is_hidden,
                prefix: row.prefix_text,
                subtitle: row.subtitle_text
            }));

            console.log('✅ Questions loaded from Supabase:', questions.length, 'items');
            return questions;
        } catch (err) {
            console.error('❌ Error loading questions from DB:', err);
            return null;
        }
    }

    /**
     * Save/Sync all questions to Supabase
     * (Replaces all current rows with the provided array)
     */
    async function saveQuestionsToDB(questions) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            // First, clear existing questions
            const { error: deleteError } = await client
                .from('quotation_flow_config')
                .delete()
                .neq('step_number', -1); // Delete all

            if (deleteError) throw deleteError;

            // Prepare DB rows
            const rows = questions.map(q => ({
                step_number: q.id,
                step_name: q.step,
                question_type: q.type,
                question_title: q.title,
                field_name: q.field,
                is_required: !q.optional,
                options: q.options,
                logic: q.logic,
                placeholder: q.placeholder,
                min_length: q.minLength,
                max_length: q.maxLength,
                is_editable: q.editable !== undefined ? q.editable : true,
                is_hidden: q.hidden !== undefined ? q.hidden : false,
                prefix_text: q.prefix,
                subtitle_text: q.subtitle
            }));

            const { error: insertError } = await client
                .from('quotation_flow_config')
                .insert(rows);

            if (insertError) throw insertError;

            console.log('✅ Questions synced to Supabase:', rows.length, 'items');
            return { error: null };
        } catch (err) {
            console.error('❌ Error syncing questions to DB:', err);
            return { error: err.message };
        }
    }

    /**
     * Update a single question in Supabase
     */
    async function updateQuestionInDB(id, questionData) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const row = {
                step_name: questionData.step,
                question_type: questionData.type,
                question_title: questionData.title,
                field_name: questionData.field,
                is_required: !questionData.optional,
                options: questionData.options,
                logic: questionData.logic,
                placeholder: questionData.placeholder,
                min_length: questionData.minLength,
                max_length: questionData.maxLength,
                is_editable: questionData.editable !== undefined ? questionData.editable : true,
                is_hidden: questionData.hidden !== undefined ? questionData.hidden : false,
                prefix_text: questionData.prefix,
                subtitle_text: questionData.subtitle
            };

            const { error } = await client
                .from('quotation_flow_config')
                .update(row)
                .eq('step_number', id);

            if (error) throw error;
            return { error: null };
        } catch (err) {
            console.error('❌ Error updating question:', err);
            return { error: err.message };
        }
    }

    // ========== TATTOO STYLES - SUPABASE OPERATIONS ==========

    /**
     * Load tattoo styles from Supabase database
     * Returns hierarchical structure (tree with substyles)
     */
    async function loadTattooStylesFromDB() {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for tattoo styles');
            return [];
        }

        try {
            const { data, error } = await client
                .from('tattoo_styles')
                .select('*')
                .order('sort_order');

            if (error) throw error;

            // Convert flat data to hierarchical tree
            const tree = buildTattooStylesTree(data);
            console.log('✅ Tattoo styles loaded from Supabase:', data.length, 'items');
            return tree;
        } catch (err) {
            console.error('❌ Error loading tattoo styles from DB:', err);
            return [];
        }
    }

    /**
     * Convert flat tattoo styles rows to hierarchical tree structure
     */
    function buildTattooStylesTree(flatData) {
        const map = {};
        const roots = [];

        // First pass: create map
        flatData.forEach(item => {
            map[item.id] = {
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description || '',
                reference_images: item.reference_images || [],
                cover_image_url: item.cover_image_url || '',
                sort_order: item.sort_order || 0,
                substyles_display_mode: item.substyles_display_mode || 'grouped',
                parent_id: item.parent_id,
                created_at: item.created_at,
                updated_at: item.updated_at,
                substyles: []
            };
        });

        // Second pass: build hierarchy
        flatData.forEach(item => {
            const node = map[item.id];
            if (item.parent_id && map[item.parent_id]) {
                map[item.parent_id].substyles.push(node);
            } else if (!item.parent_id) {
                roots.push(node);
            }
        });

        // Sort substyles by sort_order
        Object.values(map).forEach(node => {
            if (node.substyles.length > 0) {
                node.substyles.sort((a, b) => a.sort_order - b.sort_order);
            }
        });

        return roots.sort((a, b) => a.sort_order - b.sort_order);
    }

    /**
     * Get flat list of all tattoo styles (for dropdowns, etc.)
     */
    async function loadTattooStylesFlatFromDB() {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for tattoo styles');
            return [];
        }

        try {
            const { data, error } = await client
                .from('tattoo_styles')
                .select('*')
                .order('sort_order');

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('❌ Error loading tattoo styles flat from DB:', err);
            return [];
        }
    }

    /**
     * Generate slug from name
     */
    function generateSlug(name) {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Create a new tattoo style in Supabase
     * @param {Object} styleData - Style data (name, description, etc.)
     * @param {string|null} parentId - Parent style UUID for substyles
     */
    async function createTattooStyleInDB(styleData, parentId = null) {
        const client = getSupabaseClient();
        if (!client) return { data: null, error: 'Supabase not configured' };

        try {
            const slug = styleData.slug || generateSlug(styleData.name);

            const { data, error } = await client
                .from('tattoo_styles')
                .insert([{
                    name: styleData.name,
                    slug: slug,
                    description: styleData.description || null,
                    reference_images: styleData.reference_images || [],
                    cover_image_url: styleData.cover_image_url || null,
                    sort_order: styleData.sort_order || 0,
                    substyles_display_mode: parentId ? null : (styleData.substyles_display_mode || 'grouped'),
                    parent_id: parentId
                }])
                .select()
                .single();

            if (error) throw error;
            console.log('✅ Tattoo style created:', data.name);
            return { data, error: null };
        } catch (err) {
            console.error('❌ Error creating tattoo style:', err);
            return { data: null, error: err.message };
        }
    }

    /**
     * Update a tattoo style in Supabase
     * @param {string} id - Style UUID
     * @param {Object} styleData - Updated style data
     */
    async function updateTattooStyleInDB(id, styleData) {
        const client = getSupabaseClient();
        if (!client) return { data: null, error: 'Supabase not configured' };

        try {
            const updateData = {
                name: styleData.name,
                slug: styleData.slug || generateSlug(styleData.name),
                description: styleData.description || null,
                reference_images: styleData.reference_images || [],
                cover_image_url: styleData.cover_image_url || null,
                sort_order: styleData.sort_order || 0,
                updated_at: new Date().toISOString()
            };

            // Only set substyles_display_mode for parent styles
            if (styleData.substyles_display_mode !== undefined) {
                updateData.substyles_display_mode = styleData.substyles_display_mode;
            }

            const { data, error } = await client
                .from('tattoo_styles')
                .update(updateData)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            console.log('✅ Tattoo style updated:', data.name);
            return { data, error: null };
        } catch (err) {
            console.error('❌ Error updating tattoo style:', err);
            return { data: null, error: err.message };
        }
    }

    /**
     * Delete a tattoo style from Supabase (cascades to substyles via FK)
     * @param {string} id - Style UUID
     */
    async function deleteTattooStyleFromDB(id) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { error } = await client
                .from('tattoo_styles')
                .delete()
                .eq('id', id);

            if (error) throw error;
            console.log('✅ Tattoo style deleted:', id);
            return { error: null };
        } catch (err) {
            console.error('❌ Error deleting tattoo style:', err);
            return { error: err.message };
        }
    }

    /**
     * Get a single tattoo style by ID
     * @param {string} id - Style UUID
     */
    async function getTattooStyleByIdFromDB(id) {
        const client = getSupabaseClient();
        if (!client) return { data: null, error: 'Supabase not configured' };

        try {
            const { data, error } = await client
                .from('tattoo_styles')
                .select('*')
                .eq('id', id)
                .single();

            if (error) throw error;
            return { data, error: null };
        } catch (err) {
            console.error('❌ Error getting tattoo style:', err);
            return { data: null, error: err.message };
        }
    }

    /**
     * Initialize EmailJS
     */
    function initEmailJS() {
        if (!isEmailJSConfigured()) {
            console.warn('⚠️ EmailJS not configured');
            return false;
        }

        if (typeof window.emailjs === 'undefined') {
            console.error('❌ EmailJS library not loaded');
            return false;
        }

        const publicKey = getValue('emailjs.publicKey');
        window.emailjs.init(publicKey);
        console.log('✅ EmailJS initialized');
        return true;
    }

    // ========== RESET ==========

    /**
     * Reset configuration to defaults
     */
    function reset() {
        currentConfig = { ...defaultConfig };
        currentConfig.lastModified = new Date().toISOString();
        saveToStorage();
        return currentConfig;
    }

    /**
     * Clear all stored configuration
     */
    function clear() {
        localStorage.removeItem(STORAGE_KEY);
        currentConfig = null;
    }

    // ========== SUPER ADMIN UTILITIES ==========

    /**
     * Test Supabase connection
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    async function testSupabaseConnection() {
        const client = getSupabaseClient();
        if (!client) {
            return { success: false, error: 'Supabase not configured' };
        }

        try {
            const { count, error } = await client
                .from('artists_db')
                .select('*', { count: 'exact', head: true });

            if (error) throw error;

            return { success: true, message: `Connected. ${count} artists found.`, count };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Get row counts for all main tables
     * @returns {Promise<Object>} Object with table names as keys and counts as values
     */
    async function getTableRowCounts() {
        const client = getSupabaseClient();
        if (!client) return {};

        const tables = [
            'artists_db', 
            'quotations_db', 
            'support_users_db', 
            'feedback_tickets',
            'body_parts', 
            'quotation_flow_config', 
            'tattoo_styles',
            'app_settings'
        ];

        const counts = {};

        for (const table of tables) {
            try {
                const { count, error } = await client
                    .from(table)
                    .select('*', { count: 'exact', head: true });

                counts[table] = error ? 'Error' : (count || 0);
            } catch {
                counts[table] = 'Error';
            }
        }

        return counts;
    }

    /**
     * Check if n8n webhook is configured
     */
    function isN8NConfigured() {
        const webhookUrl = getValue('n8n.webhookUrl');
        return !!(webhookUrl && webhookUrl.length > 0);
    }

    /**
     * Check if Google Maps API is configured
     */
    function isGoogleMapsConfigured() {
        const apiKey = getValue('googleMaps.apiKey');
        return !!(apiKey && apiKey.length > 0 && !apiKey.includes('YOUR_'));
    }

    /**
     * Check if Google Drive API is configured
     */
    function isGoogleDriveConfigured() {
        const folderId = getValue('googleDrive.mainFolderId');
        const credentials = getValue('googleDrive.serviceAccountJson');
        return !!(folderId && folderId.length > 0 && credentials && credentials.length > 0);
    }

    /**
     * Check if Google Calendar API is configured
     */
    function isGoogleCalendarConfigured() {
        const clientId = getValue('googleCalendar.clientId');
        const apiKey = getValue('googleCalendar.apiKey');
        return !!(clientId && apiKey && clientId.length > 0 && apiKey.length > 0 && !clientId.includes('YOUR_'));
    }

    /**
     * Get all configured routes
     */
    function getRoutes() {
        return getValue('routes', {});
    }

    /**
     * Update a specific route
     */
    function setRoute(key, path) {
        const routes = getRoutes();
        routes[key] = path;
        setValue('routes', routes);
        return routes;
    }

    /**
     * Get system health summary
     */
    async function getSystemHealth() {
        const health = {
            supabase: { configured: isSupabaseConfigured(), connected: false },
            emailjs: { configured: isEmailJSConfigured() },
            n8n: { configured: isN8NConfigured() },
            googleMaps: { configured: isGoogleMapsConfigured() },
            googleDrive: { configured: isGoogleDriveConfigured() },
            googleCalendar: { configured: isGoogleCalendarConfigured() }
        };

        // Test Supabase connection
        if (health.supabase.configured) {
            const test = await testSupabaseConnection();
            health.supabase.connected = test.success;
            health.supabase.message = test.message || test.error;
        }

        return health;
    }

    // ========== APP SETTINGS - SUPABASE OPERATIONS ==========

    /**
     * Load all public app settings from Supabase
     * @returns {Promise<Object>} Object with setting_key as key and setting_value as value
     */
    async function loadAppSettingsFromDB() {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for app settings');
            return {};
        }

        try {
            const { data, error } = await client
                .from('app_settings')
                .select('*')
                .eq('is_public', true);

            if (error) throw error;

            // Convert to key-value object
            const settings = {};
            data.forEach(row => {
                settings[row.setting_key] = {
                    value: row.setting_value,
                    type: row.setting_type,
                    description: row.description
                };
            });

            console.log('✅ App settings loaded from Supabase:', Object.keys(settings).length, 'items');
            return settings;
        } catch (err) {
            console.error('❌ Error loading app settings from DB:', err);
            return {};
        }
    }

    /**
     * Get a single app setting by key
     * @param {string} key - The setting_key to retrieve
     * @returns {Promise<string|null>} The setting value or null
     */
    async function getAppSettingFromDB(key) {
        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for app settings');
            return null;
        }

        try {
            const { data, error } = await client
                .from('app_settings')
                .select('setting_value, setting_type')
                .eq('setting_key', key)
                .single();

            if (error) throw error;
            return data?.setting_value || null;
        } catch (err) {
            console.error('❌ Error getting app setting:', key, err);
            return null;
        }
    }

    /**
     * Update or insert an app setting
     * @param {string} key - The setting_key
     * @param {string} value - The setting_value
     * @param {string} type - The setting_type (text, html, json, number, boolean)
     * @param {string} description - Optional description
     * @returns {Promise<{error: string|null}>}
     */
    async function setAppSettingInDB(key, value, type = 'text', description = null) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { error } = await client
                .from('app_settings')
                .upsert([{
                    setting_key: key,
                    setting_value: value,
                    setting_type: type,
                    description: description,
                    updated_at: new Date().toISOString()
                }], { onConflict: 'setting_key' });

            if (error) throw error;
            console.log('✅ App setting saved:', key);
            return { error: null };
        } catch (err) {
            console.error('❌ Error saving app setting:', err);
            return { error: err.message };
        }
    }

    /**
     * Delete an app setting
     * @param {string} key - The setting_key to delete
     * @returns {Promise<{error: string|null}>}
     */
    async function deleteAppSettingFromDB(key) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { error } = await client
                .from('app_settings')
                .delete()
                .eq('setting_key', key);

            if (error) throw error;
            console.log('✅ App setting deleted:', key);
            return { error: null };
        } catch (err) {
            console.error('❌ Error deleting app setting:', err);
            return { error: err.message };
        }
    }

    // ========== N8N EVENTS - WEBHOOK DISPATCH ==========

    /**
     * Get default n8n events from config
     * @returns {Array} Array of event objects
     */
    function getDefaultN8NEvents() {
        return getValue('n8n.events', defaultConfig.n8n.events);
    }

    /**
     * Load n8n events from Supabase app_settings
     * Falls back to config defaults if not available
     * @returns {Promise<Array>} Array of event objects
     */
    async function loadN8NEventsFromDB() {
        // Return cached if available
        if (cachedN8NEvents) {
            return cachedN8NEvents;
        }

        const client = getSupabaseClient();
        if (!client) {
            console.warn('⚠️ Supabase not available for n8n events, using config defaults');
            cachedN8NEvents = getDefaultN8NEvents();
            return cachedN8NEvents;
        }

        try {
            const { data, error } = await client
                .from('app_settings')
                .select('setting_value')
                .eq('setting_key', 'n8n_events')
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    // No rows returned, use defaults
                    console.log('ℹ️ No n8n events in DB, using config defaults');
                    cachedN8NEvents = getDefaultN8NEvents();
                    return cachedN8NEvents;
                }
                throw error;
            }

            // Parse JSON from setting_value
            const events = JSON.parse(data.setting_value);
            console.log('✅ n8n events loaded from DB:', events.length, 'events');
            cachedN8NEvents = events;
            return events;
        } catch (err) {
            console.error('❌ Error loading n8n events from DB:', err);
            cachedN8NEvents = getDefaultN8NEvents();
            return cachedN8NEvents;
        }
    }

    /**
     * Save n8n events to Supabase app_settings
     * @param {Array} events - Array of event objects
     * @returns {Promise<{error: string|null}>}
     */
    async function saveN8NEventsInDB(events) {
        const client = getSupabaseClient();
        if (!client) return { error: 'Supabase not configured' };

        try {
            const { error } = await client
                .from('app_settings')
                .upsert([{
                    setting_key: 'n8n_events',
                    setting_value: JSON.stringify(events),
                    setting_type: 'json',
                    description: 'n8n webhook events configuration for email notifications',
                    is_public: true,
                    updated_at: new Date().toISOString()
                }], { onConflict: 'setting_key' });

            if (error) throw error;

            // Update cache
            cachedN8NEvents = events;
            console.log('✅ n8n events saved to DB');
            return { error: null };
        } catch (err) {
            console.error('❌ Error saving n8n events to DB:', err);
            return { error: err.message };
        }
    }

    /**
     * Get all n8n events (from cache, DB, or config)
     * @param {boolean} forceRefresh - Force reload from DB
     * @returns {Promise<Array>} Array of event objects
     */
    async function getN8NEvents(forceRefresh = false) {
        if (forceRefresh) {
            cachedN8NEvents = null;
        }
        return await loadN8NEventsFromDB();
    }

    /**
     * Get a single n8n event by ID
     * @param {string} eventId - The event ID
     * @returns {Promise<Object|null>} Event object or null
     */
    async function getN8NEvent(eventId) {
        const events = await getN8NEvents();
        return events.find(e => e.id === eventId) || null;
    }

    /**
     * Update a single n8n event and save to DB
     * @param {string} eventId - The event ID
     * @param {Object} updates - Object with properties to update (webhookUrl, enabled, etc.)
     * @returns {Promise<{error: string|null}>}
     */
    async function updateN8NEvent(eventId, updates) {
        const events = await getN8NEvents();
        const eventIndex = events.findIndex(e => e.id === eventId);

        if (eventIndex === -1) {
            return { error: `Event not found: ${eventId}` };
        }

        // Merge updates
        events[eventIndex] = { ...events[eventIndex], ...updates };

        // Save to DB
        return await saveN8NEventsInDB(events);
    }

    /**
     * Clear the cached n8n events (forces reload on next access)
     */
    function clearN8NEventsCache() {
        cachedN8NEvents = null;
    }

    /**
     * Send an n8n webhook event
     * Checks if event is enabled and has a webhook URL before sending
     * @param {string} eventId - The event ID (e.g., 'artist_registration_completed')
     * @param {Object} payload - The data payload to send
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async function sendN8NEvent(eventId, payload) {
        try {
            const event = await getN8NEvent(eventId);

            if (!event) {
                console.warn(`⚠️ n8n event not found: ${eventId}`);
                return { success: false, error: `Event not found: ${eventId}` };
            }

            if (!event.enabled) {
                console.log(`ℹ️ n8n event disabled, skipping: ${eventId}`);
                return { success: true, skipped: true, reason: 'Event disabled' };
            }

            if (!event.webhookUrl || event.webhookUrl.trim() === '') {
                console.warn(`⚠️ n8n event has no webhook URL: ${eventId}`);
                return { success: false, error: 'No webhook URL configured' };
            }

            // Build the full payload with metadata
            const fullPayload = {
                event_id: eventId,
                event_name: event.name,
                timestamp: new Date().toISOString(),
                source: 'weotzi-app',
                data: payload
            };

            console.log(`📡 Sending n8n event: ${eventId}...`);

            const response = await fetch(event.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(fullPayload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            console.log(`✅ n8n event sent successfully: ${eventId}`);
            return { success: true };
        } catch (err) {
            console.error(`❌ Error sending n8n event ${eventId}:`, err);
            return { success: false, error: err.message };
        }
    }

    // ========== PUBLIC API ==========

    return {
        // Lifecycle
        init,
        ready,

        // Getters
        get,
        getValue,
        isSupabaseConfigured,
        isEmailJSConfigured,
        isDemoMode,
        getDemoArtists,
        getBodyParts,

        // Setters
        setValue,
        update,
        saveToStorage,

        // Export/Import
        exportJSON,
        exportToFile,
        importJSON,
        importFromFile,

        // Clients
        getSupabaseClient,
        initEmailJS,

        // Body Parts - Supabase
        loadBodyPartsFromDB,
        createBodyPartInDB,
        updateBodyPartInDB,
        deleteBodyPartFromDB,

        // Questions - Supabase
        loadQuestionsFromDB,
        saveQuestionsToDB,
        updateQuestionInDB,

        // Tattoo Styles - Supabase
        loadTattooStylesFromDB,
        loadTattooStylesFlatFromDB,
        createTattooStyleInDB,
        updateTattooStyleInDB,
        deleteTattooStyleFromDB,
        getTattooStyleByIdFromDB,
        generateSlug,

        // App Settings - Supabase
        loadAppSettingsFromDB,
        getAppSettingFromDB,
        setAppSettingInDB,
        deleteAppSettingFromDB,

        // n8n Events - Webhook Dispatch
        getDefaultN8NEvents,
        loadN8NEventsFromDB,
        saveN8NEventsInDB,
        getN8NEvents,
        getN8NEvent,
        updateN8NEvent,
        clearN8NEventsCache,
        sendN8NEvent,

        // Reset
        reset,
        clear,

        // Super Admin Utilities
        testSupabaseConnection,
        getTableRowCounts,
        isN8NConfigured,
        isGoogleMapsConfigured,
        isGoogleDriveConfigured,
        isGoogleCalendarConfigured,
        getRoutes,
        setRoute,
        getSystemHealth
    };
})();

// Auto-initialize when script loads
(async function () {
    await ConfigManager.init();

    // Make available globally
    window.ConfigManager = ConfigManager;

    // Create convenience aliases
    window.getConfig = ConfigManager.getValue;
    window.setConfig = ConfigManager.setValue;

    // ============================================
    // COMPATIBILITY LAYER: window.CONFIG
    // Provides backward compatibility for Legacy Landing Page scripts
    // that use window.CONFIG directly
    // ============================================
    const config = ConfigManager.get();
    window.CONFIG = {
        supabase: {
            url: config.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co',
            anonKey: config.supabase?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888'
        },
        weOtzi: config.weOtzi || { whatsapp: '+541162079567' },
        googleMaps: config.googleMaps || { apiKey: 'AIzaSyAaop8XBfjEIMw8lSv4LakBXVZ9HL4ekLs' },
        googleCalendar: config.googleCalendar || { clientId: '', apiKey: '', enabled: false },
        registration: config.registration || { presetPassword: 'OtziArtist2025' },
        infoTexts: config.infoTexts || [],
        routes: config.routes || {}
    };

    // Log status
    console.log('ConfigManager ready');
    console.log('   Supabase:', ConfigManager.isSupabaseConfigured() ? 'OK' : 'Not configured');
    console.log('   EmailJS:', ConfigManager.isEmailJSConfigured() ? 'OK' : 'Not configured');
    console.log('   Demo Mode:', ConfigManager.isDemoMode() ? 'ON' : 'OFF');
    console.log('   window.CONFIG:', window.CONFIG ? 'OK (compatibility layer)' : 'Not available');
})();
