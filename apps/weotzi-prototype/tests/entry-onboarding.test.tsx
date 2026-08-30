// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryFlow } from '../src/features/entry/EntryFlow.js';
import { LandingScreen } from '../src/features/entry/LandingScreen.js';
import { VerifyScreen } from '../src/features/entry/VerifyScreen.js';
import { OnboardingScreen } from '../src/features/onboarding/OnboardingScreen.js';
import { SetupWizard } from '../src/features/onboarding/SetupWizard.js';
import {
  initialSetupDraft,
  reduceSetup,
  validateSetupStep,
} from '../src/features/onboarding/setup-state.js';

afterEach(cleanup);

describe('entry and onboarding', () => {
  it('keeps an invalid waitlist email in place and announces the inline error', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<LandingScreen onSubmit={onSubmit} />);

    expect(screen.getByText('weotzi.com')).toBeVisible();
    expect(screen.getByRole('heading', { name: /tu próximo tatuaje con weötzi/i })).toBeVisible();
    expect(screen.getByText(/gestiona todo tu negocio/i)).toBeVisible();

    const email = screen.getByRole('textbox', { name: /^email$/i });
    await user.type(email, 'correo-incompleto');
    await user.click(screen.getByRole('button', { name: /sumarme al waitlist/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe un email válido');
    expect(email).toHaveValue('correo-incompleto');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a normalized waitlist email and surfaces an async failure without clearing it', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();

    render(<LandingScreen onSubmit={onSubmit} />);
    const email = screen.getByRole('textbox', { name: /^email$/i });
    await user.type(email, 'MARA@EXAMPLE.COM');
    await user.click(screen.getByRole('button', { name: /sumarme al waitlist/i }));

    expect(onSubmit).toHaveBeenCalledWith('mara@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar tu email');
    expect(email).toHaveValue('MARA@EXAMPLE.COM');
  });

  it('explains and accepts only the six-digit demo verification code', async () => {
    const onVerify = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<VerifyScreen email="mara@example.com" onVerify={onVerify} onBack={vi.fn()} />);

    expect(screen.getByText(/código demo: 241041/i)).toBeVisible();
    const code = screen.getByRole('textbox', { name: /código de verificación/i });
    await user.type(code, '241');
    await user.click(screen.getByRole('button', { name: /verificar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa los 6 dígitos');
    expect(onVerify).not.toHaveBeenCalled();

    await user.clear(code);
    await user.type(code, '241041');
    await user.click(screen.getByRole('button', { name: /verificar/i }));
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith('241041'));
  });

  it('advances through three onboarding messages before completing', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(<OnboardingScreen onComplete={onComplete} />);

    expect(screen.getByRole('heading', { name: 'Deja que te descubran' })).toBeVisible();
    expect(screen.getByText(/dónde tatúas, qué estilo manejas/i)).toBeVisible();
    expect(screen.getByRole('img', { name: /tatuadora con maquillaje rojo/i })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Organiza tu día' })).toBeVisible());
    expect(screen.getByRole('heading', { name: 'Organiza tu día' })).toHaveFocus();
    expect(screen.getByText('Gestiona citas y conversaciones desde un solo lugar')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Haz crecer tu estudio' })).toBeVisible());
    expect(screen.getByText(/comparte tu trabajo y conecta/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('keeps setup answers while moving backward and validates each step', () => {
    const withCity = reduceSetup(initialSetupDraft, { type: 'set-city', city: 'CDMX' });
    const withStyle = reduceSetup(withCity, { type: 'toggle-style', style: 'Blackwork' });
    const moved = reduceSetup(withStyle, { type: 'go-to', step: 1 });

    expect(moved.city).toBe('CDMX');
    expect(moved.styles).toEqual(['Blackwork']);
    expect(validateSetupStep(initialSetupDraft, 0)).toEqual({
      objectives: 'Elige al menos un objetivo',
    });
    expect(validateSetupStep(withStyle, 2)).toEqual({});
  });

  it('saves every valid setup step and completes with all collected answers', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <SetupWizard
        initialDraft={{ email: 'mara@example.com' }}
        onSave={onSave}
        onComplete={onComplete}
      />,
    );

    const next = () => screen.getByRole('button', { name: /continuar/i });
    expect(next()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Conseguir más clientes' }));
    expect(next()).toBeEnabled();
    await user.click(next());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cuéntanos sobre ti' })).toBeVisible());
    expect(screen.getByRole('heading', { name: 'Cuéntanos sobre ti' })).toHaveFocus();

    await user.type(screen.getByRole('textbox', { name: /^nombre$/i }), 'Mara');
    await user.type(screen.getByRole('textbox', { name: /biografía/i }), 'Tatuadora de línea fina.');
    await user.click(next());
    await waitFor(() => expect(screen.getByRole('heading', { name: '¿Dónde tatúas?' })).toBeVisible());

    await user.type(screen.getByRole('textbox', { name: /ciudad/i }), 'CDMX');
    await user.click(next());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tus estilos' })).toBeVisible());

    await user.click(screen.getByRole('button', { name: 'Fine line' }));
    await user.click(next());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Elige tu foto' })).toBeVisible());

    await user.click(screen.getByRole('button', { name: 'Usar retrato principal' }));
    await user.click(screen.getByRole('button', { name: /terminar/i }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          objectives: ['Conseguir más clientes'],
          name: 'Mara',
          email: 'mara@example.com',
          city: 'CDMX',
          styles: ['Fine line'],
          avatarAsset: '/assets/figma/profile-avatar.png',
          onboardingCompleted: true,
        }),
      ),
    );
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ city: 'CDMX' }));
  });

  it('keeps the current setup step and announces a retryable save error', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();

    render(<SetupWizard onSave={onSave} onComplete={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Organizar mi agenda' }));
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar tus cambios');
    expect(screen.getByRole('heading', { name: '¿Qué quieres lograr?' })).toBeVisible();
    expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled();
  });

  it('orchestrates landing and verification without requiring a router', async () => {
    const onJoinWaitlist = vi.fn().mockResolvedValue(undefined);
    const onVerify = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <EntryFlow
        onJoinWaitlist={onJoinWaitlist}
        onVerify={onVerify}
        onSaveProfile={vi.fn().mockResolvedValue(undefined)}
        onComplete={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'mara@example.com');
    await user.click(screen.getByRole('button', { name: /sumarme al waitlist/i }));
    const verifyHeading = await screen.findByRole('heading', { name: /revisa tu email/i });
    expect(verifyHeading).toBeVisible();
    expect(verifyHeading).toHaveFocus();

    await user.type(screen.getByRole('textbox', { name: /código de verificación/i }), '241041');
    await user.click(screen.getByRole('button', { name: /verificar/i }));
    expect(await screen.findByRole('heading', { name: 'Deja que te descubran' })).toBeVisible();
    expect(onVerify).toHaveBeenCalledWith('mara@example.com', '241041');
  });
});
