// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InspirationScreen } from '../src/features/discovery/InspirationScreen.js';
import { PublicProfileScreen } from '../src/features/profile/PublicProfileScreen.js';
import { ChatScreen } from '../src/features/messages/ChatScreen.js';

const portfolio = [
  {
    id: 'demo-flash-1',
    profileId: 'demo-user',
    title: 'Woman',
    artist: 'Sharky',
    imageAsset: '/assets/figma/inspiration-woman.png',
    height: 180,
    kind: 'flash' as const,
  },
];

describe('discovery and messaging flow', () => {
  it('opens an inspiration card and allows it to be favorited', async () => {
    const onOpenProfile = vi.fn();
    const onToggleFavorite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <InspirationScreen
        portfolio={portfolio}
        favorites={[]}
        onOpenProfile={onOpenProfile}
        onToggleFavorite={onToggleFavorite}
        onNavigate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /guardar woman/i }));
    await user.click(screen.getByRole('button', { name: /abrir woman/i }));

    expect(onToggleFavorite).toHaveBeenCalledWith('demo-flash-1');
    expect(onOpenProfile).toHaveBeenCalledWith('demo-flash-1');
  });

  it('switches public profile tabs and launches the custom booking', async () => {
    const onBookCustom = vi.fn();
    const user = userEvent.setup();

    render(<PublicProfileScreen onBack={vi.fn()} onBookCustom={onBookCustom} onBookFlash={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /sobre mí/i }));
    expect(screen.getByText(/fine line y microrealismo/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /quiero un diseño personalizado/i }));
    expect(onBookCustom).toHaveBeenCalledOnce();
  });

  it('does not send an empty chat message and appends a persisted message', async () => {
    const onSend = vi.fn().mockResolvedValue({
      id: 'new',
      conversationId: 'demo',
      sender: 'user' as const,
      body: '¿Tienes turno el viernes?',
      createdAt: new Date().toISOString(),
    });
    const user = userEvent.setup();

    render(
      <ChatScreen
        participantName="Mara"
        messages={[]}
        loading={false}
        onBack={vi.fn()}
        onSend={onSend}
      />,
    );
    const send = screen.getByRole('button', { name: /enviar/i });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /mensaje/i }), '¿Tienes turno el viernes?');
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith('¿Tienes turno el viernes?');
    expect(await screen.findByText('¿Tienes turno el viernes?')).toBeVisible();
  });
});
