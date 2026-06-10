-- Web/local merge support tables for support chat, currency normalization,
-- and email routing defaults. All statements are idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.support_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anonymous_id TEXT,
    user_id UUID,
    user_role TEXT NOT NULL DEFAULT 'anonymous',
    status TEXT NOT NULL DEFAULT 'bot'
        CHECK (status IN ('bot', 'awaiting_human', 'human', 'closed')),
    page_context TEXT,
    assigned_support_user_id UUID,
    ticket_id UUID,
    escalation_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'human_agent', 'tool')),
    content TEXT NOT NULL,
    author_user_id UUID,
    model TEXT,
    tool_calls JSONB,
    tool_results JSONB,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_user_id ON public.support_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_anonymous_id ON public.support_conversations(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_status ON public.support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_support_conversations_last_message_at ON public.support_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_id ON public.support_messages(conversation_id, created_at);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support users can read support conversations" ON public.support_conversations;
CREATE POLICY "Support users can read support conversations"
    ON public.support_conversations FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.support_users_db su
        WHERE su.user_id = auth.uid() AND su.is_active = true
    ));

DROP POLICY IF EXISTS "Support users can update support conversations" ON public.support_conversations;
CREATE POLICY "Support users can update support conversations"
    ON public.support_conversations FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.support_users_db su
        WHERE su.user_id = auth.uid() AND su.is_active = true
    ));

DROP POLICY IF EXISTS "Users can read own support conversations" ON public.support_conversations;
CREATE POLICY "Users can read own support conversations"
    ON public.support_conversations FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Support users can read support messages" ON public.support_messages;
CREATE POLICY "Support users can read support messages"
    ON public.support_messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.support_users_db su
        WHERE su.user_id = auth.uid() AND su.is_active = true
    ));

DROP POLICY IF EXISTS "Users can read own support messages" ON public.support_messages;
CREATE POLICY "Users can read own support messages"
    ON public.support_messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.support_conversations sc
        WHERE sc.id = support_messages.conversation_id AND sc.user_id = auth.uid()
    ));

CREATE OR REPLACE FUNCTION public.touch_support_conversation_from_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.support_conversations
    SET last_message_at = NEW.created_at,
        updated_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_support_conversation_from_message ON public.support_messages;
CREATE TRIGGER trg_touch_support_conversation_from_message
    AFTER INSERT ON public.support_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_support_conversation_from_message();

CREATE TABLE IF NOT EXISTS public.currencies (
    code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
    name TEXT NOT NULL,
    symbol TEXT,
    decimals INTEGER NOT NULL DEFAULT 2,
    units_per_usd NUMERIC NOT NULL CHECK (units_per_usd > 0),
    units_per_eur NUMERIC NOT NULL CHECK (units_per_eur > 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT
);

CREATE TABLE IF NOT EXISTS public.currency_refresh_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT,
    currencies_updated INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
    error_message TEXT,
    raw_payload JSONB,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_refresh_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active currencies" ON public.currencies;
CREATE POLICY "Public can read active currencies"
    ON public.currencies FOR SELECT TO public
    USING (is_active = true);

DROP POLICY IF EXISTS "Superadmin can manage currencies" ON public.currencies;
CREATE POLICY "Superadmin can manage currencies"
    ON public.currencies FOR ALL TO authenticated
    USING (LOWER(auth.jwt() ->> 'email') = 'isai@weotzi.com')
    WITH CHECK (LOWER(auth.jwt() ->> 'email') = 'isai@weotzi.com');

DROP POLICY IF EXISTS "Superadmin can read currency refresh logs" ON public.currency_refresh_logs;
CREATE POLICY "Superadmin can read currency refresh logs"
    ON public.currency_refresh_logs FOR SELECT TO authenticated
    USING (LOWER(auth.jwt() ->> 'email') = 'isai@weotzi.com');

INSERT INTO public.currencies (code, name, symbol, decimals, units_per_usd, units_per_eur, source)
VALUES
    ('USD', 'US Dollar', '$', 2, 1, 0.92, 'seed'),
    ('EUR', 'Euro', 'EUR', 2, 1.087, 1, 'seed')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT,
    setting_type TEXT NOT NULL DEFAULT 'text'
        CHECK (setting_type IN ('text', 'html', 'json', 'number', 'boolean')),
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read for public settings" ON public.app_settings;
CREATE POLICY "Allow public read for public settings"
    ON public.app_settings FOR SELECT TO public
    USING (is_public = true);

DROP POLICY IF EXISTS "Superadmin can manage app settings" ON public.app_settings;
CREATE POLICY "Superadmin can manage app settings"
    ON public.app_settings FOR ALL TO authenticated
    USING (LOWER(auth.jwt() ->> 'email') = 'isai@weotzi.com')
    WITH CHECK (LOWER(auth.jwt() ->> 'email') = 'isai@weotzi.com');

INSERT INTO public.app_settings (setting_key, setting_value, setting_type, description, is_public)
VALUES
    ('email_routing', '{}', 'json', 'Per-event transactional email routing: n8n, billionmail, dual, or off.', false)
ON CONFLICT (setting_key) DO NOTHING;
