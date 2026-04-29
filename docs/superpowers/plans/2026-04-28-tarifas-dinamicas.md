# Tarifas Dinámicas para Tatuadores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in dynamic pricing system for artists that adjusts their displayed `session_price` based on rating tiers and a weighted demand/supply ratio across the artist's zones, computed daily by an n8n cron and overridable per quotation.

**Architecture:** Three layers. (1) **Postgres**: opt-in columns on `artists_db`, a `zone_demand_metrics` materialized view, helper SQL functions, and an `artist_dynamic_pricing_log` audit table. (2) **Express server (`server.js`)**: a JS computation engine `computeArtistDynamicFactor()` + `POST /api/admin/dynamic-pricing/recompute` (cron-callable via `X-Cron-Token`, mirrors `/api/admin/currencies/bulk-update`) + `GET /api/artists/:user_id/dynamic-pricing` for the dashboard. (3) **Frontend**: a "Tarifa dinámica" toggle/breakdown panel in the artist dashboard, a transparent badge on the public profile, and a shared `dynamic-pricing.js` helper that adjusts displayed prices on the marketplace, the quotation flow (`script.js#handleUrlArtist`), and pre-fills the quote response amount in `shared-drawer.js#submitResponse` (with manual override always available).

**Tech Stack:** Node.js + Express, Supabase (Postgres) via REST, vanilla HTML/CSS/JS frontend, Supabase JS client (`_supabase`), n8n external scheduler.

---

## Algorithm Specification (binding for implementation)

**Rating signal** — average of `quotation_surveys.rating_stars` joined to `quotations_db` on `artist_id = user_id`:

| Condition | `rating_pct` |
|---|---|
| `n_ratings < 3` | `0` (insufficient data; neutral) |
| `avg_rating < 3.0` | `−0.10` |
| `3.0 ≤ avg_rating < 4.0` | `0` |
| `4.0 ≤ avg_rating < 4.5` | `+0.05` |
| `avg_rating ≥ 4.5` | `+0.10` |

**Demand signal per zone** — last 30 days:

```
demand_weighted = quotations_count_30d + 0.5 × open_jobs_count_30d
supply          = active_artists_in_city
ratio           = demand_weighted / supply        (NULL if supply = 0)
```

**Demand tier:**

| Condition | `demand_pct` |
|---|---|
| `weighted_ratio` is NULL or no zones with data | `0` |
| `weighted_ratio < 0.5` | `−0.05` |
| `0.5 ≤ weighted_ratio < 1.5` | `0` |
| `1.5 ≤ weighted_ratio < 3.0` | `+0.10` |
| `weighted_ratio ≥ 3.0` | `+0.20` |

**Zone weighting** — for a given `artist_user_id`, take all defined zones and compute the weighted average of their `ratio` values (skipping zones with NULL ratio):

| Zone source | Weight |
|---|---|
| `artists_db.city` (primary) | `1.0` |
| each `artist_tattoo_locations` row with `period_type='current'` | `0.7` |
| each `artist_tattoo_locations` row with `period_type='upcoming'` | `0.3` |

**Final factor:** `factor = clamp((1 + rating_pct) × (1 + demand_pct), 0.80, 1.40)`

**Display price:** `displayed_price_amount = round(session_price_amount × factor)` in the same currency as `session_price_currency`.

**Override behavior:** When the artist responds to a quote, the response form's price field pre-fills with `displayed_price_amount`, but they can edit before submitting. `quotations_db.artist_budget_amount` stores whatever they actually submit (no extra bookkeeping for v1).

**Safety / cap rationale:** the multiplicative cap `[0.80, 1.40]` prevents extreme swings even if both signals are at their bounds. Theoretical max from tiers is `1.10 × 1.20 = 1.32`; theoretical min is `0.90 × 0.95 = 0.855`. The cap is wider than the theoretical bounds intentionally, so future tier tuning has headroom.

---

## File Structure

**Create:**
- `supabase/migrations/20260428210000_artists_dynamic_pricing.sql` — schema (columns + audit table + helper function `get_artist_avg_rating`).
- `supabase/migrations/20260428210100_zone_demand_metrics.sql` — materialized view + `calculate_artist_zone_demand_ratio` function.
- `public/shared/js/dynamic-pricing.js` — shared client helper (`applyDynamicFactor`, `formatBreakdown`, `renderBadge`).
- `public/shared/css/dynamic-pricing.css` — styles for dashboard panel + public badge.

**Modify:**
- `server.js` — add `computeArtistDynamicFactor` helper, `POST /api/admin/dynamic-pricing/recompute`, `GET /api/artists/:user_id/dynamic-pricing`.
- `public/artist/dashboard/index.html` — add "Tarifa dinámica" `form-row` after the price field in `#profile-form` (around the existing `display-price`/`input-price` block).
- `public/shared/js/dashboard.js` — load/save toggle, render breakdown card, fetch `/api/artists/:user_id/dynamic-pricing` on load.
- `public/shared/css/dashboard.css` — `@import url('./dynamic-pricing.css');` near top.
- `public/artist/profile/index.html` — load `dynamic-pricing.js` and add `<span id="dynamic-price-badge">` near `#display-price`.
- `public/shared/js/artist-profile.js` — extend `ARTIST_PUBLIC_FIELDS`, swap displayed price when `dynamic_pricing_enabled`.
- `public/marketplace/index.html` — load `dynamic-pricing.js` and `dynamic-pricing.css`.
- `public/shared/js/marketplace.js` — apply factor on artist cards' price.
- `public/quotation/index.html` — load `dynamic-pricing.js` (used by `script.js`).
- `public/shared/js/script.js` — apply factor in `handleUrlArtist` when populating `artist_session_cost_amount`.
- `public/shared/js/shared-drawer.js` — pre-fill `#response-price` with the dynamic amount inside `submitResponse`'s render path.
- `.env.example` — document the new daily n8n call to `/api/admin/dynamic-pricing/recompute`.

---

## Task 1: Database — Add dynamic pricing columns to `artists_db` + audit log

**Files:**
- Create: `supabase/migrations/20260428210000_artists_dynamic_pricing.sql`

- [ ] **Step 1.1: Define expected schema (acceptance query)**

Acceptance after migration runs (on a Supabase SQL console):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'artists_db'
  AND column_name LIKE 'dynamic_pricing%'
ORDER BY column_name;
```

Expected output: 5 rows.

| column_name | data_type |
|---|---|
| dynamic_pricing_breakdown | jsonb |
| dynamic_pricing_calculated_at | timestamp with time zone |
| dynamic_pricing_enabled | boolean |
| dynamic_pricing_factor | numeric |
| dynamic_pricing_floor_amount | numeric |

Plus:

```sql
SELECT to_regclass('public.artist_dynamic_pricing_log');
-- Expected: artist_dynamic_pricing_log
```

- [ ] **Step 1.2: Write the migration**

Create file `supabase/migrations/20260428210000_artists_dynamic_pricing.sql`:

```sql
-- Dynamic pricing for artists (opt-in)
-- Adds toggle + computed factor + breakdown + floor override on artists_db
-- Adds artist_dynamic_pricing_log for cron audit
-- Adds get_artist_avg_rating(p_user_id) helper used by the cron compute step

BEGIN;

ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_factor        NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS dynamic_pricing_breakdown     JSONB,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_floor_amount  NUMERIC(14,2);

ALTER TABLE public.artists_db
  ADD CONSTRAINT artists_db_dynamic_pricing_factor_range
  CHECK (dynamic_pricing_factor IS NULL OR (dynamic_pricing_factor >= 0.80 AND dynamic_pricing_factor <= 1.40));

