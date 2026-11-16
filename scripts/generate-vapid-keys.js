#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// Genera un par de claves VAPID para los avisos push (Web Push · frente push).
//
//   node scripts/generate-vapid-keys.js
//
// Imprime las tres líneas para el .env del servidor. La clave privada NO se
// guarda en ningún archivo: cópiala al .env (gitignored) y a tu gestor de
// secretos. Si cambian las claves, los navegadores ya suscriptos se vuelven a
// suscribir solos la próxima vez que abren la app.
// ---------------------------------------------------------------------------

const { generateVapidKeys, loadVapidConfig } = require('../lib/web-push');

const subject = process.argv[2] || process.env.VAPID_SUBJECT || 'mailto:soporte@weotzi.com';
const keys = generateVapidKeys();
const check = loadVapidConfig({ publicKey: keys.publicKey, privateKey: keys.privateKey, subject });

if (!check.ok) {
    console.error(`No se pudieron generar claves válidas (${check.reason}). El contacto debe ser mailto:… o https://…`);
    process.exit(1);
}

console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
