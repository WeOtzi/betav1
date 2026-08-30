import { figmaAssets } from './assets';

export interface StatusBarProps {
  className?: string;
  light?: boolean;
  time?: string;
}

export function StatusBar({ className = '', light = false, time = '14:41' }: StatusBarProps) {
  return (
    <div
      className={`status-bar${light ? ' status-bar--light' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className="status-bar__time">{time}</span>
      <img className="status-bar__indicators" src={figmaAssets.statusRight} alt="" />
    </div>
  );
}
