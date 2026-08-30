import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import {
  BookingInputSchema,
  MessageInputSchema,
  ProfilePatchSchema,
  VerifyInputSchema,
  WaitlistInputSchema,
  type BookingInput,
} from '../shared/contracts.js';
import { seedDatabase } from './seed.js';

const demoProfileId = 'demo-user';

type ProfileRow = {
  id: string;
  role: 'artist' | 'client';
  name: string;
  email: string;
  phone: string;
  city: string;
  bio: string;
  objectives_json: string;
  styles_json: string;
  avatar_asset: string;
  onboarding_completed: number;
  updated_at: string;
};

type PortfolioRow = {
  id: string;
  profile_id: string;
  title: string;
  artist: string;
  image_asset: string;
  height: number;
  kind: 'work' | 'flash' | 'merch';
};

type BookingRow = {
  id: string;
  kind: 'flash' | 'custom';
  status: 'requested' | 'confirmed' | 'cancelled' | 'completed';
  customer_name: string;
  email: string;
  phone: string;
  first_tattoo: number;
  placement: string;
  medical_notes: string;
  preferred_date: string;
  preferred_time: string;
  references_json: string;
  created_at: string;
};

type ConversationRow = {
  id: string;
  booking_id: string | null;
  participant_name: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender: 'user' | 'artist';
  body: string;
  created_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function validationError(response: Response, error: { issues: unknown }): void {
  response.status(400).json({ error: 'validation_error', issues: error.issues });
}

function profileFromRow(row: ProfileRow) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    bio: row.bio,
    objectives: JSON.parse(row.objectives_json) as string[],
    styles: JSON.parse(row.styles_json) as string[],
    avatarAsset: row.avatar_asset,
    onboardingCompleted: Boolean(row.onboarding_completed),
    updatedAt: row.updated_at,
  };
}

function portfolioFromRow(row: PortfolioRow) {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    artist: row.artist,
    imageAsset: row.image_asset,
    height: row.height,
    kind: row.kind,
  };
}

function bookingFromRow(row: BookingRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    customerName: row.customer_name,
    email: row.email,
    phone: row.phone,
    firstTattoo: Boolean(row.first_tattoo),
    placement: row.placement,
    medicalNotes: row.medical_notes,
    preferredDate: row.preferred_date,
    preferredTime: row.preferred_time,
    references: JSON.parse(row.references_json) as string[],
    createdAt: row.created_at,
  };
}

function conversationFromRow(row: ConversationRow) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    participantName: row.participant_name,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    body: row.body,
    createdAt: row.created_at,
  };
}

function readBootstrap(db: Database.Database) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(demoProfileId) as ProfileRow;
  const portfolio = db.prepare('SELECT * FROM portfolio_items ORDER BY id').all() as PortfolioRow[];
  const favorites = db
    .prepare('SELECT portfolio_item_id FROM favorites WHERE profile_id = ? ORDER BY portfolio_item_id')
    .all(demoProfileId) as Array<{ portfolio_item_id: string }>;
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY created_at DESC, id DESC').all() as BookingRow[];
  const conversations = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC, id DESC')
    .all() as ConversationRow[];

  return {
    profile: profileFromRow(profile),
    portfolio: portfolio.map(portfolioFromRow),
    favorites: favorites.map((favorite) => favorite.portfolio_item_id),
    bookings: bookings.map(bookingFromRow),
    conversations: conversations.map(conversationFromRow),
  };
}

