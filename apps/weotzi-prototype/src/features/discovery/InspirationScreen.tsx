import { useMemo, useState, type UIEvent } from 'react';
import { AppHeader, BottomNav, PhotoCard, StatusBar } from '../../components/index.js';
import type { NavigationDestination, PortfolioItem } from '../../lib/models.js';
import './discovery.css';

type Props = {
  portfolio: PortfolioItem[];
  favorites: string[];
  onOpenProfile: (itemId: string) => void;
  onToggleFavorite: (itemId: string) => Promise<boolean>;
  onNavigate: (destination: NavigationDestination) => void;
  onOpenInbox?: () => void;
};

export function InspirationScreen({
  portfolio,
  favorites,
  onOpenProfile,
  onToggleFavorite,
  onNavigate,
  onOpenInbox,
}: Props) {
  const [compact, setCompact] = useState(false);
  const [localFavorites, setLocalFavorites] = useState(() => new Set(favorites));
  const favoriteIds = useMemo(() => localFavorites, [localFavorites]);
  const orderedPortfolio = useMemo(() => {
    const order = ['Woman', 'Bird', 'Snake', 'Inspiration', 'Flowers', 'Little Kid'];
    return [...portfolio].sort((left, right) => order.indexOf(left.title) - order.indexOf(right.title));
  }, [portfolio]);
  const columns = [orderedPortfolio.filter((_, index) => index % 2 === 0), orderedPortfolio.filter((_, index) => index % 2 === 1)];

  function handleScroll(event: UIEvent<HTMLElement>) {
    setCompact(event.currentTarget.scrollTop > 54);
  }

  async function toggle(itemId: string) {
    const favorite = await onToggleFavorite(itemId);
    setLocalFavorites((current) => {
      const next = new Set(current);
      if (favorite) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  return (
    <div className={`discovery-screen ${compact ? 'is-compact' : ''}`}>
      <div className="discovery-fixed-header">
        <StatusBar />
        <AppHeader action={<img className="message-action-icon" src="/assets/figma/icon-message.svg" alt="" />} actionLabel="Mensajes" onAction={onOpenInbox} />
      </div>
      <main className="discovery-scroll" onScroll={handleScroll}>
        <section className="discovery-greeting" aria-label="Bienvenida">
          <img src="/assets/figma/inspiration-avatar.png" alt="El Charlatán" />
          <div>
            <h1>¡Hola, Charlatán!</h1>
            <p>Descubre nuevas ideas en nuestra comunidad de tatuadores</p>
          </div>
        </section>
        <section className="masonry-gallery" aria-label="Inspiración">
          {columns.map((column, columnIndex) => (
            <div className="masonry-column" key={columnIndex}>
              {column.map((item) => (
                <PhotoCard
                  key={item.id}
                  title={item.title}
                  artist={item.artist}
                  image={item.imageAsset}
                  imageAlt={`Tatuaje ${item.title} de ${item.artist}`}
                  height={item.height}
                  favorite={favoriteIds.has(item.id)}
                  onFavorite={() => void toggle(item.id)}
                  onOpen={() => onOpenProfile(item.id)}
                />
              ))}
            </div>
          ))}
        </section>
      </main>
      <BottomNav active="home" onNavigate={onNavigate} />
    </div>
  );
}
