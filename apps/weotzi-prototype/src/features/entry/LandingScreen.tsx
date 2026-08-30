import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { FormField, PrimaryButton, SafariBar, StatusBar } from '../../components/index.js';
import './entry.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const landingCards = [
  {
    title: 'Medusa',
    subtitle: 'The Dollmaker',
    image: '/assets/figma/landing-card-medusa.png',
  },
  {
    title: 'Máscara',
    subtitle: 'Líneas de sombra',
    image: '/assets/figma/landing-card-mask.png',
  },
  {
    title: 'Calavera',
    subtitle: 'Blackwork',
    image: '/assets/figma/landing-card-skull.png',
  },
  {
    title: 'Ornamental',
    subtitle: 'Colección base',
    image: '/assets/figma/landing-card-base.png',
  },
] as const;

const benefits = [
  {
    title: 'Organiza tus citas',
    body: 'Disponibilidad, solicitudes y recordatorios en una misma agenda.',
    icon: '/assets/figma/landing-benefit-calendar.svg',
  },
  {
    title: 'Habla con tus clientes',
    body: 'Conserva cada detalle del diseño junto a la conversación.',
    icon: '/assets/figma/landing-benefit-chat.svg',
  },
  {
    title: 'Guarda cada proyecto',
    body: 'Referencias, avances y trabajos terminados siempre a mano.',
    icon: '/assets/figma/landing-benefit-folder.svg',
  },
  {
    title: 'Haz crecer tus ingresos',
    body: 'Comparte tu trabajo y convierte nuevas ideas en reservas.',
    icon: '/assets/figma/landing-benefit-money.svg',
  },
] as const;

export type LandingScreenProps = {
  onSubmit: (email: string) => void | Promise<void>;
  initialEmail?: string;
};

export function LandingScreen({ onSubmit, initialEmail = '' }: LandingScreenProps) {
  const emailId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!emailPattern.test(normalizedEmail)) {
      setError('Escribe un email válido');
      setSuccess('');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await onSubmit(normalizedEmail);
      setSuccess('¡Listo! Revisa tu email para continuar.');
    } catch {
      setError('No pudimos guardar tu email. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entry-screen landing-screen">
      <StatusBar />
      <SafariBar />

      <section className="landing-intro" aria-labelledby="landing-title">
        <p className="landing-brand">WeÖtzi</p>
        <h1 id="landing-title" ref={headingRef} tabIndex={-1}>Tu próximo tatuaje con WeÖtzi</h1>
        <p className="landing-lede">Cotiza, crea y conecta en una comunidad global de tatuadores.</p>

        <form className="landing-form" noValidate onSubmit={submit}>
          <FormField
            id={emailId}
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            error={error || undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError('');
              if (success) setSuccess('');
            }}
          />
          <PrimaryButton type="submit" loading={submitting}>
            {submitting ? 'Guardando…' : 'Sumarme al Waitlist'}
          </PrimaryButton>
          <p className="entry-feedback is-success" role="status" aria-live="polite">
            {success}
          </p>
        </form>
      </section>

      <section className="landing-gallery" aria-label="Diseños destacados">
        <ul>
          {landingCards.map((card) => (
            <li key={card.title}>
              <article className="landing-card">
                <img src={card.image} alt={`Tatuaje ${card.title.toLowerCase()}`} />
                <div className="landing-card-copy">
                  <h2>{card.title}</h2>
                  <p>{card.subtitle}</p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-benefits" aria-labelledby="landing-benefits-title">
        <p className="landing-eyebrow">Todo en un mismo lugar</p>
        <h2 id="landing-benefits-title">Gestiona todo tu negocio y dedica más tiempo a crear.</h2>
        <ul>
          {benefits.map((benefit) => (
            <li key={benefit.title}>
              <img src={benefit.icon} alt="" />
              <div>
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
