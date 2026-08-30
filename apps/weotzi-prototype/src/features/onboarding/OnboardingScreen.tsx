import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StatusBar } from '../../components/index.js';
import './onboarding.css';

const slides = [
  {
    title: 'Deja que te descubran',
    body: 'Dónde tatúas, qué estilo manejas y otros detalles para que te conozcan mejor',
  },
  {
    title: 'Organiza tu día',
    body: 'Gestiona citas y conversaciones desde un solo lugar',
  },
  {
    title: 'Haz crecer tu estudio',
    body: 'Comparte tu trabajo y conecta con personas que buscan tu estilo',
  },
] as const;

export type OnboardingScreenProps = {
  onComplete: () => void | Promise<void>;
};

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus();
  }, []);
  const slide = slides[slideIndex];

  async function advance() {
    if (slideIndex < slides.length - 1) {
      setSlideIndex((current) => current + 1);
      setError('');
      return;
    }

    setCompleting(true);
    setError('');
    try {
      await onComplete();
    } catch {
      setError('No pudimos continuar. Inténtalo de nuevo.');
    } finally {
      setCompleting(false);
    }
  }

  return (
    <main className="onboarding-screen">
      <img
        className="onboarding-hero"
        src="/assets/figma/onboarding-hero.png"
        alt="Tatuadora con maquillaje rojo y tatuajes de estilo oriental"
      />
      <div className="onboarding-shade" aria-hidden="true" />
      <StatusBar light />
      <p className="onboarding-brand">WeÖtzi</p>

      <div className="onboarding-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="onboarding-copy"
            key={slide.title}
            initial={{ opacity: 0, y: 10, x: 12 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -6, x: -12 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            aria-live="polite"
          >
            <h1 ref={focusHeading} tabIndex={-1}>{slide.title}</h1>
            <p>{slide.body}</p>
          </motion.div>
        </AnimatePresence>

        <div className="onboarding-dots" aria-label={`Paso ${slideIndex + 1} de ${slides.length}`}>
          {slides.map((item, index) => (
            <span key={item.title} className={index === slideIndex ? 'is-active' : ''} aria-hidden="true" />
          ))}
        </div>

        <p className="onboarding-error" role={error ? 'alert' : undefined} aria-live="assertive">
          {error}
        </p>

        <button className="onboarding-continue" type="button" disabled={completing} onClick={advance}>
          {completing ? 'Preparando…' : slideIndex === slides.length - 1 ? 'Empezar' : 'Continuar'}
        </button>
      </div>
    </main>
  );
}
