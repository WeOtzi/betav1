import { figmaAssets } from './assets';

export interface SafariBarProps {
  className?: string;
  domain?: string;
}

export function SafariBar({ className = '', domain = 'weotzi.com' }: SafariBarProps) {
  return (
    <div className={`safari-bar ${className}`.trim()} aria-hidden="true">
      <div className="safari-bar__address">
        <img className="safari-bar__aa" src={figmaAssets.safariAa} alt="" />
        <span className="safari-bar__domain">
          <img className="safari-bar__lock" src={figmaAssets.safariLock} alt="" />
          {domain}
        </span>
        <img className="safari-bar__refresh" src={figmaAssets.safariRefresh} alt="" />
      </div>
    </div>
  );
}
