import type { HTMLAttributes, ReactNode } from 'react';

export interface DeviceShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DeviceShell({ children, className = '', ...props }: DeviceShellProps) {
  return (
    <div className={`device-shell ${className}`.trim()} {...props}>
      <div className="device-shell__viewport">{children}</div>
    </div>
  );
}
