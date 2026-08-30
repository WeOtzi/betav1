import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean;
  loading?: boolean;
  variant?: 'dark' | 'light' | 'ghost';
}

export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(function PrimaryButton(
  {
    children,
    className = '',
    disabled,
    fullWidth = true,
    loading = false,
    type = 'button',
    variant = 'dark',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`primary-button primary-button--${variant}${fullWidth ? ' primary-button--full' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="primary-button__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
});