CREATE INDEX IF NOT EXISTS idx_artists_db_dynamic_pricing_enabled
  ON public.artists_db (dynamic_pricing_enabled)
  WHERE dynamic_pricing_enabled = TRUE;

CREATE TABLE IF NOT EXISTS public.artist_dynamic_pricing_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_user_id  UUID NOT NULL REFERENCES public.artists_db(user_id) ON DELETE CASCADE,
  factor_applied  NUMERIC(4,3) NOT NULL,
  breakdown       JSONB NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_artist_dynamic_pricing_log_artist_time
  ON public.artist_dynamic_pricing_log (artist_user_id, computed_at DESC);

CREATE OR REPLACE FUNCTION public.get_artist_avg_rating(p_user_id UUID)
RETURNS TABLE(avg_rating NUMERIC, n_ratings INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT
    ROUND(AVG(qs.rating_stars)::NUMERIC, 2) AS avg_rating,
    COUNT(*)::INTEGER AS n_ratings
  FROM public.quotation_surveys qs
  JOIN public.quotations_db qd ON qd.id = qs.quotation_id
  WHERE qd.artist_id = p_user_id
    AND qs.rating_stars IS NOT NULL;
$$;

COMMIT;
```

- [ ] **Step 1.3: Apply locally**

If using Supabase CLI: `supabase db push`. Otherwise paste into the Supabase SQL editor.

- [ ] **Step 1.4: Verify with the acceptance query from Step 1.1**

Run both `SELECT` statements. Confirm 5 columns + the regclass match.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/20260428210000_artists_dynamic_pricing.sql
git commit -m "feat(db): add dynamic pricing columns and audit log on artists_db"
```

---

## Task 2: Database — `zone_demand_metrics` materialized view + zone ratio helper

**Files:**
- Create: `supabase/migrations/20260428210100_zone_demand_metrics.sql`

- [ ] **Step 2.1: Define acceptance query**

After the migration runs:

```sql
SELECT to_regclass('public.zone_demand_metrics');
-- Expected: zone_demand_metrics

REFRESH MATERIALIZED VIEW public.zone_demand_metrics;

SELECT city_key, demand_weighted, active_artists, demand_supply_ratio
FROM public.zone_demand_metrics
ORDER BY demand_supply_ratio DESC NULLS LAST
LIMIT 5;
-- Expected: 0+ rows; if rows exist, demand_supply_ratio = demand_weighted / active_artists when active_artists > 0
```

And the helper:

```sql
SELECT public.calculate_artist_zone_demand_ratio(
  (SELECT user_id FROM public.artists_db WHERE city IS NOT NULL LIMIT 1)
);
-- Expected: NUMERIC or NULL (NULL if the artist has no zones with data)
```

- [ ] **Step 2.2: Write the migration**

Create `supabase/migrations/20260428210100_zone_demand_metrics.sql`:

```sql
-- Zone demand/supply metrics materialized view + per-artist weighted ratio helper
-- Demand: quotations_db (last 30d) weight 1.0 + job_board_requests open (last 30d) weight 0.5
-- Supply: artists_db with non-empty city, grouped by lower-trimmed city
-- Refreshed daily by /api/admin/dynamic-pricing/recompute

BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.zone_demand_metrics AS
WITH demand AS (
  SELECT
    LOWER(BTRIM(client_city_residence)) AS city_key,
    1.0::NUMERIC AS weight,
    'quotation'::TEXT AS source
  FROM public.quotations_db
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND client_city_residence IS NOT NULL
    AND BTRIM(client_city_residence) <> ''
  UNION ALL
  SELECT
    LOWER(BTRIM(client_city)) AS city_key,
    0.5::NUMERIC AS weight,
    'job_board'::TEXT AS source
  FROM public.job_board_requests
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND status = 'open'
    AND client_city IS NOT NULL
    AND BTRIM(client_city) <> ''
),
supply AS (
  SELECT
    LOWER(BTRIM(city)) AS city_key,
    COUNT(*)::INTEGER AS active_artists
  FROM public.artists_db
  WHERE city IS NOT NULL AND BTRIM(city) <> ''
  GROUP BY LOWER(BTRIM(city))
),
demand_agg AS (
  SELECT
    city_key,
    COALESCE(SUM(weight) FILTER (WHERE source = 'quotation'), 0)::NUMERIC AS quotations_30d,
    COALESCE(SUM(weight) FILTER (WHERE source = 'job_board'), 0)::NUMERIC AS jobs_weight_30d,
    COALESCE(SUM(weight), 0)::NUMERIC AS demand_weighted
  FROM demand
  GROUP BY city_key
)
SELECT
  COALESCE(d.city_key, s.city_key) AS city_key,
  COALESCE(d.quotations_30d, 0)::NUMERIC   AS quotations_30d,
  COALESCE(d.jobs_weight_30d, 0)::NUMERIC  AS jobs_weight_30d,
  COALESCE(d.demand_weighted, 0)::NUMERIC  AS demand_weighted,
  COALESCE(s.active_artists, 0)::INTEGER   AS active_artists,
  CASE
    WHEN COALESCE(s.active_artists, 0) = 0 THEN NULL
    ELSE ROUND(COALESCE(d.demand_weighted, 0) / s.active_artists, 4)
  END AS demand_supply_ratio,
  NOW() AS refreshed_at
FROM demand_agg d
FULL OUTER JOIN supply s ON d.city_key = s.city_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_demand_metrics_city_key
  ON public.zone_demand_metrics (city_key);

CREATE OR REPLACE FUNCTION public.calculate_artist_zone_demand_ratio(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total_weight NUMERIC := 0;
  v_weighted_sum NUMERIC := 0;
  r RECORD;
  v_ratio NUMERIC;
BEGIN
  FOR r IN
    SELECT LOWER(BTRIM(a.city)) AS city_key, 1.0::NUMERIC AS w
    FROM public.artists_db a
    WHERE a.user_id = p_user_id
      AND a.city IS NOT NULL AND BTRIM(a.city) <> ''
    UNION ALL
    SELECT LOWER(BTRIM(atl.city)) AS city_key,
           CASE atl.period_type WHEN 'current' THEN 0.7 WHEN 'upcoming' THEN 0.3 END AS w
    FROM public.artist_tattoo_locations atl
    WHERE atl.artist_user_id = p_user_id
      AND atl.city IS NOT NULL AND BTRIM(atl.city) <> ''
  LOOP
    SELECT zdm.demand_supply_ratio INTO v_ratio
    FROM public.zone_demand_metrics zdm
    WHERE zdm.city_key = r.city_key;

    IF v_ratio IS NOT NULL THEN
      v_weighted_sum := v_weighted_sum + (v_ratio * r.w);
      v_total_weight := v_total_weight + r.w;
    END IF;
  END LOOP;

  IF v_total_weight = 0 THEN
    RETURN NULL;
  END IF;

  RETURN ROUND(v_weighted_sum / v_total_weight, 4);
END;
$$;

COMMIT;
```

- [ ] **Step 2.3: Apply migration**

Run via Supabase CLI or paste in SQL editor.

- [ ] **Step 2.4: Verify with the acceptance queries from Step 2.1**

Both queries must succeed. The matview row count depends on real data — that's fine, we just need the view to exist and the helper to return without error.

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations/20260428210100_zone_demand_metrics.sql
git commit -m "feat(db): add zone_demand_metrics matview and per-artist zone ratio helper"
```

---

## Task 3: Backend — `computeArtistDynamicFactor` helper in `server.js`

**Files:**
- Modify: `server.js` (add helper before the cron endpoint group; place it next to `getHealthConfig` definitions or just above the existing `/api/admin/currencies/bulk-update` route)

- [ ] **Step 3.1: Define expected behavior (manual mental test)**

Given inputs, the function must return:

| `avg_rating` | `n_ratings` | `demand_ratio` | Expected `factor` | Expected `rating_pct` | Expected `demand_pct` |
|---|---|---|---|---|---|
| `4.6` | `5` | `2.0` | `1.10 × 1.10 = 1.210` | `+0.10` | `+0.10` |
| `2.5` | `4` | `0.3` | `0.90 × 0.95 = 0.855` | `−0.10` | `−0.05` |
| `4.2` | `1` | `null` | `1.000` (insufficient ratings → 0; null demand → 0) | `0` | `0` |
| `null` | `0` | `4.0` | `1.20` (no rating signal; high demand) | `0` | `+0.20` |

- [ ] **Step 3.2: Add the helper function**

Insert into `server.js` (above the cron endpoint section, e.g. just above the `/api/admin/currencies/bulk-update` block):

```js
/**
 * Compute the dynamic pricing factor for an artist from rating + demand signals.
 * Pure function — input/output only, no side effects.
 *
 * @param {object} params
 * @param {number|null} params.avgRating - 1..5 or null
 * @param {number} params.ratingsCount - integer >= 0
 * @param {number|null} params.demandRatio - >= 0 or null
 * @returns {{
 *   factor: number,
 *   rating_pct: number,
 *   demand_pct: number,
 *   tier_rating: string,
 *   tier_demand: string,
 *   inputs: object
 * }}
 */
function computeArtistDynamicFactor({ avgRating, ratingsCount, demandRatio }) {
    let ratingPct = 0;
    let tierRating = 'insufficient_data';
    if (Number.isFinite(ratingsCount) && ratingsCount >= 3 && Number.isFinite(avgRating)) {
        if (avgRating < 3.0)        { ratingPct = -0.10; tierRating = 'low'; }
        else if (avgRating < 4.0)   { ratingPct =  0.00; tierRating = 'normal'; }
        else if (avgRating < 4.5)   { ratingPct = +0.05; tierRating = 'good'; }
        else                        { ratingPct = +0.10; tierRating = 'excellent'; }
    }

    let demandPct = 0;
    let tierDemand = 'insufficient_data';
    if (Number.isFinite(demandRatio)) {
        if (demandRatio < 0.5)      { demandPct = -0.05; tierDemand = 'low'; }
        else if (demandRatio < 1.5) { demandPct =  0.00; tierDemand = 'normal'; }
        else if (demandRatio < 3.0) { demandPct = +0.10; tierDemand = 'high'; }
        else                        { demandPct = +0.20; tierDemand = 'very_high'; }
    }

    const raw = (1 + ratingPct) * (1 + demandPct);
    const factor = Math.max(0.80, Math.min(1.40, raw));

    return {
        factor: Math.round(factor * 1000) / 1000,
        rating_pct: ratingPct,
        demand_pct: demandPct,
        tier_rating: tierRating,
        tier_demand: tierDemand,
        inputs: {
            avg_rating: Number.isFinite(avgRating) ? avgRating : null,
            ratings_count: Number.isFinite(ratingsCount) ? ratingsCount : 0,
            demand_ratio: Number.isFinite(demandRatio) ? demandRatio : null
        }
    };
}
```

- [ ] **Step 3.3: Verify in a Node REPL**

In the project root, run:

```bash
node -e "
const f = require('./server.js'); // server starts; that's fine for a quick verify
" 
```

Quick sanity check (alternative without booting the server) — temporarily expose for testing or copy the function to a scratch file. Acceptance: the four input/output rows in Step 3.1 match.

- [ ] **Step 3.4: Commit**

```bash
git add server.js
git commit -m "feat(api): add computeArtistDynamicFactor pure helper"
```

---

## Task 4: Backend — `POST /api/admin/dynamic-pricing/recompute` (cron endpoint)

**Files:**
- Modify: `server.js` (add the new route immediately after the existing `/api/admin/currencies/bulk-update` block)

- [ ] **Step 4.1: Define expected behavior**

- Auth: header `X-Cron-Token` must equal `process.env.CRON_API_TOKEN` (mirrors `/api/admin/currencies/bulk-update` at `server.js:4291-4299`).
- Refreshes `zone_demand_metrics` matview.
- Loops every artist where `dynamic_pricing_enabled = true`.
- For each: fetches avg rating + n_ratings via `get_artist_avg_rating(user_id)`, fetches weighted demand via `calculate_artist_zone_demand_ratio(user_id)`, computes factor, updates `artists_db` row with `dynamic_pricing_factor`, `dynamic_pricing_breakdown`, `dynamic_pricing_calculated_at`, and inserts an `artist_dynamic_pricing_log` row.
- Returns: `{ success: true, processed: N, updated: M, errors: [...] }`.

- [ ] **Step 4.2: Add the endpoint**

Insert into `server.js` (after the currencies cron route closes):

```js
/**
 * POST /api/admin/dynamic-pricing/recompute
 * Called by the n8n daily cron workflow.
 * Auth: header `X-Cron-Token` must match process.env.CRON_API_TOKEN.
 * Refreshes zone_demand_metrics, then recomputes the dynamic factor
 * for every artist with dynamic_pricing_enabled = true.
 */
app.post('/api/admin/dynamic-pricing/recompute', async (req, res) => {
    const expectedToken = process.env.CRON_API_TOKEN;
    if (!expectedToken) {
        return res.status(503).json({ success: false, error: 'CRON_API_TOKEN not configured on server' });
    }
    const provided = req.headers['x-cron-token'] || '';
    if (provided !== expectedToken) {
        return res.status(401).json({ success: false, error: 'Invalid cron token' });
    }

    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase service role not configured' });
    }

    const sbHeaders = {
        'Content-Type': 'application/json',
        'apikey': cfg.supabaseServiceKey,
        'Authorization': `Bearer ${cfg.supabaseServiceKey}`
    };

    // 1) Refresh the materialized view (CONCURRENTLY needs the unique index from Task 2)
    try {
        const refreshResp = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/refresh_zone_demand_metrics`, {
            method: 'POST',
            headers: sbHeaders,
            body: '{}'
        });
        if (!refreshResp.ok) {
            console.warn('[DynamicPricing] Matview refresh RPC failed:', refreshResp.status, await refreshResp.text());
        }
    } catch (err) {
        console.warn('[DynamicPricing] Matview refresh error:', err.message);
    }

    // 2) Fetch all opted-in artists
    let optedIn = [];
    try {
        const listResp = await fetch(
            `${cfg.supabaseUrl}/rest/v1/artists_db?dynamic_pricing_enabled=eq.true&select=user_id,session_price_amount,session_price_currency,dynamic_pricing_floor_amount`,
            { headers: sbHeaders }
        );
        if (!listResp.ok) {
            return res.status(502).json({ success: false, error: `Failed to list opted-in artists: ${listResp.status}` });
        }
        optedIn = await listResp.json();
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }

    const errors = [];
    let updated = 0;

    for (const a of optedIn) {
        try {
            // Rating signal
            const ratingResp = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/get_artist_avg_rating`, {
                method: 'POST',
                headers: sbHeaders,
                body: JSON.stringify({ p_user_id: a.user_id })
            });
            const ratingRow = ratingResp.ok ? (await ratingResp.json())[0] || {} : {};
            const avgRating = Number.isFinite(Number(ratingRow.avg_rating)) ? Number(ratingRow.avg_rating) : null;
            const ratingsCount = Number(ratingRow.n_ratings) || 0;

            // Demand signal
            const demandResp = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/calculate_artist_zone_demand_ratio`, {
                method: 'POST',
                headers: sbHeaders,
                body: JSON.stringify({ p_user_id: a.user_id })
            });
            const demandRaw = demandResp.ok ? await demandResp.json() : null;
            const demandRatio = (demandRaw === null || demandRaw === undefined || !Number.isFinite(Number(demandRaw)))
                ? null
                : Number(demandRaw);

            const result = computeArtistDynamicFactor({ avgRating, ratingsCount, demandRatio });

            // Apply optional floor: never let displayed price drop below floor_amount.
            // We do this at compute-time by adjusting the factor upward if needed.
            let appliedFactor = result.factor;
            if (a.session_price_amount && a.dynamic_pricing_floor_amount) {
                const minFactor = Number(a.dynamic_pricing_floor_amount) / Number(a.session_price_amount);
                if (Number.isFinite(minFactor) && minFactor > appliedFactor) {
                    appliedFactor = Math.min(1.40, Math.max(0.80, minFactor));
                }
            }

            const breakdown = {
                ...result,
                applied_factor: Math.round(appliedFactor * 1000) / 1000,
                floor_amount: a.dynamic_pricing_floor_amount || null
            };

            // Update artist row
            const upd = await fetch(
                `${cfg.supabaseUrl}/rest/v1/artists_db?user_id=eq.${a.user_id}`,
                {
                    method: 'PATCH',
                    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                    body: JSON.stringify({
                        dynamic_pricing_factor: breakdown.applied_factor,
                        dynamic_pricing_breakdown: breakdown,
                        dynamic_pricing_calculated_at: new Date().toISOString()
                    })
                }
            );
            if (!upd.ok) {
                errors.push({ user_id: a.user_id, stage: 'update', detail: `${upd.status} ${await upd.text()}` });
                continue;
            }

            // Audit log (best-effort)
            await fetch(`${cfg.supabaseUrl}/rest/v1/artist_dynamic_pricing_log`, {
                method: 'POST',
                headers: sbHeaders,
                body: JSON.stringify({
                    artist_user_id: a.user_id,
                    factor_applied: breakdown.applied_factor,
                    breakdown
                })
            }).catch(() => { /* best-effort */ });

            updated += 1;
        } catch (err) {
            errors.push({ user_id: a.user_id, stage: 'compute', detail: err.message });
        }
    }

    return res.json({
        success: errors.length === 0,
        processed: optedIn.length,
        updated,
        errors
    });
});
```

- [ ] **Step 4.3: Add the matview refresh RPC**

Append to `supabase/migrations/20260428210100_zone_demand_metrics.sql` (in a new transaction, before commit) **or** create a tiny follow-up migration. Easier: add to the same file before its `COMMIT;`:

```sql
CREATE OR REPLACE FUNCTION public.refresh_zone_demand_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zone_demand_metrics;
EXCEPTION WHEN feature_not_supported THEN
  -- Fallback if matview is empty/no unique index yet
  REFRESH MATERIALIZED VIEW public.zone_demand_metrics;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_zone_demand_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_zone_demand_metrics() TO service_role;
```

Re-run the migration (or run only the new block in the SQL editor).

- [ ] **Step 4.4: Verify the endpoint locally**

```powershell
$token = (Get-Content .env | Select-String '^CRON_API_TOKEN=').ToString().Split('=')[1]
curl -X POST http://localhost:3000/api/admin/dynamic-pricing/recompute `
  -H "Content-Type: application/json" `
  -H "X-Cron-Token: $token"
```

Expected JSON: `{ "success": true, "processed": 0+, "updated": N, "errors": [] }`. With 0 opted-in artists at first, expect `processed: 0`. Set one test artist's `dynamic_pricing_enabled = true` in Supabase, re-run, and verify `dynamic_pricing_factor` and `dynamic_pricing_calculated_at` get populated for that row.

- [ ] **Step 4.5: Commit**

```bash
git add server.js supabase/migrations/20260428210100_zone_demand_metrics.sql
git commit -m "feat(api): add /api/admin/dynamic-pricing/recompute cron endpoint"
```

---

## Task 5: Backend — `GET /api/artists/:user_id/dynamic-pricing` (dashboard read)

**Files:**
- Modify: `server.js` (add route near `/api/artists/index` so related routes stay grouped)

- [ ] **Step 5.1: Define expected behavior**

- Public read endpoint (no extra auth beyond the existing rate limit; same pattern as `/api/artists/index`).
- Returns `{ enabled, factor, calculated_at, breakdown, displayed_price_amount, session_price_amount, session_price_currency }` for the given `user_id`.
- Returns `404` if artist not found.
- If `dynamic_pricing_enabled = false` or `dynamic_pricing_factor` is null → `displayed_price_amount = session_price_amount` and `factor = 1.000`.

- [ ] **Step 5.2: Add the endpoint**

```js
/**
 * GET /api/artists/:user_id/dynamic-pricing
 * Returns dynamic pricing state for an artist + the displayed price.
 * Used by the dashboard breakdown panel and as a server-side read for SSR-ish callers.
 */
app.get('/api/artists/:user_id/dynamic-pricing', async (req, res) => {
    const userId = String(req.params.user_id || '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user_id' });
    }

    const cfg = getHealthConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
        return res.status(503).json({ success: false, error: 'Supabase service role not configured' });
    }

    try {
        const url = `${cfg.supabaseUrl}/rest/v1/artists_db?user_id=eq.${userId}&select=user_id,session_price_amount,session_price_currency,dynamic_pricing_enabled,dynamic_pricing_factor,dynamic_pricing_breakdown,dynamic_pricing_calculated_at,dynamic_pricing_floor_amount`;
        const r = await fetch(url, {
            headers: {
                'apikey': cfg.supabaseServiceKey,
                'Authorization': `Bearer ${cfg.supabaseServiceKey}`
            }
        });
        if (!r.ok) {
            return res.status(502).json({ success: false, error: `Supabase read failed: ${r.status}` });
        }
        const rows = await r.json();
        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }
        const a = rows[0];
        const enabled = !!a.dynamic_pricing_enabled;
        const factor = (enabled && Number.isFinite(Number(a.dynamic_pricing_factor)))
            ? Number(a.dynamic_pricing_factor)
            : 1.0;
        const baseAmount = Number(a.session_price_amount) || 0;
        const displayed = Math.round(baseAmount * factor);
        return res.json({
            success: true,
            enabled,
            factor,
            calculated_at: a.dynamic_pricing_calculated_at,
            breakdown: a.dynamic_pricing_breakdown || null,
            session_price_amount: baseAmount || null,
            session_price_currency: a.session_price_currency || null,
            displayed_price_amount: baseAmount ? displayed : null,
            floor_amount: a.dynamic_pricing_floor_amount || null
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 5.3: Verify**

```powershell
curl http://localhost:3000/api/artists/<some-real-user-uuid>/dynamic-pricing
```

Expected on a non-opted-in artist: `{ "success": true, "enabled": false, "factor": 1, ... }`. On an opted-in artist after running the cron once: factor between 0.80 and 1.40, breakdown with `tier_rating`/`tier_demand`/`applied_factor`.

- [ ] **Step 5.4: Commit**

```bash
git add server.js
git commit -m "feat(api): add GET /api/artists/:user_id/dynamic-pricing read endpoint"
```

---

## Task 6: Frontend — Shared client helper module

**Files:**
- Create: `public/shared/js/dynamic-pricing.js`
- Create: `public/shared/css/dynamic-pricing.css`

- [ ] **Step 6.1: Define expected API**

`window.DynamicPricing` exposes:

- `applyDynamicFactor(artist) → { displayed, base, factor, enabled }` — pure function reading `artist.session_price_amount`, `artist.session_price_currency`, `artist.dynamic_pricing_enabled`, `artist.dynamic_pricing_factor`. Returns `displayed` rounded to integer.
- `formatPrice({ amount, currency }) → string` — uses existing `window.CurrencyUtils` if present, else falls back to `${amount} ${currency}`.
- `renderBadge(targetEl, breakdown)` — appends a small "Tarifa dinámica" badge/tooltip. Idempotent (re-render replaces).
- `formatBreakdown(breakdown) → string` — short user-facing summary, e.g. `"Rating: +5% · Demanda zona: +10% · Factor 1.155"`.

- [ ] **Step 6.2: Write `dynamic-pricing.js`**

```js
// public/shared/js/dynamic-pricing.js
// Shared helper for dynamic pricing display across artist profile, marketplace,
// quotation flow, and dashboard. Pure functions + idempotent DOM helpers.

(function (global) {
    'use strict';

    function applyDynamicFactor(artist) {
        const base = Number(artist && artist.session_price_amount) || 0;
        const enabled = !!(artist && artist.dynamic_pricing_enabled);
        const rawFactor = Number(artist && artist.dynamic_pricing_factor);
        const factor = (enabled && Number.isFinite(rawFactor) && rawFactor > 0) ? rawFactor : 1.0;
        const displayed = base ? Math.round(base * factor) : 0;
        return { displayed, base, factor, enabled };
    }

    function formatPrice({ amount, currency }) {
        if (!Number.isFinite(amount) || amount <= 0) return '';
        if (global.CurrencyUtils && typeof global.CurrencyUtils.format === 'function') {
            try { return global.CurrencyUtils.format(amount, currency); } catch (_) { /* fall through */ }
        }
        const safe = Math.round(amount).toLocaleString('es-AR');
        return currency ? `${safe} ${currency}` : `${safe}`;
    }

    function pctLabel(p) {
        if (!Number.isFinite(p) || p === 0) return '0%';
        const sign = p > 0 ? '+' : '';
        return `${sign}${Math.round(p * 100)}%`;
    }

    function formatBreakdown(breakdown) {
        if (!breakdown) return 'Tarifa dinámica activa.';
        const r = pctLabel(breakdown.rating_pct);
        const d = pctLabel(breakdown.demand_pct);
        const f = Number(breakdown.applied_factor || breakdown.factor || 1).toFixed(3);
        return `Rating: ${r} · Demanda zona: ${d} · Factor ${f}`;
    }

    function renderBadge(targetEl, breakdown) {
        if (!targetEl) return;
        let badge = targetEl.querySelector('.dynamic-price-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dynamic-price-badge';
            badge.setAttribute('role', 'note');
            targetEl.appendChild(badge);
        }
        badge.textContent = 'Tarifa dinámica';
        badge.title = formatBreakdown(breakdown);
    }

    global.DynamicPricing = {
        applyDynamicFactor,
        formatPrice,
        formatBreakdown,
        renderBadge
    };
})(window);
```

- [ ] **Step 6.3: Write `dynamic-pricing.css`**

```css
/* public/shared/css/dynamic-pricing.css */

.dynamic-price-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.4;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.06);
    color: var(--color-text, #111);
    cursor: help;
    vertical-align: middle;
}

.dynamic-pricing-panel {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 12px;
    padding: 14px 16px;
    margin-top: 12px;
    background: rgba(0, 0, 0, 0.02);
}

.dynamic-pricing-panel__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-size: 0.9rem;
}

