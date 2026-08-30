import { useState } from 'react';
import { AppHeader, PrimaryButton, StatusBar } from '../../components/index.js';
import './profile.css';

type ProfileTab = 'Trabajos' | 'Tienda' | 'Sobre mí' | 'Reseñas';

type Props = {
  onBack: () => void;
  onBookCustom: () => void;
  onBookFlash: () => void;
};

const works = [
  ['/assets/figma/profile-pirate.png', 'Pirate'],
  ['/assets/figma/profile-polaroid.png', 'Foto Polaroid'],
  ['/assets/figma/profile-kid.png', 'Little Kid'],
  ['/assets/figma/profile-panther.png', 'Pantera Negra'],
  ['/assets/figma/profile-work-3.png', 'Diseño geométrico'],
  ['/assets/figma/profile-work-6.png', 'Medusa'],
] as const;

export function PublicProfileScreen({ onBack, onBookCustom, onBookFlash }: Props) {
  const [tab, setTab] = useState<ProfileTab>('Trabajos');

  return (
    <div className="public-profile-screen">
      <div className="profile-header">
        <StatusBar />
        <AppHeader action="Compartir" onAction={() => void navigator.clipboard?.writeText(location.href)} />
      </div>
      <main className="profile-scroll">
        <button className="profile-back" type="button" onClick={onBack} aria-label="Volver a inspiración">←</button>
        <section className="profile-intro">
          <img className="profile-avatar" src="/assets/figma/profile-avatar.png" alt="El Charlatán" />
          <div className="profile-identity">
            <h1>El Charlatán</h1>
            <span className="availability"><span aria-hidden="true" />Disponible</span>
            <p className="profile-location">⌾ CDMX</p>
          </div>
          <p className="profile-bio">Artista de la piel. Soy de Mexico City 🇲🇽 y estoy transformando ideas en tatuajes únicos 🎨✨</p>
        </section>

        <div className="profile-tabs" role="tablist" aria-label="Contenido del perfil">
          {(['Trabajos', 'Tienda', 'Sobre mí', 'Reseñas'] as ProfileTab[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === 'Trabajos' && (
          <section className="profile-gallery" aria-label="Trabajos">
            {[works.filter((_, index) => index % 2 === 0), works.filter((_, index) => index % 2 === 1)].map((column, columnIndex) => (
              <div className="profile-gallery-column" key={columnIndex}>
                {column.map(([src, label]) => {
                  const originalIndex = works.findIndex(([workSrc]) => workSrc === src);
                  return <figure key={src} className={`profile-work work-${originalIndex + 1}`}><img src={src} alt={`Tatuaje ${label}`} /><figcaption>{label}</figcaption></figure>;
                })}
              </div>
            ))}
          </section>
        )}

        {tab === 'Tienda' && (
          <section className="profile-tab-panel profile-shop" role="tabpanel">
            <p className="eyebrow">FLASH DISPONIBLES</p>
            <h2>Piezas listas para reservar</h2>
            <div className="flash-offer">
              <img src="/assets/figma/profile-work-3.png" alt="Flash ornamental disponible" />
              <div><strong>Ornamental 04</strong><span>Desde $120</span></div>
              <button type="button" onClick={onBookFlash}>Reservar flash</button>
            </div>
          </section>
        )}

        {tab === 'Sobre mí' && (
          <section className="profile-tab-panel" role="tabpanel">
            <p className="eyebrow">SOBRE EL ARTISTA</p>
            <h2>Fine line y microrealismo con identidad propia</h2>
            <p>Trabajo cada pieza como una conversación: escucho la idea, cuido el detalle y diseño pensando en cómo vivirá sobre tu piel.</p>
            <dl className="profile-details"><div><dt>Estudio</dt><dd>Charlatán Tattoo</dd></div><div><dt>Experiencia</dt><dd>8 años</dd></div></dl>
          </section>
        )}

        {tab === 'Reseñas' && (
          <section className="profile-tab-panel" role="tabpanel">
            <p className="rating">4.9 <span>★★★★★</span></p>
            <p>“Entendió exactamente lo que quería y el resultado quedó incluso mejor.”</p>
            <small>— Sofía, cita verificada</small>
          </section>
        )}
      </main>
      <div className="profile-bottom-fade" aria-hidden="true" />
      <div className="profile-cta"><PrimaryButton onClick={onBookCustom}>Quiero un diseño personalizado</PrimaryButton></div>
    </div>
  );
}
