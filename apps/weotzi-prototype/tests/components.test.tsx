// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppHeader,
  BottomNav,
  Brand,
  DeviceShell,
  FormField,
  PhotoCard,
  PrimaryButton,
  SafariBar,
  ScreenTransition,
  SegmentedChoice,
  StatusBar,
  WizardFooter,
} from '../src/components';

afterEach(cleanup);

describe('mobile shell primitives', () => {
  it('composes the browser chrome and accessible screen content', () => {
    render(
      <MemoryRouter>
        <DeviceShell>
          <StatusBar time="14:41" />
          <SafariBar domain="weotzi.com" />
          <AppHeader title={<Brand />} action={<button type="button">Mensajes</button>} />
          <main>Contenido</main>
        </DeviceShell>
      </MemoryRouter>,
    );

    expect(screen.getByText('WeÖtzi')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mensajes' })).toBeEnabled();
    expect(screen.getByText('Contenido')).toBeVisible();
    expect(screen.queryByText('14:41')).not.toBeNull();
    expect(screen.queryByText('weotzi.com')).not.toBeNull();
  });

  it('marks only the current bottom destination as active', () => {
    render(
      <MemoryRouter initialEntries={['/app/business']}>
        <BottomNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Negocio' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Perfil' })).not.toHaveAttribute('aria-current');
  });

  it('recognizes the public profile route as the profile destination', () => {
    render(
      <MemoryRouter initialEntries={['/profile/el-charlatan']}>
        <BottomNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('href', '/profile/el-charlatan');
  });

  it('delegates controlled navigation without also changing the router location', () => {
    const onNavigate = vi.fn();

    function CurrentPath() {
      return <output>{useLocation().pathname}</output>;
    }

    render(
      <MemoryRouter initialEntries={['/app/inspiration']}>
        <BottomNav active="profile" onNavigate={onNavigate} />
        <CurrentPath />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Perfil' }));
    expect(onNavigate).toHaveBeenCalledWith('profile');
    expect(screen.getByText('/app/inspiration')).toBeVisible();
  });
});

describe('form and wizard primitives', () => {
  it('blocks wizard progress while required fields are invalid', () => {
    const onNext = vi.fn();

    render(
      <WizardFooter
        step={0}
        total={3}
        nextDisabled
        onBack={() => {}}
        onNext={onNext}
      />,
    );

    const continueButton = screen.getByRole('button', { name: 'Continuar' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Paso 1 de 3')).toHaveAttribute('aria-current', 'step');
  });

  it('associates a field error with its input', () => {
    render(
      <FormField
        id="booking-email"
        label="Email"
        type="email"
        value="correo-invalido"
        onChange={() => {}}
        error="Escribe un email válido"
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Escribe un email válido');
  });

  it('reports the selected segmented option and changes it semantically', () => {
    const onChange = vi.fn();

    render(
      <SegmentedChoice
        label="¿Es tu primer tatuaje?"
        name="first-tattoo"
        value="yes"
        options={[
          { value: 'yes', label: 'Sí' },
          { value: 'no', label: 'No' },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sí' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onChange).toHaveBeenCalledWith('no');
  });
});

describe('interactive visual primitives', () => {
  it('keeps the photo destination and favorite action independently usable', () => {
    const onOpen = vi.fn();
    const onFavoriteToggle = vi.fn();

    render(
      <PhotoCard
        image="/assets/figma/inspiration-bird.png"
        imageAlt="Tatuaje de un pájaro"
        title="Bird"
        artist="Studio Tattoo"
        favorite={false}
        onOpen={onOpen}
        onFavorite={onFavoriteToggle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir Bird' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Bird' }));
    expect(onFavoriteToggle).toHaveBeenCalledTimes(1);
  });

  it('exposes loading buttons and route transitions without losing their content', async () => {
    render(
      <ScreenTransition>
        <PrimaryButton loading>Enviar solicitud</PrimaryButton>
      </ScreenTransition>,
    );

    expect(screen.getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('Enviar solicitud')).toBeVisible());
  });
});
