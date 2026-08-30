import type { HTMLAttributes, ReactNode } from 'react';

export interface BrandProps extends HTMLAttributes<HTMLSpanElement> {}

export function Brand({ className = '', ...props }: BrandProps) {
  return (
    <span className={`brand ${className}`.trim()} {...props}>
      WeÖtzi
    </span>
  );
}

export interface AppHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  sticky?: boolean;
  title?: ReactNode;
}

export function AppHeader({
  action,
  actionLabel,
  className = '',
  onAction,
  sticky = true,
  title = <Brand />,
  ...props
}: AppHeaderProps) {
  const renderedAction = onAction ? (
    <button
      type="button"
      className="app-header__action"
      aria-label={actionLabel}
      onClick={onAction}
    >
      {action}
    </button>
  ) : (
    action
  );

  return (
    <header
      className={`app-header${sticky ? ' app-header--sticky' : ''} ${className}`.trim()}
      {...props}
    >
      <div className="app-header__title">{title}</div>
      {renderedAction ? <div className="app-header__action-slot">{renderedAction}</div> : null}
    </header>
  );
}
