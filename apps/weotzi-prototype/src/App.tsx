import { useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { DeviceShell, ScreenTransition } from './components/index.js';
import { api } from './lib/api.js';
import type { BootstrapData, Message, NavigationDestination, Profile } from './lib/models.js';
import { BookingWizard } from './features/bookings/BookingWizard.js';
import { BusinessScreen } from './features/business/BusinessScreen.js';
import { InspirationScreen } from './features/discovery/InspirationScreen.js';
import { EntryFlow } from './features/entry/EntryFlow.js';
import { ChatScreen } from './features/messages/ChatScreen.js';
import { InboxScreen } from './features/messages/InboxScreen.js';
import { PublicProfileScreen } from './features/profile/PublicProfileScreen.js';

type AppRoutesProps = { initialBootstrap?: BootstrapData };

function RouteFocus() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('main h1, main h2, header h1');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  return null;
}

function ConversationRoute({ data }: { data: BootstrapData }) {
  const { id = 'demo' } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const conversation = data.conversations.find((item) => item.id === id);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.messages(id).then((items) => current && setMessages(items)).catch(() => current && setError('No pudimos cargar la conversación.')).finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [id]);

  async function send(body: string) {
    setError('');
    try { return await api.sendMessage(id, body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos enviar el mensaje.'); throw cause; }
  }

  return <>{error && <div className="app-toast" role="alert">{error}</div>}<ChatScreen participantName={conversation?.participantName ?? 'El Charlatán'} messages={messages} loading={loading} onBack={() => navigate('/messages')} onSend={send} /></>;
}

export function AppRoutes({ initialBootstrap }: AppRoutesProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<BootstrapData | null>(initialBootstrap ?? null);
  const [loading, setLoading] = useState(!initialBootstrap);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    setLoadError('');
    try { setData(await api.bootstrap()); }
    catch { setLoadError('No pudimos abrir los datos locales. Verifica que el servidor esté iniciado.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!initialBootstrap) void refresh(); }, [initialBootstrap, refresh]);

  function go(destination: NavigationDestination) {
    navigate(destination === 'home' ? '/app/inspiration' : destination === 'business' ? '/app/business' : '/profile/el-charlatan');
  }

  async function toggleFavorite(id: string) {
    const { favorite } = await api.toggleFavorite(id);
    setData((current) => current ? { ...current, favorites: favorite ? [...new Set([...current.favorites, id])] : current.favorites.filter((item) => item !== id) } : current);
    return favorite;
  }

  const protectedScreen = (content: React.ReactNode) => {
    if (loading) return <div className="app-state" role="status"><span className="app-spinner" />Preparando tu estudio…</div>;
    if (!data || loadError) return <div className="app-state"><h1>No pudimos iniciar</h1><p>{loadError}</p><button type="button" onClick={() => void refresh()}>Reintentar</button></div>;
    return content;
  };

  return (
    <DeviceShell>
      <RouteFocus />
      <ScreenTransition key={location.pathname}>
        <Routes>
          <Route path="/" element={<EntryFlow onJoinWaitlist={async (email) => { await api.joinWaitlist(email); }} onVerify={async (email, code) => { await api.verify(email, code); }} onSaveProfile={async (patch) => { const result = await api.updateProfile(patch as Partial<Profile>); setData((current) => current ? { ...current, profile: result.profile } : current); }} onComplete={() => { void refresh(); navigate('/app/inspiration'); }} />} />
          <Route path="/app/inspiration" element={protectedScreen(data ? <InspirationScreen portfolio={data.portfolio} favorites={data.favorites} onOpenProfile={() => navigate('/profile/el-charlatan')} onToggleFavorite={toggleFavorite} onNavigate={go} onOpenInbox={() => navigate('/messages')} /> : null)} />
          <Route path="/app/business" element={protectedScreen(data ? <BusinessScreen bookings={data.bookings} conversations={data.conversations} onOpenConversation={(id) => navigate(`/messages/${id}`)} onNavigate={go} /> : null)} />
          <Route path="/profile/el-charlatan" element={<PublicProfileScreen onBack={() => navigate('/app/inspiration')} onBookCustom={() => navigate('/book/custom')} onBookFlash={() => navigate('/book/flash')} />} />
          <Route path="/book/:kind" element={protectedScreen(data ? <BookingRoute onRefresh={refresh} /> : null)} />
          <Route path="/messages" element={protectedScreen(data ? <InboxScreen conversations={data.conversations} onBack={() => navigate('/app/business')} onOpen={(id) => navigate(`/messages/${id}`)} /> : null)} />
          <Route path="/messages/:id" element={protectedScreen(data ? <ConversationRoute data={data} /> : null)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScreenTransition>
    </DeviceShell>
  );
}

function BookingRoute({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const { kind } = useParams();
  const navigate = useNavigate();
  const bookingKind = kind === 'flash' ? 'flash' : 'custom';
  return <BookingWizard kind={bookingKind} onCancel={() => navigate('/profile/el-charlatan')} onComplete={async (input) => { const result = await api.createBooking(input); await onRefresh(); return { bookingId: result.booking.id, conversationId: result.conversation.id }; }} onOpenChat={(id) => navigate(`/messages/${id}`)} onGoHome={() => navigate('/app/inspiration')} />;
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
