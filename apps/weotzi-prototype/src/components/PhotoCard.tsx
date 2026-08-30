import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';

export interface PhotoCardProps {
  artist?: string;
  className?: string;
  favorite?: boolean;
  height?: number;
  image: string;
  imageAlt?: string;
  onFavorite?: () => void;
  onOpen: () => void;
  priority?: boolean;
  title: string;
}

export function PhotoCard({
  artist,
  className = '',
  favorite = false,
  height = 221,
  image,
  imageAlt = '',
  onFavorite,
  onOpen,
  priority = false,
  title,
}: PhotoCardProps) {
  const reduceMotion = useReducedMotion();
  const style = { '--photo-card-height': `${height}px` } as CSSProperties;

  return (
    <motion.article
      className={`photo-card ${className}`.trim()}
      style={style}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <img
        className="photo-card__image"
        src={image}
        alt={imageAlt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
      <div className="photo-card__gradient" aria-hidden="true" />
      <div className="photo-card__caption" aria-hidden="true">
        <strong>{title}</strong>
        {artist ? <span>{artist}</span> : null}
      </div>
      <button type="button" className="photo-card__open" aria-label={`Abrir ${title}`} onClick={onOpen} />
      {onFavorite ? (
        <button
          type="button"
          className={`photo-card__favorite${favorite ? ' photo-card__favorite--active' : ''}`}
          aria-label={`${favorite ? 'Quitar de guardados' : 'Guardar'} ${title}`}
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          <span aria-hidden="true">{favorite ? '♥' : '♡'}</span>
        </button>
      ) : null}
    </motion.article>
  );
}
