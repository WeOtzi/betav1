import { useMemo, useState } from 'react';
import { FormField, PrimaryButton, SegmentedChoice, StatusBar, WizardFooter } from '../../components/index.js';
import type { BookingInput } from '../../lib/models.js';
import './booking.css';

type Props = {
  kind: 'flash' | 'custom';
  onCancel: () => void;
  onComplete: (booking: BookingInput) => Promise<{ bookingId: string; conversationId: string }>;
  onOpenChat?: (conversationId: string) => void;
  onGoHome?: () => void;
};

const WOMAN_REFERENCE = '/assets/figma/inspiration-woman.png';
const BIRD_REFERENCE = '/assets/figma/inspiration-bird.png';

const emptyBooking = (kind: 'flash' | 'custom'): BookingInput => ({
  kind,
  customerName: '',
  email: '',
  phone: '',
  firstTattoo: true,
  placement: '',
  medicalNotes: '',
  preferredDate: '',
  preferredTime: '',
  references: kind === 'flash' ? ['/assets/figma/profile-work-3.png'] : [],
});

export function BookingWizard({ kind, onCancel, onComplete, onOpenChat, onGoHome }: Props) {
  const [step, setStep] = useState(0);
  const [booking, setBooking] = useState(() => emptyBooking(kind));
  const [firstTattooAnswer, setFirstTattooAnswer] = useState<'yes' | 'no' | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ bookingId: string; conversationId: string } | null>(null);

  const valid = useMemo(() => {
    if (step === 0) return Boolean(booking.customerName.trim() && /^\S+@\S+\.\S+$/.test(booking.email) && booking.phone.trim() && firstTattooAnswer);
    if (step === 1) return Boolean(booking.placement.trim() && booking.medicalNotes.trim());
    if (step === 2) return Boolean(/^\d{4}-\d{2}-\d{2}$/.test(booking.preferredDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(booking.preferredTime) && (kind === 'flash' || booking.references.length));
    return true;
  }, [booking, firstTattooAnswer, kind, step]);

  function patch<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setBooking((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function next() {
    if (valid) setStep((current) => Math.min(current + 1, 3));
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      setResult(await onComplete(booking));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos enviar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="booking-success">
        <StatusBar />
        <main>
          <span className="success-mark" aria-hidden="true">✓</span>
          <p className="eyebrow">LISTO</p>
          <h1>Solicitud enviada</h1>
          <p>El Charlatán recibió tus datos. Te escribirá para confirmar disponibilidad y próximos pasos.</p>
          <div className="success-actions">
            <PrimaryButton onClick={() => onOpenChat?.(result.conversationId)}>Abrir conversación</PrimaryButton>
            <button type="button" className="text-button" onClick={onGoHome}>Volver a inspiración</button>
          </div>
        </main>
      </div>
    );
  }

  const title = kind === 'custom' ? 'Diseño personalizado' : 'Comprar Flash';
  return (
    <div className="booking-screen">
      <StatusBar />
      <header className="booking-header"><h1>{title}</h1><button type="button" onClick={onCancel}>Cancelar</button></header>
      <main className="booking-content">
        {step === 0 && <p className="booking-lead">Inicia tu cotización con los siguientes datos.</p>}
        {step === 0 && (
          <div className="booking-fields">
            <FormField label="Nombre" name="customerName" value={booking.customerName} onChange={(event) => patch('customerName', event.target.value)} autoComplete="name" />
            <FormField label="Email" name="email" type="email" value={booking.email} onChange={(event) => patch('email', event.target.value)} autoComplete="email" />
            <FormField label="Teléfono" name="phone" type="tel" value={booking.phone} onChange={(event) => patch('phone', event.target.value)} autoComplete="tel" />
            <SegmentedChoice
              label="¿Es tu primer tatuaje?"
              name="firstTattoo"
              value={firstTattooAnswer}
              options={[{ label: 'Sí', value: 'yes' }, { label: 'No', value: 'no' }]}
              onChange={(value) => {
                const answer = value === 'yes' ? 'yes' : 'no';
                setFirstTattooAnswer(answer);
                patch('firstTattoo', answer === 'yes');
              }}
            />
          </div>
        )}
        {step === 1 && (
          <div className="booking-fields booking-step-copy">
            <p className="eyebrow">SOBRE TU IDEA</p><h2>Cuéntanos dónde y cómo imaginas tu tatuaje</h2>
            <FormField label="Zona del cuerpo" name="placement" value={booking.placement} onChange={(event) => patch('placement', event.target.value)} placeholder="Ej. antebrazo izquierdo" />
            <label className="textarea-field">Condiciones médicas o alergias<textarea aria-label="Condiciones médicas" value={booking.medicalNotes} onChange={(event) => patch('medicalNotes', event.target.value)} placeholder="Escribe “Ninguna” si no aplica" /></label>
          </div>
        )}
        {step === 2 && (
          <div className="booking-fields booking-step-copy">
            <p className="eyebrow">ÚLTIMOS DETALLES</p><h2>{kind === 'custom' ? 'Elige una referencia y una fecha' : 'Elige cuándo quieres venir'}</h2>
            {kind === 'custom' && (
              <div className="reference-picker" aria-label="Referencias">
                <button
                  type="button"
                  className={booking.references.includes(WOMAN_REFERENCE) ? 'selected' : ''}
                  aria-pressed={booking.references.includes(WOMAN_REFERENCE)}
                  onClick={() => patch('references', [WOMAN_REFERENCE])}
                  aria-label="Woman de Sharky"
                >
                  <img src={WOMAN_REFERENCE} alt="" />
                  <span>{booking.references.includes(WOMAN_REFERENCE) ? 'Referencia elegida' : 'Elegir referencia'}</span>
                </button>
                <button
                  type="button"
                  className={booking.references.includes(BIRD_REFERENCE) ? 'selected' : ''}
                  aria-pressed={booking.references.includes(BIRD_REFERENCE)}
                  onClick={() => patch('references', [BIRD_REFERENCE])}
                  aria-label="Bird de Studio Tattoo"
                >
                  <img src={BIRD_REFERENCE} alt="" />
                  <span>{booking.references.includes(BIRD_REFERENCE) ? 'Referencia elegida' : 'Bird'}</span>
                </button>
              </div>
            )}
            <FormField label="Fecha preferida" name="preferredDate" inputMode="numeric" placeholder="AAAA-MM-DD" value={booking.preferredDate} onChange={(event) => patch('preferredDate', event.target.value)} />
            <FormField label="Hora preferida" name="preferredTime" inputMode="numeric" placeholder="HH:MM" value={booking.preferredTime} onChange={(event) => patch('preferredTime', event.target.value)} />
          </div>
        )}
        {step === 3 && (
          <div className="booking-review">
            <p className="eyebrow">REVISA TU SOLICITUD</p><h2>Todo listo para conversar</h2>
            <dl><div><dt>Nombre</dt><dd>{booking.customerName}</dd></div><div><dt>Tipo</dt><dd>{kind === 'custom' ? 'Diseño personalizado' : 'Flash disponible'}</dd></div><div><dt>Zona</dt><dd>{booking.placement}</dd></div><div><dt>Fecha</dt><dd>{booking.preferredDate} · {booking.preferredTime}</dd></div></dl>
            <p className="review-note">Enviar la solicitud no genera un cobro. El artista confirmará precio y disponibilidad por mensaje.</p>
            <PrimaryButton onClick={() => void submit()} disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar solicitud'}</PrimaryButton>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
      {step < 3 && <WizardFooter step={Math.min(step, 2)} total={3} onBack={step === 0 ? onCancel : () => setStep((current) => current - 1)} onNext={next} nextDisabled={!valid} nextLabel="Siguiente" />}
      {step === 3 && <button className="review-back" type="button" onClick={() => setStep(2)}>← Editar datos</button>}
    </div>
  );
}
