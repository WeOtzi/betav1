import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

function dateFromToday(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const validBooking = {
  kind: 'custom',
  customerName: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+52 55 1234 5678',
  firstTattoo: true,
  placement: 'Antebrazo izquierdo',
  medicalNotes: 'Ninguna',
  preferredDate: dateFromToday(7),
  preferredTime: '15:00',
  references: ['asset://reference-1'],
};

describe('Weötzi prototype API', () => {
  let database: Database.Database;
  let temporaryDirectory: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'weotzi-prototype-api-'));
    database = createDatabase(join(temporaryDirectory, 'prototype.sqlite'));
    app = createApp(database);
  });

  afterEach(() => {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('reports that the API is backed by SQLite', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, database: 'sqlite' });
  });

  it('boots with the deterministic demo profile, portfolio and conversation', async () => {
    const response = await request(app).get('/api/bootstrap');

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({ id: 'demo-user', role: 'artist' });
    expect(response.body.portfolio).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'demo-flash-1', kind: 'flash' })]),
    );
    expect(response.body.conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'demo', participantName: 'Mara' })]),
    );
  });

  it('upserts a waitlist entry and verifies it only with the demo code', async () => {
    const waitlist = await request(app).post('/api/waitlist').send({ email: 'visitor@example.com' });
    const rejected = await request(app)
      .post('/api/verify')
      .send({ email: 'visitor@example.com', code: '000000' });
    const verified = await request(app)
      .post('/api/verify')
      .send({ email: 'visitor@example.com', code: '241041' });
    const duplicate = await request(app).post('/api/waitlist').send({ email: 'visitor@example.com' });

    expect(waitlist.status).toBe(201);
    expect(rejected.status).toBe(400);
    expect(verified.status).toBe(200);
    expect(verified.body.verified).toBe(true);
    expect(duplicate.status).toBe(200);
  });

  it('persists validated setup fields on the demo profile', async () => {
    const response = await request(app).patch('/api/profile').send({
      city: 'CDMX',
      objectives: ['Conseguir más clientes'],
      styles: ['Fine line'],
      onboardingCompleted: true,
    });
    const bootstrap = await request(app).get('/api/bootstrap');

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({ city: 'CDMX', onboardingCompleted: true });
    expect(bootstrap.body.profile.objectives).toEqual(['Conseguir más clientes']);
    expect(bootstrap.body.profile.styles).toEqual(['Fine line']);
  });

  it('rejects an empty profile name after trimming', async () => {
    const response = await request(app).patch('/api/profile').send({ name: '   ' });

    expect(response.status).toBe(400);
  });

  it('toggles a portfolio favorite persistently', async () => {
    const first = await request(app).post('/api/favorites/demo-flash-1/toggle');
    const second = await request(app).post('/api/favorites/demo-flash-1/toggle');

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ favorite: true });
    expect(second.body).toEqual({ favorite: false });
  });

  it('creates a booking and a linked conversation transactionally', async () => {
    const response = await request(app).post('/api/bookings').send(validBooking);
    const messages = await request(app).get(`/api/conversations/${response.body.conversation.id}/messages`);

    expect(response.status).toBe(201);
    expect(response.body.booking.status).toBe('requested');
    expect(response.body.conversation.bookingId).toBe(response.body.booking.id);
    expect(response.body.conversation.participantName).toBe('Ada Lovelace');
    expect(messages.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ sender: 'artist', body: expect.any(String) })]),
    );
  });

  it('rejects malformed bookings without creating a partial booking', async () => {
    const response = await request(app)
      .post('/api/bookings')
      .send({ ...validBooking, references: [] });
    const bootstrap = await request(app).get('/api/bootstrap');

    expect(response.status).toBe(400);
    expect(bootstrap.body.bookings).toEqual([]);
  });

  it('rejects malformed preferred dates and times', async () => {
    const response = await request(app).post('/api/bookings').send({
      ...validBooking,
      preferredDate: 'not-a-date',
      preferredTime: '99:99',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a preferred date in the past', async () => {
    const response = await request(app).post('/api/bookings').send({
      ...validBooking,
      preferredDate: '2000-01-01',
    });

    expect(response.status).toBe(400);
  });

  it('keeps user mutations after closing and reopening the SQLite file', async () => {
    const databasePath = join(temporaryDirectory, 'prototype.sqlite');
    await request(app).post('/api/favorites/demo-flash-1/toggle');
    await request(app).post('/api/bookings').send(validBooking);
    await request(app).post('/api/conversations/demo/messages').send({ body: 'Mensaje persistente' });

    database.close();
    database = createDatabase(databasePath);
    app = createApp(database);
    const bootstrap = await request(app).get('/api/bootstrap');
    const messages = await request(app).get('/api/conversations/demo/messages');

    expect(bootstrap.body.favorites).toContain('demo-flash-1');
    expect(bootstrap.body.bookings).toHaveLength(1);
    expect(messages.body.at(-1).body).toBe('Mensaje persistente');
  });

  it('persists a non-blank chat message in chronological order', async () => {
    const created = await request(app).post('/api/conversations/demo/messages').send({ body: '¿Qué horarios tienes?' });
    const messages = await request(app).get('/api/conversations/demo/messages');

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ sender: 'user', body: '¿Qué horarios tienes?' });
    expect(messages.body.at(-1)).toMatchObject({ id: created.body.id, body: '¿Qué horarios tienes?' });
  });

  it('rejects a blank message without writing a row', async () => {
    const before = await request(app).get('/api/conversations/demo/messages');
    const response = await request(app).post('/api/conversations/demo/messages').send({ body: '   ' });
    const after = await request(app).get('/api/conversations/demo/messages');

    expect(response.status).toBe(400);
    expect(after.body).toHaveLength(before.body.length);
  });

  it('restores deterministic demo state on reset', async () => {
    await request(app).post('/api/favorites/demo-flash-1/toggle');
    const rejected = await request(app).post('/api/reset');
    await request(app).post('/api/reset').set('X-Weotzi-Reset', 'true');
    const bootstrap = await request(app).get('/api/bootstrap');

    expect(rejected.status).toBe(403);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.favorites).toEqual([]);
    expect(bootstrap.body.bookings).toEqual([]);
    expect(bootstrap.body.profile.id).toBe('demo-user');
    expect(existsSync(join(temporaryDirectory, 'prototype.sqlite'))).toBe(true);
  });
});
