import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FormField, StatusBar, WizardFooter } from '../../components/index.js';
import {
  initialSetupDraft,
  reduceSetup,
  SETUP_STEP_COUNT,
  validateSetupStep,
  type SetupDraft,
  type SetupStep,
} from './setup-state.js';
import './onboarding.css';

const objectives = [
  'Conseguir más clientes',
  'Organizar mi agenda',
  'Vender mis diseños',
  'Conectar con artistas',
] as const;

const tattooStyles = ['Fine line', 'Blackwork', 'Realismo', 'Tradicional', 'Lettering', 'Color'] as const;

const avatars = [
  {
    label: 'Usar retrato principal',
    image: '/assets/figma/profile-avatar.png',
  },
  {
    label: 'Usar retrato alternativo',
    image: '/assets/figma/inspiration-avatar.png',
  },
] as const;

export type SetupSavePayload = Partial<
  Pick<
    SetupDraft,
    'objectives' | 'name' | 'email' | 'phone' | 'bio' | 'city' | 'styles' | 'avatarAsset' | 'onboardingCompleted'
  >
>;

export type SetupWizardProps = {
  initialDraft?: Partial<Omit<SetupDraft, 'step'>> & { step?: SetupStep };
  onSave: (patch: SetupSavePayload) => void | Promise<void>;
  onComplete: (draft: SetupDraft) => void | Promise<void>;
  onBack?: () => void;
};

function createDraft(initialDraft?: SetupWizardProps['initialDraft']): SetupDraft {
  return {
    ...initialSetupDraft,
    ...initialDraft,
    objectives: [...(initialDraft?.objectives ?? initialSetupDraft.objectives)],
    styles: [...(initialDraft?.styles ?? initialSetupDraft.styles)],
  };
}

function patchForStep(draft: SetupDraft): SetupSavePayload {
  switch (draft.step) {
    case 0:
      return { objectives: draft.objectives };
    case 1:
      return {
        name: draft.name.trim(),
        ...(draft.email.trim() ? { email: draft.email.trim().toLowerCase() } : {}),
        ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
        ...(draft.bio.trim() ? { bio: draft.bio.trim() } : {}),
      };
    case 2:
      return { city: draft.city.trim() };
    case 3:
      return { styles: draft.styles };
    case 4:
      return { avatarAsset: draft.avatarAsset, onboardingCompleted: true };
  }
}

