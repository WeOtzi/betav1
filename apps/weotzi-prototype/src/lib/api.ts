import type { BookingInput, BootstrapData, Message, Profile } from './models.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = 'No pudimos completar la acción. Intenta de nuevo.';
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error === 'invalid_code') message = 'Ese código no es correcto.';
      if (body.error === 'waitlist_entry_not_found') message = 'Primero registra tu correo.';
    } catch {
      // Keep the friendly fallback when the server returns no JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  bootstrap: () => request<BootstrapData>('/api/bootstrap'),
  joinWaitlist: (email: string) =>
    request<{ entry: { email: string } }>('/api/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verify: (email: string, code: string) =>
    request<{ verified: true }>('/api/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  updateProfile: (patch: Partial<Profile>) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  toggleFavorite: (id: string) =>
    request<{ favorite: boolean }>(`/api/favorites/${encodeURIComponent(id)}/toggle`, { method: 'POST' }),
  createBooking: (booking: BookingInput) =>
    request<{ booking: { id: string }; conversation: { id: string } }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(booking),
    }),
  messages: (conversationId: string) =>
    request<Message[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),
  sendMessage: (conversationId: string, body: string) =>
    request<Message>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  reset: () => request<{ ok: true }>('/api/reset', {
    method: 'POST',
    headers: { 'X-Weotzi-Reset': 'true' },
  }),
};