.dynamic-pricing-panel__row + .dynamic-pricing-panel__row {
    margin-top: 6px;
}

.dynamic-pricing-panel__price-final {
    font-weight: 700;
    font-size: 1.05rem;
}

.dynamic-pricing-panel__hint {
    font-size: 0.8rem;
    color: var(--color-muted, #666);
    margin-top: 8px;
}
```

- [ ] **Step 6.4: Verify file load**

Open `public/quotation/index.html` (or any page that already loads `currency-utils.js`) in a browser, paste in the devtools console:

```js
DynamicPricing.applyDynamicFactor({
  session_price_amount: 100, session_price_currency: 'USD',
  dynamic_pricing_enabled: true, dynamic_pricing_factor: 1.21
});
// Expected: { displayed: 121, base: 100, factor: 1.21, enabled: true }
```

(The verification only requires the helper to be loaded somewhere, which we'll do in later tasks — this step is a smoke check after Task 7.)

- [ ] **Step 6.5: Commit**

```bash
git add public/shared/js/dynamic-pricing.js public/shared/css/dynamic-pricing.css
git commit -m "feat(ui): shared dynamic-pricing client helper + styles"
```

---

## Task 7: Dashboard — Add "Tarifa dinámica" section in HTML

**Files:**
- Modify: `public/artist/dashboard/index.html` (add a new `form-row` block in `#profile-form`, just after the existing price/`session_price` block; insert before the Newsletter block at lines 648-656)
- Modify: `public/shared/css/dashboard.css` (add `@import` of `dynamic-pricing.css`)

- [ ] **Step 7.1: Locate the insertion point**

Anchor: the existing Newsletter block:

```648:656:public/artist/dashboard/index.html
                <!-- Newsletter -->
                <div class="form-row">
                    <label class="form-label">Newsletter</label>
                    <div class="form-value" id="display-newsletter">-</div>
                    <label class="toggle-switch" id="toggle-newsletter" style="display: none;">
                        <input type="checkbox" id="input-newsletter">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
```

We insert the new block immediately before this Newsletter block.

- [ ] **Step 7.2: Add the new block**

Insert before the `<!-- Newsletter -->` comment:

```html
                <!-- Dynamic Pricing -->
                <div class="form-row">
                    <label class="form-label">Tarifa dinámica</label>
                    <div class="form-value" id="display-dynamic-pricing">-</div>
                    <label class="toggle-switch" id="toggle-dynamic-pricing" style="display: none;">
                        <input type="checkbox" id="input-dynamic-pricing">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="form-row form-row-full" id="dynamic-pricing-panel-row" style="display: none;">
                    <div class="dynamic-pricing-panel" id="dynamic-pricing-panel">
                        <div class="dynamic-pricing-panel__row">
                            <span>Tarifa base</span>
                            <span id="dp-base">-</span>
                        </div>
                        <div class="dynamic-pricing-panel__row">
                            <span>Ajuste por reseñas</span>
                            <span id="dp-rating">-</span>
                        </div>
                        <div class="dynamic-pricing-panel__row">
                            <span>Ajuste por demanda en tu zona</span>
                            <span id="dp-demand">-</span>
                        </div>
                        <div class="dynamic-pricing-panel__row">
                            <span>Tarifa dinámica vigente</span>
                            <span id="dp-final" class="dynamic-pricing-panel__price-final">-</span>
                        </div>
                        <p class="dynamic-pricing-panel__hint" id="dp-hint">
                            Se actualiza automáticamente cada día. Podés sobrescribir el precio en cada cotización.
                        </p>
                    </div>
                </div>
```

- [ ] **Step 7.3: Wire CSS import**

Open `public/shared/css/dashboard.css` and add at the top (right after any existing `@import` lines, or first line):

```css
@import url('./dynamic-pricing.css');
```

- [ ] **Step 7.4: Add the script tag**

Open `public/artist/dashboard/index.html` and locate where other shared scripts are loaded near the bottom (alongside `currency-utils.js`, `config-manager.js`). Add:

```html
<script src="/shared/js/dynamic-pricing.js"></script>
```

Place it before `dashboard.js` is loaded so `dashboard.js` can call `DynamicPricing.*`.

- [ ] **Step 7.5: Smoke check**

Reload the dashboard in a logged-in artist session. The "Tarifa dinámica" row must appear with `display-dynamic-pricing` showing `-` (because we haven't wired the JS yet). No console errors.

- [ ] **Step 7.6: Commit**

```bash
git add public/artist/dashboard/index.html public/shared/css/dashboard.css
git commit -m "feat(dashboard): add Tarifa dinámica row + breakdown panel scaffolding"
```

---

## Task 8: Dashboard — Wire load/save in `dashboard.js`

**Files:**
- Modify: `public/shared/js/dashboard.js`

- [ ] **Step 8.1: Define expected behavior**

- On page load → after `populateDashboard()` finishes → call `loadDynamicPricing(currentUser.id)`. This fetches `/api/artists/:user_id/dynamic-pricing` and renders the panel.
- In edit mode, the toggle is visible. On save (`handleProfileSave`), include `dynamic_pricing_enabled` in `updateData` (the artist can toggle on/off; the *factor* is never written from the client).
- When the toggle is OFF: panel hides, display value shows "Desactivada".
- When ON with no `factor` yet (just enabled, cron hasn't run): show "Pendiente — se actualizará en la próxima sincronización" and factor 1.000.
- When ON with `factor`: render breakdown.

- [ ] **Step 8.2: Locate insertion points in `dashboard.js`**

Two anchors:

(a) **Read & populate** — the `populateDashboard` function. Search for `display-newsletter` (it sets the newsletter display); add a sibling call to `populateDynamicPricing(...)` right after it.

(b) **Save** — the `handleProfileSave` function around `dashboard.js:2396-2415`:

```2396:2415:public/shared/js/dashboard.js
        const updateData = {
            username: username,
            ...
            subscribed_newsletter: newsletter,
            instagram: instagram || null,
            whatsapp_number: whatsapp_number || null,
            whatsapp_url: whatsappUrl
        };
```

- [ ] **Step 8.3: Add the new helper functions**

Append near the bottom of `dashboard.js` (or in a contiguous block alongside other profile renders):

```js
// ===== Dynamic Pricing (Tarifa dinámica) =====

async function loadDynamicPricing(userId) {
    try {
        const r = await fetch(`/api/artists/${encodeURIComponent(userId)}/dynamic-pricing`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!r.ok) {
            renderDynamicPricing({ enabled: false });
            return;
        }
        const data = await r.json();
        renderDynamicPricing(data);
    } catch (err) {
        console.warn('[DynamicPricing] load failed:', err);
        renderDynamicPricing({ enabled: false });
    }
}

function renderDynamicPricing(data) {
    const display = document.getElementById('display-dynamic-pricing');
    const input = document.getElementById('input-dynamic-pricing');
    const panelRow = document.getElementById('dynamic-pricing-panel-row');
    if (!display || !input || !panelRow) return;

    const enabled = !!data.enabled;
    input.checked = enabled;
    display.textContent = enabled ? 'Activada' : 'Desactivada';

    if (!enabled) {
        panelRow.style.display = 'none';
        return;
    }

    panelRow.style.display = '';

    const breakdown = data.breakdown || null;
    const base = Number(data.session_price_amount) || 0;
    const factor = Number(data.factor) || 1;
    const currency = data.session_price_currency || '';

    document.getElementById('dp-base').textContent = base
        ? (window.DynamicPricing
            ? window.DynamicPricing.formatPrice({ amount: base, currency })
            : `${base} ${currency}`)
        : '—';
    document.getElementById('dp-rating').textContent = breakdown
        ? pctText(breakdown.rating_pct) + ` (${breakdown.tier_rating || 'sin datos'})`
        : '—';
    document.getElementById('dp-demand').textContent = breakdown
        ? pctText(breakdown.demand_pct) + ` (${breakdown.tier_demand || 'sin datos'})`
        : '—';
    document.getElementById('dp-final').textContent = base
        ? (window.DynamicPricing
            ? window.DynamicPricing.formatPrice({ amount: Math.round(base * factor), currency })
            : `${Math.round(base * factor)} ${currency}`)
        : '—';

    const hint = document.getElementById('dp-hint');
    if (hint) {
        if (!data.calculated_at) {
            hint.textContent = 'Activada — se actualizará en la próxima sincronización diaria.';
        } else {
            const when = new Date(data.calculated_at).toLocaleDateString('es-AR');
            hint.textContent = `Última actualización: ${when}. Podés sobrescribir el precio en cada cotización.`;
        }
    }
}

function pctText(p) {
    if (!Number.isFinite(p) || p === 0) return '0%';
    const sign = p > 0 ? '+' : '';
    return `${sign}${Math.round(p * 100)}%`;
}
```

- [ ] **Step 8.4: Hook the load call**

Find where `populateDashboard()` is called after the artist data is fetched (search for `populateDashboard()`), and add right after:

```js
        if (currentUser && currentUser.id) {
            loadDynamicPricing(currentUser.id);
        }
```

- [ ] **Step 8.5: Hook the save**

In `handleProfileSave`, extend `updateData` to include the new toggle. Find the existing `subscribed_newsletter: newsletter,` line and add right below it:

```js
            dynamic_pricing_enabled: !!document.getElementById('input-dynamic-pricing')?.checked,
```

(The `factor`, `breakdown` and `calculated_at` are NOT written from the client — only the cron sets those.)

- [ ] **Step 8.6: Show toggle in edit mode**

The dashboard already has a centralized edit-mode toggle (search for `toggle-newsletter` to find the show/hide pattern). Add `toggle-dynamic-pricing` to whichever array/list controls visibility of the toggle switches in edit mode (mirrors the newsletter toggle).

If the pattern is per-element show/hide via `style.display`, locate the `toggleEditMode` function and add:

```js
    document.getElementById('toggle-dynamic-pricing').style.display = inEditMode ? '' : 'none';
    document.getElementById('display-dynamic-pricing').style.display = inEditMode ? 'none' : '';
```

(adjust to mirror exactly how `toggle-newsletter` is handled in the same function).

- [ ] **Step 8.7: Verify**

1. Open the dashboard as an artist who has never set the toggle. The row shows "Desactivada", panel hidden.
2. Click "Editar perfil", toggle the switch ON, save. Reload. The row now shows "Activada", panel visible with "Pendiente — se actualizará...".
3. Manually run the cron endpoint (Task 4 verification) targeting your local DB. Reload dashboard. Panel now shows the breakdown values.

- [ ] **Step 8.8: Commit**

```bash
git add public/shared/js/dashboard.js
git commit -m "feat(dashboard): wire dynamic pricing toggle load/save and breakdown panel"
```

---

## Task 9: Public profile — Show dynamic price + badge

**Files:**
- Modify: `public/shared/js/artist-profile.js`
- Modify: `public/artist/profile/index.html`

- [ ] **Step 9.1: Extend the SELECT field list**

In `public/shared/js/artist-profile.js` lines 7-29 (`ARTIST_PUBLIC_FIELDS`), add the new fields:

```js
const ARTIST_PUBLIC_FIELDS = [
    'username',
    'user_id',
    'name',
    // ... existing fields ...
    'session_price',
    'session_price_amount',
    'session_price_currency',
    'dynamic_pricing_enabled',
    'dynamic_pricing_factor',
    'dynamic_pricing_breakdown',
    // ... rest of existing fields ...
].join(',');
```

(Keep existing entries; only add the four new ones plus ensure `session_price_amount` / `session_price_currency` are present — they may already be.)

- [ ] **Step 9.2: Adjust the price render**

Search for the code that fills `display-price` (the existing tariff display). Wrap it so the displayed amount is computed via `DynamicPricing`:

```js
function renderArtistPrice(artist) {
    const priceEl = document.getElementById('display-price');
    if (!priceEl) return;

    const dp = window.DynamicPricing
        ? window.DynamicPricing.applyDynamicFactor(artist)
        : { displayed: Number(artist.session_price_amount) || 0, base: Number(artist.session_price_amount) || 0, factor: 1, enabled: false };

    if (dp.base <= 0) {
        priceEl.textContent = artist.session_price || 'A consultar';
        return;
    }

    const formatted = window.DynamicPricing
        ? window.DynamicPricing.formatPrice({ amount: dp.displayed, currency: artist.session_price_currency })
        : `${dp.displayed} ${artist.session_price_currency || ''}`;

    priceEl.textContent = formatted;

    // Badge
    const badgeHost = document.getElementById('dynamic-price-badge-host');
    if (dp.enabled && dp.factor !== 1 && badgeHost && window.DynamicPricing) {
        window.DynamicPricing.renderBadge(badgeHost, artist.dynamic_pricing_breakdown);
    }
}
```

Then call `renderArtistPrice(artist)` from inside the existing artist-render flow (replace the line that currently sets `display-price.textContent` directly).

- [ ] **Step 9.3: Add badge host + script tag in HTML**

In `public/artist/profile/index.html`, locate the `#display-price` element (around the experience/tarifa section near lines 286-297). Add a sibling host:

```html
<span id="display-price"></span>
<span id="dynamic-price-badge-host"></span>
```

And ensure `dynamic-pricing.js` is loaded before `artist-profile.js`:

```html
<script src="/shared/js/dynamic-pricing.js"></script>
<script src="/shared/css/dynamic-pricing.css"></script>
```

(For CSS, prefer `<link rel="stylesheet" href="/shared/css/dynamic-pricing.css">` in the `<head>`.)

- [ ] **Step 9.4: Verify**

1. With `dynamic_pricing_enabled = false` for an artist, public profile shows the unchanged price (regression check).
2. With `enabled = true` and `factor = 1.21` (set manually for testing), public profile shows base × 1.21 and a small "Tarifa dinámica" pill next to the price.
3. Hover the pill — tooltip shows the breakdown via `formatBreakdown`.

- [ ] **Step 9.5: Commit**

```bash
git add public/shared/js/artist-profile.js public/artist/profile/index.html
git commit -m "feat(profile): apply dynamic pricing factor and badge on public profile"
```

---

## Task 10: Marketplace — Apply factor on artist cards

**Files:**
- Modify: `public/marketplace/index.html`
- Modify: `public/shared/js/marketplace.js`

- [ ] **Step 10.1: Load the helper in HTML**

Add to `public/marketplace/index.html` (alongside other shared scripts):

```html
<link rel="stylesheet" href="/shared/css/dynamic-pricing.css">
<script src="/shared/js/dynamic-pricing.js"></script>
```

(Place the `<script>` before `marketplace.js` is loaded.)

- [ ] **Step 10.2: Extend the SELECT in marketplace.js**

Search for the artist list query in `marketplace.js` (the `.from('artists_db').select(...)` call). Add to the selected fields:

```
,session_price_amount,session_price_currency,dynamic_pricing_enabled,dynamic_pricing_factor,dynamic_pricing_breakdown
```

- [ ] **Step 10.3: Use the helper when rendering cards**

In the card render function (search for the template literal that builds each artist card and references `session_price`), replace the price rendering with:

```js
const dp = window.DynamicPricing
    ? window.DynamicPricing.applyDynamicFactor(artist)
    : { displayed: Number(artist.session_price_amount) || 0, factor: 1, enabled: false };
const priceText = dp.displayed
    ? (window.DynamicPricing
        ? window.DynamicPricing.formatPrice({ amount: dp.displayed, currency: artist.session_price_currency })
        : `${dp.displayed} ${artist.session_price_currency || ''}`)
    : (artist.session_price || 'A consultar');
const dynamicBadge = (dp.enabled && dp.factor !== 1) ? '<span class="dynamic-price-badge" title="Tarifa actualizada según demanda y reseñas">Tarifa dinámica</span>' : '';
```

Then in the card HTML template, render `${priceText} ${dynamicBadge}` where the price is shown.

- [ ] **Step 10.4: Verify**

1. Browse `/marketplace`. Artists with the toggle off show their original `session_price` exactly as before.
2. An artist with `enabled = true` shows the adjusted price + the small "Tarifa dinámica" pill.

- [ ] **Step 10.5: Commit**

```bash
git add public/marketplace/index.html public/shared/js/marketplace.js
git commit -m "feat(marketplace): show dynamic price and badge on artist cards"
```

---

## Task 11: Quotation flow — Use dynamic price for `artist_session_cost_amount`

**Files:**
- Modify: `public/quotation/index.html`
- Modify: `public/shared/js/script.js`

- [ ] **Step 11.1: Load the helper in HTML**

Add to `public/quotation/index.html` (before `script.js` is loaded):

```html
<script src="/shared/js/dynamic-pricing.js"></script>
```

- [ ] **Step 11.2: Locate `handleUrlArtist`**

In `public/shared/js/script.js`, the function `handleUrlArtist` near lines 446-483 sets `formData.artist_session_cost_amount` from `artist.session_price`. Adjust:

```js
        if (artist) {
            formData.artist_username = artist.username;
            formData.artist_id = artist.user_id;
            formData.artist_name = artist.name;

            // Apply dynamic pricing if enabled
            const dp = window.DynamicPricing
                ? window.DynamicPricing.applyDynamicFactor(artist)
                : null;
            const sessionAmount = (dp && dp.enabled && dp.factor !== 1)
                ? dp.displayed
                : (Number(artist.session_price_amount) || artist.session_price);

            formData.artist_session_cost_amount = sessionAmount;
            formData.artist_session_cost_currency = artist.session_price_currency || formData.artist_session_cost_currency;
            formData.artist_dynamic_factor_applied = (dp && dp.enabled) ? dp.factor : 1.0;
            // ... rest of the existing logic ...
        }
```

- [ ] **Step 11.3: Extend the artist SELECT**

Earlier in `script.js`, the query that loads the artist row needs the new fields. Search for `.from('artists_db').select(` near `handleUrlArtist` (the existing call selects `*` or specific fields). If `*`, no change needed; if specific list, add `session_price_amount, session_price_currency, dynamic_pricing_enabled, dynamic_pricing_factor`.

- [ ] **Step 11.4: Verify**

1. Open `/quotation?artist=<username-of-opted-in-artist>`. The quotation confirm screen and any later "session cost" display reflects the adjusted amount.
2. Open `/quotation?artist=<username-of-non-opted-in-artist>`. No change vs current behavior.

- [ ] **Step 11.5: Commit**

```bash
git add public/quotation/index.html public/shared/js/script.js
git commit -m "feat(quotation): apply dynamic pricing factor when initializing artist context"
```

---

## Task 12: Quote response prefill in `shared-drawer.js`

**Files:**
- Modify: `public/shared/js/shared-drawer.js`

- [ ] **Step 12.1: Locate the response form render**

`shared-drawer.js#submitResponse` (near lines 2107-2124) reads `#response-price`. The form is opened by another function that renders the drawer. Search for the function that *opens* the response form (likely `openResponseForm` or similar — search for `#response-price` to find its setup).

- [ ] **Step 12.2: Pre-fill with dynamic price**

When opening the response form for a quote, fetch the artist's dynamic state (the artist is the current user), then populate `#response-price`:

```js
async function prefillResponsePriceWithDynamic(artistUserId, defaultAmount, currency) {
    try {
        const r = await fetch(`/api/artists/${encodeURIComponent(artistUserId)}/dynamic-pricing`);
        if (!r.ok) return defaultAmount;
        const data = await r.json();
        if (data.enabled && data.displayed_price_amount) {
            return data.displayed_price_amount;
        }
        return defaultAmount;
    } catch (_) {
        return defaultAmount;
    }
}
```

Then in the function that renders the response form, call:

```js
const baseAmount = quote.artist_session_cost_amount || (artist && artist.session_price_amount) || '';
const prefilled = await prefillResponsePriceWithDynamic(currentUser.id, baseAmount, quote.client_budget_currency || 'USD');
document.getElementById('response-price').value = prefilled || '';
```

And add a small subtitle next to the price input (optional but recommended):

```html
<small class="response-price-hint" id="response-price-hint" style="display:none;">
  Tarifa dinámica aplicada — podés editarla.
</small>
```

Toggle it visible if `data.enabled && data.displayed_price_amount && Number(prefilled) !== Number(baseAmount)`.

- [ ] **Step 12.3: Verify**

1. As an opted-in artist with a non-1.0 factor, open a pending quote → click "Responder" → the price field is pre-filled with the dynamic amount and the hint appears. The artist can edit before submitting.
2. As a non-opted-in artist, the price field pre-fills with the default (current behavior; no regression).
3. After editing and submitting, `quotations_db.artist_budget_amount` reflects the *final* value the artist typed (not the auto-prefilled value), confirming override works.

- [ ] **Step 12.4: Commit**

```bash
git add public/shared/js/shared-drawer.js
git commit -m "feat(quotations): prefill artist response price with dynamic amount + override hint"
```

---

## Task 13: Operational — Document the n8n cron call

**Files:**
- Modify: `.env.example`

- [ ] **Step 13.1: Locate the existing currencies cron docs**

The `.env.example` already documents the n8n call to `/api/admin/currencies/bulk-update` and `/api/admin/currencies/refresh-now`. Find that section.

- [ ] **Step 13.2: Append documentation**

Add right after the currencies cron docs:

```
# n8n daily cron — recompute dynamic pricing for opted-in artists
# Schedule: daily at 04:30 UTC (after currencies refresh)
# POST {SERVER_URL}/api/admin/dynamic-pricing/recompute
# Headers: X-Cron-Token: $CRON_API_TOKEN
# Body: (none)
# Response: { success, processed, updated, errors[] }
```

- [ ] **Step 13.3: Commit**

```bash
git add .env.example
git commit -m "docs(env): document daily dynamic-pricing recompute cron call"
```

---

## Task 14: Final QA — End-to-end manual checklist

No file changes; this task validates the integration end-to-end before merge.

- [ ] **Step 14.1: Migrate**

Apply both new migrations on a staging Supabase project. Verify all `SELECT to_regclass(...)` and the column listings from Tasks 1 and 2.

- [ ] **Step 14.2: Smoke the cron locally**

```powershell
$token = (Get-Content .env | Select-String '^CRON_API_TOKEN=').ToString().Split('=')[1]
curl -X POST http://localhost:3000/api/admin/dynamic-pricing/recompute -H "X-Cron-Token: $token"
```

Expected: `{ success: true, processed: 0, updated: 0, errors: [] }` if no artists are opted in yet.

- [ ] **Step 14.3: Opt-in flow (artist UX)**

1. Log in as a test artist on `/artist/dashboard`.
2. The "Tarifa dinámica" row shows "Desactivada".
3. Click "Editar perfil" → toggle ON → "Guardar cambios".
4. Reload. Row shows "Activada", panel visible with "Pendiente — se actualizará...".
5. Run the cron (Step 14.2). Reload dashboard. Panel now shows breakdown.

- [ ] **Step 14.4: Public surface checks**

1. `/artist/<username>` — adjusted price + "Tarifa dinámica" pill near the price.
2. `/marketplace` — that artist's card shows the adjusted price + pill. Other (opt-out) artists unchanged.
3. `/quotation?artist=<username>` — confirm screen and "session cost" reflect the adjusted amount.

- [ ] **Step 14.5: Override check**

1. As that artist, open one of their quotes → "Responder". Price input pre-filled with dynamic amount. Hint visible.
2. Type a different number → submit. In Supabase, `quotations_db.artist_budget_amount` for that quote equals the typed value (not the prefilled one).

- [ ] **Step 14.6: Opt-out and regression check**

1. Toggle the dynamic pricing OFF on the dashboard. Save.
2. All public surfaces revert to the original `session_price`.
3. New quotation responses prefill with the original amount, not the (now stale) dynamic factor.

- [ ] **Step 14.7: Cron edge cases**

1. Artist with no rating data (no `quotation_surveys`) → factor reflects only demand tier (or 1.0 if no zone data).
2. Artist with no city and no `artist_tattoo_locations` → demand contribution is 0, factor reflects only rating tier.
3. Both signals missing → factor = 1.000 (no change vs base).

- [ ] **Step 14.8: Wire the n8n workflow**

In n8n, duplicate the existing "Currency refresh daily" workflow, change the URL to `/api/admin/dynamic-pricing/recompute`, schedule for 04:30 UTC daily. Run once manually from n8n; verify it returns `success: true`.

- [ ] **Step 14.9: Final commit (if any docs/notes were added) and push**

```bash
git status
# If clean → no commit
git push origin <branch>
```

---

## Notes for the Engineer

- **No new env vars needed.** Reuse existing `CRON_API_TOKEN`.
- **No new dependencies.** All work uses existing Express + raw `fetch` + Supabase REST + vanilla JS.
- **Backward compatibility:** every public-facing change is gated on `dynamic_pricing_enabled = true`. Artists who don't opt in see zero behavior change.
- **Concurrency safety on matview:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires the unique index on `city_key` (Task 2 creates it). The fallback in `refresh_zone_demand_metrics()` handles the rare case where it's empty/being created.
- **Where the rounding happens:** the displayed amount is `round(base × factor)` to integer. If you need 2-decimal precision in the future, change the `Math.round(...)` calls in `dynamic-pricing.js`, `server.js`, and the cron handler in lock-step.
- **Trust boundary:** the artist's browser can write `dynamic_pricing_enabled` to `artists_db` (via the existing dashboard → Supabase RLS path), but the `factor`, `breakdown`, and `calculated_at` are written *only* by the cron using the service role. Don't expose service role calls to the browser.
- **Performance:** the cron is O(N) over opted-in artists × 2 RPCs each. Even at 10k opted-in artists, this is well under a few minutes. If it grows further, batch the RPCs or compute in a single SQL call.