function createBooking(db: Database.Database, booking: BookingInput) {
  const write = db.transaction((input: BookingInput) => {
    const timestamp = now();
    const bookingId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();

    db.prepare(`
      INSERT INTO bookings (
        id, kind, status, customer_name, email, phone, first_tattoo, placement,
        medical_notes, preferred_date, preferred_time, references_json, created_at
      ) VALUES (?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookingId,
      input.kind,
      input.customerName,
      input.email,
      input.phone,
      Number(input.firstTattoo),
      input.placement,
      input.medicalNotes,
      input.preferredDate,
      input.preferredTime,
      JSON.stringify(input.references),
      timestamp,
    );
    db.prepare(`
      INSERT INTO conversations (id, booking_id, participant_name, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, bookingId, input.customerName, timestamp);
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender, body, created_at)
      VALUES (?, ?, 'artist', ?, ?)
    `).run(messageId, conversationId, 'Gracias por tu solicitud. Te responderé con disponibilidad pronto.', timestamp);

    return { bookingId, conversationId };
  });

  return write(booking);
}

export function createApp(db: Database.Database): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, database: 'sqlite' });
  });

  app.get('/api/bootstrap', (_request, response) => {
    response.json(readBootstrap(db));
  });

  app.post('/api/waitlist', (request, response) => {
    const parsed = WaitlistInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);

    const timestamp = now();
    const result = db
      .prepare('INSERT INTO waitlist_entries (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING')
      .run(randomUUID(), parsed.data.email, timestamp);
    const entry = db
      .prepare('SELECT id, email, verified_at, created_at FROM waitlist_entries WHERE email = ?')
      .get(parsed.data.email) as { id: string; email: string; verified_at: string | null; created_at: string };
    response.status(result.changes === 1 ? 201 : 200).json({
      entry: {
        id: entry.id,
        email: entry.email,
        verifiedAt: entry.verified_at,
        createdAt: entry.created_at,
      },
    });
  });

  app.post('/api/verify', (request, response) => {
    const parsed = VerifyInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);
    if (parsed.data.code !== '241041') {
      return response.status(400).json({ error: 'invalid_code' });
    }

    const result = db
      .prepare('UPDATE waitlist_entries SET verified_at = ? WHERE email = ?')
      .run(now(), parsed.data.email);
    if (result.changes === 0) {
      return response.status(404).json({ error: 'waitlist_entry_not_found' });
    }
    return response.json({ verified: true });
  });

  app.patch('/api/profile', (request, response) => {
    const parsed = ProfilePatchSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);

    const columnByField = {
      name: 'name',
      email: 'email',
      phone: 'phone',
      city: 'city',
      bio: 'bio',
      objectives: 'objectives_json',
      styles: 'styles_json',
      avatarAsset: 'avatar_asset',
      onboardingCompleted: 'onboarding_completed',
    } as const;
    const fields = Object.keys(parsed.data) as Array<keyof typeof columnByField>;
    const assignments = fields.map((field) => `${columnByField[field]} = ?`);
    const values = fields.map((field) => {
      const value = parsed.data[field];
      if (field === 'objectives' || field === 'styles') return JSON.stringify(value);
      if (field === 'onboardingCompleted') return Number(value);
      return value;
    });
    values.push(now(), demoProfileId);
    db.prepare(`UPDATE profiles SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(demoProfileId) as ProfileRow;
    return response.json({ profile: profileFromRow(profile) });
  });

  app.post('/api/favorites/:portfolioItemId/toggle', (request, response) => {
    const item = db.prepare('SELECT id FROM portfolio_items WHERE id = ?').get(request.params.portfolioItemId);
    if (!item) return response.status(404).json({ error: 'portfolio_item_not_found' });

    const existing = db
      .prepare('SELECT 1 FROM favorites WHERE profile_id = ? AND portfolio_item_id = ?')
      .get(demoProfileId, request.params.portfolioItemId);
    if (existing) {
      db.prepare('DELETE FROM favorites WHERE profile_id = ? AND portfolio_item_id = ?').run(
        demoProfileId,
        request.params.portfolioItemId,
      );
      return response.json({ favorite: false });
    }
    db.prepare('INSERT INTO favorites (profile_id, portfolio_item_id, created_at) VALUES (?, ?, ?)').run(
      demoProfileId,
      request.params.portfolioItemId,
      now(),
    );
    return response.json({ favorite: true });
  });

  app.post('/api/bookings', (request, response) => {
    const parsed = BookingInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);

    const { bookingId, conversationId } = createBooking(db, parsed.data);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as BookingRow;
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as ConversationRow;
    return response.status(201).json({
      booking: bookingFromRow(booking),
      conversation: conversationFromRow(conversation),
    });
  });

  app.get('/api/conversations/:id/messages', (request: Request<{ id: string }>, response) => {
    const conversation = db.prepare('SELECT id FROM conversations WHERE id = ?').get(request.params.id);
    if (!conversation) return response.status(404).json({ error: 'conversation_not_found' });
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(request.params.id) as MessageRow[];
    return response.json(messages.map(messageFromRow));
  });

  app.post('/api/conversations/:id/messages', (request: Request<{ id: string }>, response) => {
    const parsed = MessageInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response, parsed.error);
    const conversation = db.prepare('SELECT id FROM conversations WHERE id = ?').get(request.params.id);
    if (!conversation) return response.status(404).json({ error: 'conversation_not_found' });

    const timestamp = now();
    const id = randomUUID();
    db.prepare('INSERT INTO messages (id, conversation_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      request.params.id,
      'user',
      parsed.data.body,
      timestamp,
    );
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(timestamp, request.params.id);
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow;
    return response.status(201).json(messageFromRow(message));
  });

  app.post('/api/reset', (request, response) => {
    if (request.get('X-Weotzi-Reset') !== 'true') {
      return response.status(403).json({ error: 'reset_confirmation_required' });
    }
    seedDatabase(db);
    return response.json({ ok: true });
  });

  return app;
}
