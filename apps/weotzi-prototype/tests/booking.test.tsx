// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BookingWizard } from '../src/features/bookings/BookingWizard.js';

describe('booking wizard', () => {
  it('starts the first-tattoo question neutral and requires an explicit answer', async () => {
    const user = userEvent.setup();
    render(<BookingWizard kind="custom" onCancel={vi.fn()} onComplete={vi.fn()} />);

    const yes = screen.getByRole('button', { name: /^sí$/i });
    const no = screen.getByRole('button', { name: /^no$/i });
    const next = screen.getByRole('button', { name: /siguiente/i });
    expect(yes).toHaveAttribute('aria-pressed', 'false');
    expect(no).toHaveAttribute('aria-pressed', 'false');

    await user.type(screen.getByLabelText(/^nombre$/i), 'Mara');
    await user.type(screen.getByLabelText(/^email$/i), 'mara@example.com');
    await user.type(screen.getByLabelText(/^teléfono$/i), '+54 11 5555 5555');
    expect(next).toBeDisabled();

    await user.click(no);
    expect(no).toHaveAttribute('aria-pressed', 'true');
    expect(next).toBeEnabled();
  });

  it('keeps the next action disabled until the current fields are valid', async () => {
    const user = userEvent.setup();
    render(<BookingWizard kind="custom" onCancel={vi.fn()} onComplete={vi.fn()} />);

    const next = screen.getByRole('button', { name: /siguiente/i });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText(/^nombre$/i), 'Mara');
    await user.type(screen.getByLabelText(/^email$/i), 'mara@example.com');
    await user.type(screen.getByLabelText(/^teléfono$/i), '+54 11 5555 5555');
    await user.click(screen.getByRole('button', { name: /^sí$/i }));

    expect(next).toBeEnabled();
  });

  it('submits a complete custom request with at least one reference', async () => {
    const onComplete = vi.fn().mockResolvedValue({ bookingId: 'booking-1', conversationId: 'conversation-1' });
    const user = userEvent.setup();
    render(<BookingWizard kind="custom" onCancel={vi.fn()} onComplete={onComplete} />);

    await user.type(screen.getByLabelText(/^nombre$/i), 'Mara');
    await user.type(screen.getByLabelText(/^email$/i), 'mara@example.com');
    await user.type(screen.getByLabelText(/^teléfono$/i), '+54 11 5555 5555');
    await user.click(screen.getByRole('button', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /siguiente/i }));

    await user.type(screen.getByLabelText(/zona del cuerpo/i), 'Antebrazo');
    await user.type(screen.getByLabelText(/condiciones médicas/i), 'Ninguna');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));

    await user.click(screen.getByRole('button', { name: /woman de sharky/i }));
    await user.type(screen.getByLabelText(/fecha preferida/i), '2026-09-18');
    await user.type(screen.getByLabelText(/hora preferida/i), '14:00');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await user.click(screen.getByRole('button', { name: /enviar solicitud/i }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'custom',
        customerName: 'Mara',
        placement: 'Antebrazo',
        references: expect.arrayContaining(['/assets/figma/inspiration-woman.png']),
      }),
    );
    expect(await screen.findByText(/solicitud enviada/i)).toBeVisible();
  });

  it('keeps exactly the visibly selected custom reference', async () => {
    const user = userEvent.setup();
    render(<BookingWizard kind="custom" onCancel={vi.fn()} onComplete={vi.fn()} />);

    await user.type(screen.getByLabelText(/^nombre$/i), 'Mara');
    await user.type(screen.getByLabelText(/^email$/i), 'mara@example.com');
    await user.type(screen.getByLabelText(/^teléfono$/i), '+54 11 5555 5555');
    await user.click(screen.getByRole('button', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /siguiente/i }));
    await user.type(screen.getByLabelText(/zona del cuerpo/i), 'Antebrazo');
    await user.type(screen.getByLabelText(/condiciones médicas/i), 'Ninguna');
    await user.click(screen.getByRole('button', { name: /siguiente/i }));

    const woman = screen.getByRole('button', { name: /woman de sharky/i });
    const bird = screen.getByRole('button', { name: /bird de studio tattoo/i });
    await user.click(bird);
    expect(bird).toHaveAttribute('aria-pressed', 'true');
    expect(woman).toHaveAttribute('aria-pressed', 'false');
    await user.click(woman);
    expect(woman).toHaveAttribute('aria-pressed', 'true');
    expect(bird).toHaveAttribute('aria-pressed', 'false');
  });
});
