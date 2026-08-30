import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  error?: string;
  helpText?: string;
  label: string;
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  {
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    className = '',
    containerClassName = '',
    error,
    helpText,
    id,
    label,
    required,
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId.replaceAll(':', '')}`;
  const helpId = helpText ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptionIds = [describedBy, helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`form-field${error ? ' form-field--error' : ''} ${containerClassName}`.trim()}>
      <label className="form-field__label" htmlFor={inputId}>
        {label}
        {required ? <span className="form-field__required" aria-hidden="true"> *</span> : null}
      </label>
      <input
        {...inputProps}
        ref={ref}
        id={inputId}
        className={`form-field__input ${className}`.trim()}
        required={required}
        aria-describedby={descriptionIds}
        aria-errormessage={errorId}
        aria-invalid={error ? true : invalid}
      />
      {helpText ? (
        <span id={helpId} className="form-field__help">
          {helpText}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="form-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});

export interface SegmentedChoiceOption {
  disabled?: boolean;
  label: string;
  value: string;
}

export interface SegmentedChoiceProps {
  className?: string;
  disabled?: boolean;
  error?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: readonly SegmentedChoiceOption[];
  value?: string;
}

export function SegmentedChoice({
  className = '',
  disabled = false,
  error,
  label,
  name,
  onChange,
  options,
  value,
}: SegmentedChoiceProps) {
  const generatedId = useId().replaceAll(':', '');
  const errorId = error ? `${name}-${generatedId}-error` : undefined;

  return (
    <fieldset
      className={`segmented-choice${error ? ' segmented-choice--error' : ''} ${className}`.trim()}
      aria-describedby={errorId}
      disabled={disabled}
    >
      <legend className="segmented-choice__label">{label}</legend>
      <input type="hidden" name={name} value={value ?? ''} />
      <div className="segmented-choice__options">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`segmented-choice__option${selected ? ' segmented-choice__option--selected' : ''}`}
              aria-pressed={selected}
              disabled={disabled || option.disabled}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <span id={errorId} className="segmented-choice__error" role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
