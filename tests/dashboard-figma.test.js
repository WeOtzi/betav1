const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('dashboard waits for API config and rejects mismatched Supabase singletons', () => {
  const config = read('public/shared/js/config-manager.js');
  const dashboard = read('public/shared/js/dashboard.js');

  assert.ok(config.indexOf('window.ConfigManager = ConfigManager;') < config.indexOf('// Auto-initialize'));
  assert.match(config, /matchesConfiguredClient/);
  assert.match(config, /client\.supabaseUrl === url && client\.supabaseKey === key/);
  assert.match(dashboard, /window\.ConfigManager\.ready\(\)/);
  assert.match(dashboard, /DASHBOARD_CONFIG_READY_TIMEOUT_MS/);
});

test('Figma dashboard markup keeps gallery CTA inside the dark stage and a line-only footer', () => {
  const html = read('public/artist/dashboard/index.html');
  const css = read('public/shared/css/dashboard-redesign.css');
  const stageStart = html.indexOf('<div class="wo-dash-gallery-stage">');
  const stageEnd = html.indexOf('</div>\n            </div>\n        </div>\n    </section>', stageStart);
  const cta = html.indexOf('<section class="wo-dash-cta"', stageStart);

  assert.notEqual(stageStart, -1);
  assert.ok(cta > stageStart && cta < stageEnd, 'gallery CTA must be nested in the stage');
  assert.match(html, /<weotzi-product-nav[\s\S]*active="quotations"[\s\S]*badge-id="wod-nav-msg-badge"/);
  assert.match(css, /\.wo-dash-gallery-frame \{ border: none; \}/);
  assert.match(css, /\.wo-dash-footer[\s\S]*border-top: var\(--border-hairline\) solid var\(--ink\)/);
});

test('live dashboard honors the explicit demo context without affecting other artists', () => {
  const repo = read('public/shared/js/data/artists-repo.js');
  const redesign = read('public/shared/js/dashboard-redesign.js');

  assert.match(repo, /gallery_feed_items, dashboard_config/);
  assert.match(redesign, /dashboard_demo_quote_ids/);
  assert.match(redesign, /dashboard_demo_design_quote_ids/);
  assert.match(redesign, /dashboard_design_progress/);
  assert.match(redesign, /dashboard_demo_marker && supplementalActivity\.length/);
  assert.match(redesign, /quotations_db\(quote_id, client_full_name/);
  assert.match(redesign, /LÍMITE/);
});

test('Supabase demo seed is scoped, idempotent, and documents rollback', () => {
  const seed = read('supabase/seeds/20260829_isainaz_dashboard_demo.sql');
  const migration = read('supabase/migrations/20260829034500_fix_job_spot_rls_recursion.sql');

  assert.match(seed, /\[PRUEBA\]\[DASHBOARD-ISAINAZ-20260829\]/);
  assert.match(seed, /on conflict \(quote_id\) do update/);
  assert.match(seed, /JB-DEMO1/);
  assert.match(seed, /public\.artist_trips/);
  assert.match(seed, /public\.studio_spot_applications/);
  assert.match(seed, /public\.verified_reviews/);
  assert.match(seed, /Scoped rollback/);
  assert.match(migration, /security definer/);
  assert.match(migration, /is_job_board_request_applicant/);
  assert.match(migration, /is_studio_spot_applicant/);
});
