import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import type { MouseEvent } from 'react';

import { figmaAssets } from './assets';

export type BottomDestination = 'home' | 'business' | 'profile';

export interface BottomNavProps {
  active?: BottomDestination;
  className?: string;
  onNavigate?: (destination: BottomDestination) => void;
}

const destinations = [
  {
    id: 'home',
    label: 'Inicio',
    href: '/app/inspiration',
    icon: figmaAssets.navHome,
    activeIcon: figmaAssets.navHomeActive,
  },
  {
    id: 'business',
    label: 'Negocio',
    href: '/app/business',
    icon: figmaAssets.navBusiness,
    activeIcon: figmaAssets.navBusinessActive,
  },
  {
    id: 'profile',
    label: 'Perfil',
    href: '/profile/el-charlatan',
    icon: figmaAssets.navProfile,
    activeIcon: figmaAssets.navProfile,
  },
] as const;

function destinationFromPath(pathname: string): BottomDestination {
  if (pathname.startsWith('/app/business')) return 'business';
  if (pathname === '/profile' || pathname.startsWith('/profile/') || pathname.startsWith('/app/profile')) {
    return 'profile';
  }
  return 'home';
}

function BottomNavContent({
  active,
  className = '',
  onNavigate,
  routerLinks,
}: BottomNavProps & { active: BottomDestination; routerLinks: boolean }) {
  return (
    <nav className={`bottom-nav ${className}`.trim()} aria-label="Navegación principal">
      {destinations.map((destination) => {
        const isActive = destination.id === active;
        const content = (
          <>
            <img
              className="bottom-nav__icon"
              src={isActive ? destination.activeIcon : destination.icon}
              alt=""
              aria-hidden="true"
            />
            <span>{destination.label}</span>
          </>
        );
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (!onNavigate) return;
          event.preventDefault();
          onNavigate(destination.id);
        };
        const commonProps = {
          'aria-current': isActive ? ('page' as const) : undefined,
          className: `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`,
          onClick: handleClick,
        };

        return routerLinks ? (
          <Link key={destination.id} to={destination.href} {...commonProps}>
            {content}
          </Link>
        ) : (
          <a
            key={destination.id}
            href={destination.href}
            {...commonProps}
          >
            {content}
          </a>
        );
      })}
    </nav>
  );
}

function RouteAwareBottomNav(props: Omit<BottomNavProps, 'active'>) {
  const { pathname } = useLocation();
  return <BottomNavContent {...props} active={destinationFromPath(pathname)} routerLinks />;
}

export function BottomNav(props: BottomNavProps) {
  const isInsideRouter = useInRouterContext();

  if (props.active) {
    return <BottomNavContent {...props} active={props.active} routerLinks={isInsideRouter} />;
  }

  if (isInsideRouter) return <RouteAwareBottomNav {...props} />;

  return <BottomNavContent {...props} active="home" routerLinks={false} />;
}
