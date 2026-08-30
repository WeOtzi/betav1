import type Database from 'better-sqlite3';

const seedTime = '2026-08-13T00:00:00.000Z';

export function seedDatabase(db: Database.Database): void {
  const seed = db.transaction(() => {
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM conversations').run();
    db.prepare('DELETE FROM favorites').run();
    db.prepare('DELETE FROM bookings').run();
    db.prepare('DELETE FROM portfolio_items').run();
    db.prepare('DELETE FROM profiles').run();
    db.prepare('DELETE FROM waitlist_entries').run();

    db.prepare(`
      INSERT INTO profiles (id, role, name, email, phone, city, bio, objectives_json, styles_json, avatar_asset, onboarding_completed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'demo-user',
      'artist',
      'Nora Ríos',
      'nora@weotzi.local',
      '',
      'Ciudad de México',
      'Tatuadora especializada en fine line y microrealismo.',
      '[]',
      JSON.stringify(['Fine line', 'Microrealismo']),
      '/assets/figma/profile-avatar.png',
      0,
      seedTime,
    );

    const addArtistProfile = db.prepare(`
      INSERT INTO profiles (id, role, name, email, phone, city, bio, objectives_json, styles_json, avatar_asset, onboarding_completed, updated_at)
      VALUES (?, 'artist', ?, ?, '', 'Ciudad de México', '', '[]', '[]', '', 1, ?)
    `);
    [
      ['sharky', 'Sharky', 'sharky@weotzi.local'],
      ['himura', 'Himura', 'himura@weotzi.local'],
      ['mara-ink', 'Mara Ink', 'mara@weotzi.local'],
      ['studio-tattoo', 'Studio Tattoo', 'studio@weotzi.local'],
      ['spooky-foo', 'Spooky Foo', 'spooky@weotzi.local'],
      ['luisa-atelier', 'Luisa Atelier', 'luisa@weotzi.local'],
    ].forEach((artist) => addArtistProfile.run(...artist, seedTime));

    const addPortfolio = db.prepare(`
      INSERT INTO portfolio_items (id, profile_id, title, artist, image_asset, height, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    addPortfolio.run('demo-flash-1', 'sharky', 'Woman', 'Sharky', '/assets/figma/inspiration-woman.png', 180, 'flash');
    addPortfolio.run('demo-work-1', 'himura', 'Snake', 'Himura', '/assets/figma/inspiration-snake.png', 220, 'work');
    addPortfolio.run('demo-work-2', 'mara-ink', 'Flowers', 'Mara Ink', '/assets/figma/inspiration-flowers.png', 200, 'work');
    addPortfolio.run('demo-work-3', 'studio-tattoo', 'Bird', 'Studio Tattoo', '/assets/figma/inspiration-bird.png', 220, 'work');
    addPortfolio.run('demo-work-4', 'spooky-foo', 'Inspiration', 'Spooky Foo', '/assets/figma/inspiration-figure.png', 200, 'work');
    addPortfolio.run('demo-merch-1', 'luisa-atelier', 'Little Kid', 'Luisa Atelier', '/assets/figma/inspiration-kid.png', 180, 'merch');

    db.prepare(`
      INSERT INTO conversations (id, booking_id, participant_name, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('demo', null, 'Mara', seedTime);

    const addMessage = db.prepare(`
      INSERT INTO messages (id, conversation_id, sender, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    addMessage.run('demo-message-1', 'demo', 'artist', 'Hola Mara, ¿en qué puedo ayudarte?', seedTime);
    addMessage.run('demo-message-2', 'demo', 'user', 'Quiero saber más sobre tus flashes.', '2026-08-13T00:01:00.000Z');
  });

  seed();
}