export function SetupWizard({ initialDraft, onSave, onComplete, onBack }: SetupWizardProps) {
  const [draft, dispatch] = useReducer(reduceSetup, initialDraft, createDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus();
  }, []);
  const errors = useMemo(() => validateSetupStep(draft, draft.step), [draft]);
  const canContinue = Object.keys(errors).length === 0;

  useEffect(() => {
    setTouched({});
    setSaveError('');
  }, [draft.step]);

  async function next() {
    if (!canContinue || saving) return;

    setSaving(true);
    setSaveError('');
    try {
      await onSave(patchForStep(draft));
      if (draft.step === SETUP_STEP_COUNT - 1) {
        const completedDraft = { ...draft, onboardingCompleted: true };
        await onComplete(completedDraft);
        return;
      }
      dispatch({ type: 'go-to', step: (draft.step + 1) as SetupStep });
    } catch {
      setSaveError('No pudimos guardar tus cambios. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function back() {
    if (saving) return;
    if (draft.step === 0) {
      onBack?.();
      return;
    }
    dispatch({ type: 'go-to', step: (draft.step - 1) as SetupStep });
  }

  const markTouched = (field: string) => setTouched((current) => ({ ...current, [field]: true }));

  return (
    <main className="setup-screen">
      <StatusBar />
      <header className="setup-header">
        <p>WeÖtzi</p>
        <span>Paso {draft.step + 1} de {SETUP_STEP_COUNT}</span>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          className="setup-content"
          key={draft.step}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {draft.step === 0 ? (
            <>
              <p className="setup-kicker">PERSONALIZA TU EXPERIENCIA</p>
              <h1 ref={focusHeading} tabIndex={-1}>¿Qué quieres lograr?</h1>
              <p className="setup-description">Selecciona uno o varios objetivos. Podrás cambiarlos más adelante.</p>
              <div className="setup-choice-grid" aria-describedby="objectives-error">
                {objectives.map((objective) => {
                  const selected = draft.objectives.includes(objective);
                  return (
                    <button
                      type="button"
                      key={objective}
                      className={selected ? 'setup-choice is-selected' : 'setup-choice'}
                      aria-pressed={selected}
                      onClick={() => {
                        dispatch({ type: 'toggle-objective', objective });
                        markTouched('objectives');
                      }}
                    >
                      {objective}
                    </button>
                  );
                })}
              </div>
              <p id="objectives-error" className="setup-field-error" aria-live="polite">
                {touched.objectives ? errors.objectives : ''}
              </p>
            </>
          ) : null}

          {draft.step === 1 ? (
            <>
              <p className="setup-kicker">TU PERFIL</p>
              <h1 ref={focusHeading} tabIndex={-1}>Cuéntanos sobre ti</h1>
              <p className="setup-description">Estos datos ayudan a que las personas sepan quién está detrás de cada obra.</p>
              <div className="setup-fields">
                <FormField
                  label="Nombre"
                  name="name"
                  autoComplete="name"
                  value={draft.name}
                  error={touched.name ? errors.name : undefined}
                  onBlur={() => markTouched('name')}
                  onChange={(event) => dispatch({ type: 'set-profile', field: 'name', value: event.target.value })}
                />
                <FormField
                  label="Email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={draft.email}
                  helpText="Usaremos el email con el que te registraste."
                  onChange={(event) => dispatch({ type: 'set-profile', field: 'email', value: event.target.value })}
                />
                <FormField
                  label="Teléfono"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  helpText="Opcional"
                  onChange={(event) => dispatch({ type: 'set-profile', field: 'phone', value: event.target.value })}
                />
                <div className="setup-textarea-field">
                  <label htmlFor="setup-bio">Biografía</label>
                  <textarea
                    id="setup-bio"
                    name="bio"
                    rows={4}
                    maxLength={2000}
                    value={draft.bio}
                    placeholder="Cuéntales sobre tu trabajo y tu mirada artística"
                    onChange={(event) => dispatch({ type: 'set-profile', field: 'bio', value: event.target.value })}
                  />
                  <span>Opcional</span>
                </div>
              </div>
            </>
          ) : null}

          {draft.step === 2 ? (
            <>
              <p className="setup-kicker">UBICACIÓN</p>
              <h1 ref={focusHeading} tabIndex={-1}>¿Dónde tatúas?</h1>
              <p className="setup-description">Tu ciudad permite que te encuentren personas cercanas.</p>
              <div className="setup-fields">
                <FormField
                  label="Ciudad"
                  name="city"
                  autoComplete="address-level2"
                  value={draft.city}
                  placeholder="Ej. CDMX"
                  error={touched.city ? errors.city : undefined}
                  onBlur={() => markTouched('city')}
                  onChange={(event) => dispatch({ type: 'set-city', city: event.target.value })}
                />
              </div>
              <div className="setup-location-note">
                <img src="/assets/figma/location-icon.svg" alt="" />
                <p>No mostraremos tu dirección exacta.</p>
              </div>
            </>
          ) : null}

          {draft.step === 3 ? (
            <>
              <p className="setup-kicker">TU TRABAJO</p>
              <h1 ref={focusHeading} tabIndex={-1}>Elige tus estilos</h1>
              <p className="setup-description">Selecciona todos los estilos que representen tu trabajo.</p>
              <div className="setup-style-grid" aria-describedby="styles-error">
                {tattooStyles.map((style) => {
                  const selected = draft.styles.includes(style);
                  return (
                    <button
                      type="button"
                      key={style}
                      className={selected ? 'setup-style is-selected' : 'setup-style'}
                      aria-pressed={selected}
                      onClick={() => {
                        dispatch({ type: 'toggle-style', style });
                        markTouched('styles');
                      }}
                    >
                      {style}
                    </button>
                  );
                })}
              </div>
              <p id="styles-error" className="setup-field-error" aria-live="polite">
                {touched.styles ? errors.styles : ''}
              </p>
            </>
          ) : null}

          {draft.step === 4 ? (
            <>
              <p className="setup-kicker">ÚLTIMO DETALLE</p>
              <h1 ref={focusHeading} tabIndex={-1}>Elige tu foto</h1>
              <p className="setup-description">Esta imagen aparecerá en tu perfil y junto a tus diseños.</p>
              <div className="setup-avatar-grid" aria-describedby="avatar-error">
                {avatars.map((avatar) => {
                  const selected = draft.avatarAsset === avatar.image;
                  return (
                    <button
                      type="button"
                      key={avatar.image}
                      className={selected ? 'setup-avatar is-selected' : 'setup-avatar'}
                      aria-label={avatar.label}
                      aria-pressed={selected}
                      onClick={() => {
                        dispatch({ type: 'set-avatar', avatarAsset: avatar.image });
                        markTouched('avatarAsset');
                      }}
                    >
                      <img src={avatar.image} alt="" />
                      <span>{selected ? 'Seleccionada' : avatar.label.replace('Usar ', '')}</span>
                    </button>
                  );
                })}
              </div>
              <p id="avatar-error" className="setup-field-error" aria-live="polite">
                {touched.avatarAsset ? errors.avatarAsset : ''}
              </p>
            </>
          ) : null}
        </motion.section>
      </AnimatePresence>

      <p className="setup-save-error" role={saveError ? 'alert' : undefined} aria-live="assertive">
        {saveError}
      </p>
      <WizardFooter
        step={draft.step}
        steps={SETUP_STEP_COUNT}
        canContinue={canContinue}
        onBack={back}
        onNext={next}
        nextLabel={draft.step === SETUP_STEP_COUNT - 1 ? 'Terminar' : 'Continuar'}
        loading={saving}
      />
    </main>
  );
}
