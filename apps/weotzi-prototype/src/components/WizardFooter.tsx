import { figmaAssets } from './assets';

export interface WizardFooterProps {
  backDisabled?: boolean;
  backLabel?: string;
  canContinue?: boolean;
  className?: string;
  loading?: boolean;
  nextDisabled?: boolean;
  nextLabel?: string;
  onBack: () => void;
  onNext: () => void;
  step: number;
  steps?: number;
  total?: number;
}

export function WizardFooter({
  backDisabled = false,
  backLabel = 'Volver',
  canContinue,
  className = '',
  loading = false,
  nextDisabled,
  nextLabel = 'Continuar',
  onBack,
  onNext,
  step,
  steps,
  total,
}: WizardFooterProps) {
  const stepCount = Math.max(1, total ?? steps ?? 1);
  const currentStep = Math.min(Math.max(step, 0), stepCount - 1);
  const isNextDisabled = loading || nextDisabled === true || canContinue === false;

  return (
    <footer className={`wizard-footer ${className}`.trim()}>
      <button
        type="button"
        className="wizard-footer__button wizard-footer__button--back"
        aria-label={backLabel}
        disabled={backDisabled || loading}
        onClick={onBack}
      >
        <img className="wizard-footer__circle" src={figmaAssets.wizardBackCircle} alt="" />
        <img className="wizard-footer__arrow" src={figmaAssets.wizardBackArrow} alt="" />
      </button>

      <ol className="wizard-footer__progress" aria-label="Progreso">
        {Array.from({ length: stepCount }, (_, index) => (
          <li
            key={index}
            className={`wizard-footer__dot${index === currentStep ? ' wizard-footer__dot--active' : ''}`}
            aria-label={`Paso ${index + 1} de ${stepCount}`}
            aria-current={index === currentStep ? 'step' : undefined}
          />
        ))}
      </ol>

      <button
        type="button"
        className="wizard-footer__button wizard-footer__button--next"
        aria-label={nextLabel}
        aria-busy={loading || undefined}
        disabled={isNextDisabled}
        onClick={onNext}
      >
        <img className="wizard-footer__circle" src={figmaAssets.wizardNextCircle} alt="" />
        <img className="wizard-footer__arrow" src={figmaAssets.wizardNextArrow} alt="" />
      </button>
    </footer>
  );
}
