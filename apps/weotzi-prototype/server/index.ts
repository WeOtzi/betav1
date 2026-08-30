import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const port = Number.parseInt(process.env.PORT ?? '4546', 10);
const databasePath = resolve(process.env.WEOTZI_DB_PATH ?? 'data/weotzi-prototype.sqlite');
await mkdir(dirname(databasePath), { recursive: true });

const app = createApp(createDatabase(databasePath));
const distDirectory = resolve('dist');
if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get('{*splat}', (_request, response) => response.sendFile(resolve(distDirectory, 'index.html')));
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Weötzi prototype listening at http://127.0.0.1:${port}`);
});
