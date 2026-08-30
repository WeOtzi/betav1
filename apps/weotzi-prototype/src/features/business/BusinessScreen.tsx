import { AppHeader, BottomNav, StatusBar } from '../../components/index.js';
import type { Booking, Conversation, NavigationDestination } from '../../lib/models.js';
import './business.css';

type Props = {
  bookings: Booking[];
  conversations: Conversation[];
  onOpenConversation: (conversationId: string) => void;
  onNavigate: (destination: NavigationDestination) => void;
};

const seededInbox = [
  ['Roger Geidt', 'Tú: Buenísimo! Ya termino de…', '14:52'],
  ['Alfonso Franci', 'Tú: Dale, creo que va bien…', '11:05'],
  ['Pablo Diaz', 'Tú: Buena idea! Podríamos…', '09:42'],
  ['Susue Timer', 'Tú: Te parece si lo dejamos…', 'Ayer 22:45'],
] as const;

export function BusinessScreen({ bookings, conversations, onOpenConversation, onNavigate }: Props) {
  const upcoming = bookings.slice(0, 2);
  return (
    <div className="business-screen">
      <StatusBar />
      <AppHeader action={<img className="message-action-icon" src="/assets/figma/icon-message.svg" alt="" />} actionLabel="Mensajes" onAction={() => conversations[0] && onOpenConversation(conversations[0].id)} />
      <main className="business-content">
        <button className="complete-profile" type="button" onClick={() => onNavigate('profile')}>
          <span><strong>Completa tu perfil</strong><small>Accede a todos los beneficios</small></span><b aria-hidden="true">›</b>
        </button>
        <div className="earnings"><span>Total Ganancias</span><strong>$2,543</strong></div>
        <section className="business-section">
          <header><h1>Agenda</h1><button type="button">Ver más</button></header>
          <div className="agenda-row">
            {(upcoming.length ? upcoming : [null, null]).map((booking, index) => (
              <article key={booking?.id ?? index}>
                <strong>{booking?.preferredTime || (index ? '12:00' : '11:00')}</strong>
                <span>{booking?.customerName || (index ? 'Tiana Rosas' : 'Pablo Diaz')}</span>
              </article>
            ))}
          </div>
        </section>
        <section className="business-section inbox-preview">
          <header><h2>Inbox</h2><button type="button" onClick={() => conversations[0] && onOpenConversation(conversations[0].id)}>Ver más</button></header>
          {(conversations.length ? conversations.slice(0, 4).map((conversation, index) => [conversation.participantName, index ? 'Nueva solicitud de diseño…' : 'Tú: Revisaré tu referencia…', index ? 'Ahora' : '14:52', conversation.id] as const) : seededInbox.map((row) => [...row, 'demo'] as const)).map(([name, preview, time, id]) => (
            <button key={`${id}-${name}`} type="button" className="inbox-row" onClick={() => onOpenConversation(id)}>
              <span className="initials">{name.split(' ').map((part) => part[0]).slice(0,2).join('')}</span>
              <span className="inbox-copy"><strong>{name}</strong><small>{preview}</small></span>
              <time>{time}</time>
            </button>
          ))}
        </section>
      </main>
      <BottomNav active="business" onNavigate={onNavigate} />
    </div>
  );
}
