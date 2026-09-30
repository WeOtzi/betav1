BEGIN;
-- Preserve each legacy result shape while making every read respect base-table RLS.
ALTER VIEW public.studio_dashboard_metrics_view SET (security_invoker = true);
ALTER VIEW public.studio_artist_performance_view SET (security_invoker = true);
ALTER VIEW public.studio_inventory_health_view SET (security_invoker = true);
REVOKE ALL ON public.studio_dashboard_metrics_view, public.studio_artist_performance_view, public.studio_inventory_health_view FROM PUBLIC, anon;
GRANT SELECT ON public.studio_dashboard_metrics_view, public.studio_artist_performance_view, public.studio_inventory_health_view TO authenticated;

-- Remote legacy health view uses item_id and burn rates. Keep it intact and
-- expose the dashboard's explicit currency/value contract separately.
CREATE VIEW public.studio_inventory_health_by_currency WITH (security_invoker = true) AS
SELECT id, studio_id, name, quantity_on_hand, reorder_level, currency,
  reorder_level IS NOT NULL AND quantity_on_hand <= reorder_level AS needs_reorder,
  (quantity_on_hand * coalesce(cost_per_unit, 0))::numeric(14,2) AS stock_value
FROM public.studio_inventory_items WHERE is_active = true;
REVOKE ALL ON public.studio_inventory_health_by_currency FROM PUBLIC, anon;
GRANT SELECT ON public.studio_inventory_health_by_currency TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
