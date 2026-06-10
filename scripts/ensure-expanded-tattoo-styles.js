#!/usr/bin/env node

try { require('dotenv').config(); } catch (_) { /* dotenv is optional */ }

const fs = require('node:fs');
const path = require('node:path');
const { EXPANDED_TATTOO_STYLES } = require('../lib/expanded-tattoo-styles');

function readFileConfig() {
    const configPath = path.join(__dirname, '..', 'public', 'shared', 'js', 'app-config.json');
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function normalize(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

async function request(url, apiKey, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }

    return response.json();
}

async function main() {
    const fileConfig = readFileConfig();
    const supabaseUrl = process.env.SUPABASE_URL || fileConfig.supabase?.url;
    const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || fileConfig.supabase?.anonKey;

    if (!supabaseUrl || !apiKey) {
        throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');
    }

    const baseUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/tattoo_styles`;
    const existing = await request(
        `${baseUrl}?parent_id=is.null&select=id,name,slug,sort_order&order=sort_order.asc`,
        apiKey
    );
    const existingNames = new Set(existing.map((style) => normalize(style.name)));
    const maxSort = existing.reduce((max, style) => Math.max(max, Number(style.sort_order) || 0), 0);

    const missing = EXPANDED_TATTOO_STYLES
        .filter((style) => !existingNames.has(normalize(style.label)))
        .map((style, index) => ({
            name: style.label,
            slug: style.value.replace(/_/g, '-'),
            parent_id: null,
            sort_order: maxSort + index + 1,
            substyles_display_mode: 'grouped'
        }));

    if (!missing.length) {
        console.log('All expanded tattoo styles already exist.');
        return;
    }

    const inserted = await request(baseUrl, apiKey, {
        method: 'POST',
        body: JSON.stringify(missing)
    });

    console.log(`Inserted ${inserted.length} tattoo styles:`);
    inserted.forEach((style) => console.log(`- ${style.name}`));
}

main().catch((error) => {
    console.error(`Failed to ensure expanded tattoo styles: ${error.message}`);
    process.exitCode = 1;
});
