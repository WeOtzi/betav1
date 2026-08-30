import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { figmaAssets, FormField, PrimaryButton, StatusBar } from '../../components/index.js';
import './entry.css';

const demoCode = '241041';

export type VerifyScreenProps = {
  email: string;
  onVerify: (code: string) => void | Promise<void>;
  onBack: () => void;
};

export function VerifyScreen({ email, onVerify, onBack }: VerifyScreenProps) {
  const codeId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) {
      setError('Ingresa los 6 dígitos');
      return;
    }
    if (code !== demoCode) {
      setError('El código no es correcto. Prueba con 241041.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onVerify(code);
    } catch {
      setError('No pudimos verificar el código. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entry-screen verify-screen">
      <StatusBar />
      <header className="verify-header">
        <button type="button" className="entry-back-button" aria-label="Volver" onClick={onBack}>
          <img src={figmaAssets.wizardBackArrow} alt="" />
        </button>
        <p className="verify-brand">WeÖtzi</p>
      </header>

      <section className="verify-content">
        <p className="entry-step-label">ÚLTIMO PASO</p>
        <h1 ref={headingRef} tabIndex={-1}>Revisa tu email</h1>
        <p>
          Enviamos un código de seis dígitos a <strong>{email}</strong>.
        </p>

        <form noValidate onSubmit={submit}>
          <FormField
            id={codeId}
            label="Código de verificación"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            helpText="Código demo: 241041"
            error={error || undefined}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
              if (error) setError('');
            }}
          />
          <PrimaryButton type="submit" loading={submitting}>
            {submitting ? 'Verificando…' : 'Verificar'}
          </PrimaryButton>
        </form>
      </section>
    </main>
  );
}
