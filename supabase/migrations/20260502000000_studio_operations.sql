-- Phase D — Operations
-- Tables: studio_jobs_log, studio_invoices, studio_invoice_items,
-- studio_documents, studio_document_attachments.
--
-- Invoices in v1 are an INTERNAL LEDGER — no fiscal numbering, no PDF.
-- Per the approved plan, fiscal-grade invoicing is Phase G (post-v1).

BEGIN;

-- ============================================================
-- studio_jobs_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_jobs_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id            UUID NOT NULL REFERENCES public.studios(id)         ON DELETE CASCADE,
  location_id          UUID          REFERENCES public.studio_locations(id) ON DELETE SET NULL,
  artist_user_id       UUID NOT NULL REFERENCES public.artists_db(user_id)  ON DELETE RESTRICT,
  client_user_id       UUID,                                          -- intentionally not FK (clients_db is fluid)
  client_display_name  TEXT,
  client_email         TEXT,
  quotation_id         UUID          REFERENCES public.quotations_db(id) ON DELETE SET NULL,

  performed_at         TIMESTAMPTZ NOT NULL,
  duration_hours       NUMERIC(5,2),

  gross_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  gross_currency       TEXT          NOT NULL DEFAULT 'USD',
  artist_split_amount  NUMERIC(10,2),
  studio_split_amount  NUMERIC(10,2),
  supplies_cost        NUMERIC(10,2),

  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'voided')),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_jobs_studio_date ON public.studio_jobs_log (studio_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_artist      ON public.studio_jobs_log (artist_user_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_quotation   ON public.studio_jobs_log (quotation_id) WHERE quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_client      ON public.studio_jobs_log (client_user_id) WHERE client_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_jobs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;
DROP TRIGGER IF EXISTS trigger_jobs_updated_at ON public.studio_jobs_log;
CREATE TRIGGER trigger_jobs_updated_at BEFORE UPDATE ON public.studio_jobs_log FOR EACH ROW EXECUTE FUNCTION public.set_jobs_updated_at();

-- ============================================================
-- studio_invoices  (internal ledger; not legal-grade)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id           UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,

  invoice_number      TEXT NOT NULL,                             -- human-facing reference, free-form
  client_user_id      UUID,
  billed_to_name      TEXT,
  billed_to_tax_id    TEXT,
  billed_to_email     TEXT,
  billed_to_address   TEXT,

  issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date            DATE,

  currency            TEXT NOT NULL DEFAULT 'USD',
  subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  paid_at             TIMESTAMPTZ,
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT studio_invoices_unique_number UNIQUE (studio_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_studio_date ON public.studio_invoices (studio_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON public.studio_invoices (studio_id, status);

CREATE OR REPLACE FUNCTION public.set_invoices_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;
DROP TRIGGER IF EXISTS trigger_invoices_updated_at ON public.studio_invoices;
CREATE TRIGGER trigger_invoices_updated_at BEFORE UPDATE ON public.studio_invoices FOR EACH ROW EXECUTE FUNCTION public.set_invoices_updated_at();

-- ============================================================
-- studio_invoice_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_invoice_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES public.studio_invoices(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'custom'
    CHECK (kind IN ('quotation', 'session', 'custom')),
  quotation_id        UUID REFERENCES public.quotations_db(id) ON DELETE SET NULL,
  job_log_id          UUID REFERENCES public.studio_jobs_log(id) ON DELETE SET NULL,
  artist_user_id      UUID,
  description         TEXT NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total          NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.studio_invoice_items (invoice_id);

-- Trigger: keep studio_invoices.subtotal/total in sync with item changes.
CREATE OR REPLACE FUNCTION public.recompute_invoice_totals()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE inv UUID;
BEGIN
  inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  UPDATE public.studio_invoices i SET
    subtotal     = COALESCE((SELECT SUM(line_total) FROM public.studio_invoice_items WHERE invoice_id = i.id), 0),
    total_amount = COALESCE((SELECT SUM(line_total) FROM public.studio_invoice_items WHERE invoice_id = i.id), 0) + COALESCE(i.tax_amount, 0)
  WHERE i.id = inv;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trigger_invoice_totals ON public.studio_invoice_items;
CREATE TRIGGER trigger_invoice_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.studio_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_invoice_totals();

-- ============================================================
-- studio_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id            UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL DEFAULT 'custom'
    CHECK (kind IN ('consent', 'release', 'contract', 'nda', 'price_list', 'custom')),
  title                TEXT NOT NULL,
  description          TEXT,
  storage_path         TEXT,
  file_url             TEXT,
  is_template          BOOLEAN NOT NULL DEFAULT false,
  is_public            BOOLEAN NOT NULL DEFAULT false,
  requires_signature   BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id   UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_documents_studio ON public.studio_documents (studio_id);
CREATE INDEX IF NOT EXISTS idx_documents_kind   ON public.studio_documents (studio_id, kind);

-- ============================================================
-- studio_document_attachments  (polymorphic)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_document_attachments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          UUID NOT NULL REFERENCES public.studio_documents(id) ON DELETE CASCADE,
  attached_to_kind     TEXT NOT NULL
    CHECK (attached_to_kind IN ('quotation', 'invoice', 'membership', 'spot_application', 'job_log')),
  attached_to_id       UUID NOT NULL,
  signed_at            TIMESTAMPTZ,
  signer_name          TEXT,
  signer_signature_url TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_doc_attach_doc    ON public.studio_document_attachments (document_id);
CREATE INDEX IF NOT EXISTS idx_doc_attach_target ON public.studio_document_attachments (attached_to_kind, attached_to_id);

-- ============================================================
-- RLS  (every table: owner+support; jobs additionally readable by the artist on their own row)
-- ============================================================
ALTER TABLE public.studio_jobs_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_document_attachments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_studio_or_artist_select" ON public.studio_jobs_log;
DROP POLICY IF EXISTS "jobs_studio_full"             ON public.studio_jobs_log;
CREATE POLICY "jobs_studio_or_artist_select" ON public.studio_jobs_log FOR SELECT
  USING (auth.uid() IS NOT NULL AND (
    auth.uid() = artist_user_id
    OR EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));
CREATE POLICY "jobs_studio_full" ON public.studio_jobs_log FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "invoices_studio_full" ON public.studio_invoices;
CREATE POLICY "invoices_studio_full" ON public.studio_invoices FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "invoice_items_studio_full" ON public.studio_invoice_items;
CREATE POLICY "invoice_items_studio_full" ON public.studio_invoice_items FOR ALL
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_invoices i JOIN public.studios s ON s.id = i.studio_id
    WHERE i.id = invoice_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_invoices i JOIN public.studios s ON s.id = i.studio_id
    WHERE i.id = invoice_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ));

DROP POLICY IF EXISTS "documents_public_template_select" ON public.studio_documents;
DROP POLICY IF EXISTS "documents_studio_full"            ON public.studio_documents;
CREATE POLICY "documents_public_template_select" ON public.studio_documents FOR SELECT
  USING (is_template = true AND is_public = true);
CREATE POLICY "documents_studio_full" ON public.studio_documents FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "doc_attach_studio_full" ON public.studio_document_attachments;
CREATE POLICY "doc_attach_studio_full" ON public.studio_document_attachments FOR ALL
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_documents d JOIN public.studios s ON s.id = d.studio_id
    WHERE d.id = document_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_documents d JOIN public.studios s ON s.id = d.studio_id
    WHERE d.id = document_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
