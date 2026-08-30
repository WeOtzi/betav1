import { useEffect, useState } from 'react';
import { StatusBar } from '../../components/index.js';
import type { Message } from '../../lib/models.js';
import './messages.css';

type Props = { participantName: string; messages: Message[]; loading: boolean; onBack: () => void; onSend: (body: string) => Promise<Message> };

export function ChatScreen({ participantName, messages, loading, onBack, onSend }: Props) {
  const [items, setItems] = useState(messages);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => setItems(messages), [messages]);
  async function submit() {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    try { const saved = await onSend(clean); setItems((current) => [...current, saved]); setBody(''); }
    finally { setSending(false); }
  }
  return <div className="chat-screen"><StatusBar /><header className="chat-header"><button type="button" onClick={onBack} aria-label="Volver">‹</button><div><strong>{participantName}</strong><small>En línea</small></div><span aria-hidden="true">•••</span></header><main aria-live="polite">{loading ? <p>Cargando conversación…</p> : items.map((item) => <p key={item.id} className={`bubble ${item.sender}`}>{item.body}</p>)}</main><form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}><label className="sr-only" htmlFor="message-body">Mensaje</label><input id="message-body" aria-label="Mensaje" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe un mensaje…" /><button type="submit" disabled={!body.trim() || sending} aria-label="Enviar">↑</button></form></div>;
}

