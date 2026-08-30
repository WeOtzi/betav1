// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../src/App.js';
import type { BootstrapData } from '../src/lib/models.js';

const bootstrap: BootstrapData = {
  profile: {
    id: 'demo-user', role: 'artist', name: 'Nora Ríos', email: 'nora@example.com', phone: '', city: 'CDMX', bio: '', objectives: [], styles: ['Fine line'], avatarAsset: '', onboardingCompleted: true, updatedAt: '',
  },
  portfolio: [{ id: 'demo-flash-1', profileId: 'demo-user', title: 'Woman', artist: 'Sharky', imageAsset: '/assets/figma/inspiration-woman.png', height: 180, kind: 'flash' }],
  favorites: [], bookings: [], conversations: [{ id: 'demo', bookingId: null, participantName: 'Mara', updatedAt: '' }],
};

describe('integrated app routes', () => {
  it('opens the public profile from inspiration and starts a custom request', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/inspiration']}><AppRoutes initialBootstrap={bootstrap} /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: /abrir woman/i }));
    const profileHeading = await screen.findByRole('heading', { name: 'El Charlatán' });
    expect(profileHeading).toBeVisible();
    await waitFor(() => expect(profileHeading).toHaveFocus());
    await user.click(screen.getByRole('button', { name: /quiero un diseño personalizado/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /diseño personalizado/i })).toBeVisible());
  });

  it('loads and persists chat through the API callbacks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'one', conversationId: 'demo', sender: 'artist', body: 'Hola', createdAt: '' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'two', conversationId: 'demo', sender: 'user', body: 'Quiero reservar', createdAt: '' }), { status: 201 }));
    const user = userEvent.setup();

    render(<MemoryRouter initialEntries={['/messages/demo']}><AppRoutes initialBootstrap={bootstrap} /></MemoryRouter>);
    expect(await screen.findByText('Hola')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: /mensaje/i }), 'Quiero reservar');
    await user.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => expect(screen.getByText('Quiero reservar')).toBeVisible());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/conversations/demo/messages', expect.objectContaining({ method: 'POST' }));
    fetchMock.mockRestore();
  });
});
