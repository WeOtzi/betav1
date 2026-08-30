import { AppHeader, StatusBar } from '../../components/index.js';
import type { Conversation } from '../../lib/models.js';
import './messages.css';

export function InboxScreen({ conversations, onBack, onOpen }: { conversations: Conversation[]; onBack: () => void; onOpen: (id: string) => void }) {
  return <div className="messages-screen"><StatusBar /><AppHeader action="Cerrar" onAction={onBack} /><main><h1>Mensajes</h1>{conversations.map((item) => <button className="conversation-card" type="button" key={item.id} onClick={() => onOpen(item.id)}><span>{item.participantName.slice(0,2).toUpperCase()}</span><b>{item.participantName}</b><small>Abre la conversación</small><i>›</i></button>)}</main></div>;
}

