-- Phase E — Inventory + suppliers + sponsors
--
-- studio_suppliers           : the studio's contact list of vendors.
-- studio_inventory_items     : stock by SKU; each item optionally points to a supplier.
-- studio_inventory_movements : the per-artist consumption ledger (restock/use/loss).
-- studio_sponsors            : sponsorships the studio has at the brand level.
-- studio_sponsor_artists     : which sponsored artists are tied to which sponsor.

BEGIN;

-- ============================================================
-- studio_suppliers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id       UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_email   TEXT,
  contact_phone   TEXT,
  website         TEXT,
  categories      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_suppliers_studio ON public.studio_suppliers (studio_id);

CREATE OR REPLACE FUNCTION public.set_suppliers_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;
DROP TRIGGER IF EXISTS trigger_suppliers_updated_at ON public.studio_suppliers;
CREATE TRIGGER trigger_suppliers_updated_at BEFORE UPDATE ON public.studio_suppliers FOR EACH ROW EXECUTE FUNCTION public.set_suppliers_updated_at();

-- ============================================================
-- studio_inventory_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_inventory_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id          UUID NOT NULL REFERENCES public.studios(id)        ON DELETE CASCADE,
  supplier_id        UUID          REFERENCES public.studio_suppliers(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  sku                TEXT,
  category           TEXT,
  unit               TEXT NOT NULL DEFAULT 'unit',                       -- unit, ml, gr, box, sheet, etc.
  quantity_on_hand   NUMERIC(10,3) NOT NULL DEFAULT 0,
  reorder_level      NUMERIC(10,3),
  cost_per_unit      NUMERIC(10,2),
  currency           TEXT NOT NULL DEFAULT 'USD',
  photo_url          TEXT,
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT studio_inventory_items_unique_sku UNIQUE NULLS NOT DISTINCT (studio_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inv_items_studio   ON public.studio_inventory_items (studio_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_supplier ON public.studio_inventory_items (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_items_low      ON public.studio_inventory_items (studio_id) WHERE quantity_on_hand <= COALESCE(reorder_level, 0);

CREATE OR REPLACE FUNCTION public.set_inv_items_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;
DROP TRIGGER IF EXISTS trigger_inv_items_updated_at ON public.studio_inventory_items;
CREATE TRIGGER trigger_inv_items_updated_at BEFORE UPDATE ON public.studio_inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_inv_items_updated_at();

-- ============================================================
-- studio_inventory_movements (the consumption ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_inventory_movements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                  UUID NOT NULL REFERENCES public.studio_inventory_items(id) ON DELETE CASCADE,
  studio_id                UUID NOT NULL REFERENCES public.studios(id)                 ON DELETE CASCADE,
  kind                     TEXT NOT NULL CHECK (kind IN ('restock', 'consumption', 'adjustment', 'loss')),
  quantity                 NUMERIC(10,3) NOT NULL,                 -- restock = positive, consumption/loss = positive (we'll add direction logic)
  unit_cost                NUMERIC(10,2),
  related_artist_user_id   UUID,
  related_job_log_id       UUID REFERENCES public.studio_jobs_log(id) ON DELETE SET NULL,
  performed_at             TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  notes                    TEXT,
  created_by_user_id       UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_item   ON public.studio_inventory_movements (item_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_artist ON public.studio_inventory_movements (related_artist_user_id) WHERE related_artist_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_mov_studio ON public.studio_inventory_movements (studio_id, performed_at DESC);

-- Trigger: keep quantity_on_hand in sync.
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE delta NUMERIC(10,3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := CASE NEW.kind
      WHEN 'restock'    THEN  NEW.quantity
      WHEN 'consumption' THEN -NEW.quantity
      WHEN 'loss'       THEN -NEW.quantity
      WHEN 'adjustment' THEN  NEW.quantity      -- adjustment can be negative; just trust the sign caller passed
      ELSE 0
    END;
    UPDATE public.studio_inventory_items
    SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + delta
    WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    delta := CASE OLD.kind
      WHEN 'restock'    THEN -OLD.quantity
      WHEN 'consumption' THEN  OLD.quantity
      WHEN 'loss'       THEN  OLD.quantity
      WHEN 'adjustment' THEN -OLD.quantity
      ELSE 0
    END;
    UPDATE public.studio_inventory_items
    SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + delta
    WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trigger_apply_inv_movement ON public.studio_inventory_movements;
CREATE TRIGGER trigger_apply_inv_movement
  AFTER INSERT OR DELETE ON public.studio_inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();

-- ============================================================
-- studio_sponsors
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_sponsors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id        UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  tier             TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
  starts_on        DATE,
  ends_on          DATE,
  monthly_value    NUMERIC(10,2),
  currency         TEXT NOT NULL DEFAULT 'USD',
  logo_url         TEXT,
  website          TEXT,
  contract_doc_id  UUID REFERENCES public.studio_documents(id) ON DELETE SET NULL,
  is_public        BOOLEAN NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_sponsors_studio ON public.studio_sponsors (studio_id);

CREATE OR REPLACE FUNCTION public.set_sponsors_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;
DROP TRIGGER IF EXISTS trigger_sponsors_updated_at ON public.studio_sponsors;
CREATE TRIGGER trigger_sponsors_updated_at BEFORE UPDATE ON public.studio_sponsors FOR EACH ROW EXECUTE FUNCTION public.set_sponsors_updated_at();

-- ============================================================
-- studio_sponsor_artists  (M2M)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_sponsor_artists (
  sponsor_id      UUID NOT NULL REFERENCES public.studio_sponsors(id)    ON DELETE CASCADE,
  artist_user_id  UUID NOT NULL REFERENCES public.artists_db(user_id)    ON DELETE CASCADE,
  started_at      DATE,
  ended_at        DATE,
  perks           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (sponsor_id, artist_user_id)
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.studio_suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_sponsors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_sponsor_artists     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_studio_full" ON public.studio_suppliers;
CREATE POLICY "suppliers_studio_full" ON public.studio_suppliers FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "inv_items_studio_full" ON public.studio_inventory_items;
CREATE POLICY "inv_items_studio_full" ON public.studio_inventory_items FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "inv_mov_studio_full" ON public.studio_inventory_movements;
CREATE POLICY "inv_mov_studio_full" ON public.studio_inventory_movements FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

-- Sponsors: public can SELECT name/logo/tier of public sponsors (so the studio's profile can show them).
DROP POLICY IF EXISTS "sponsors_public_select" ON public.studio_sponsors;
DROP POLICY IF EXISTS "sponsors_studio_full"   ON public.studio_sponsors;
CREATE POLICY "sponsors_public_select" ON public.studio_sponsors FOR SELECT
  USING (is_public = true);
CREATE POLICY "sponsors_studio_full" ON public.studio_sponsors FOR ALL
  USING (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
  ));

DROP POLICY IF EXISTS "sponsor_artists_public_select" ON public.studio_sponsor_artists;
DROP POLICY IF EXISTS "sponsor_artists_studio_full"   ON public.studio_sponsor_artists;
CREATE POLICY "sponsor_artists_public_select" ON public.studio_sponsor_artists FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.studio_sponsors sp WHERE sp.id = sponsor_id AND sp.is_public = true));
CREATE POLICY "sponsor_artists_studio_full" ON public.studio_sponsor_artists FOR ALL
  USING (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_sponsors sp JOIN public.studios s ON s.id = sp.studio_id
    WHERE sp.id = sponsor_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ))
  WITH CHECK (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.studio_sponsors sp JOIN public.studios s ON s.id = sp.studio_id
    WHERE sp.id = sponsor_id AND (s.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true))
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
