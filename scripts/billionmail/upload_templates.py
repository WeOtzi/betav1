"""
Upload converted HTML templates to BillionMail.

Reads the manifest produced by convert_templates.py and POSTs each template through the
BillionMail API. Tries several candidate endpoints (the API surface evolves between
releases). Falls back to instructions for manual upload from the panel if the API
rejects all attempts.

Required env vars (or .billionmail-panel-credentials):
  BILLIONMAIL_API_URL   default https://bm.weotzi.com
  BILLIONMAIL_API_KEY   from BillionMail panel: Settings -> API

Usage:
  python scripts/billionmail/upload_templates.py [--dry-run] [--name=<one_template>]
"""

import os
import json
import sys
import io
import argparse
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MANIFEST = os.path.join(ROOT, 'templates', 'email', 'billionmail', 'manifest.json')
RESULT = os.path.join(ROOT, 'templates', 'email', 'billionmail', 'upload-result.json')
PANEL_CREDS = os.path.join(ROOT, '.billionmail-panel-credentials')


def load_creds():
    creds = {}
    if os.path.exists(PANEL_CREDS):
        with open(PANEL_CREDS, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1)
                    creds[k.strip()] = v.strip()
    api_url = (
        os.environ.get('BILLIONMAIL_API_URL')
        or creds.get('BILLIONMAIL_API_URL')
        or 'https://bm.weotzi.com'
    )
    api_key = (
        os.environ.get('BILLIONMAIL_API_KEY')
        or creds.get('BILLIONMAIL_API_KEY')
        or ''
    )
    return api_url.rstrip('/'), api_key


def http_request(method, url, headers=None, body=None, timeout=30):
    req = urllib.request.Request(url, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
            text = resp.read().decode('utf-8', errors='replace')
            return resp.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode('utf-8', errors='replace')
        return e.code, text
    except Exception as e:
        return 0, str(e)


ENDPOINTS = [
    {'method': 'POST', 'path': '/api/template/save'},
    {'method': 'POST', 'path': '/api/email_template/save'},
    {'method': 'POST', 'path': '/api/templates'},
    {'method': 'POST', 'path': '/api/template/create'},
]


def try_upload(api_url, api_key, name, html, variables):
    headers = {
        'X-API-Key': api_key,
        'Authorization': f'Bearer {api_key}',
    }
    body = {
        'name': name,
        'tag': name,
        'subject': name.replace('-', ' ').title(),
        'content': html,
        'html_content': html,
        'body': html,
        'variables': variables,
        'attribs': variables,
    }
    last_err = None
    for ep in ENDPOINTS:
        status, text = http_request(ep['method'], api_url + ep['path'], headers=headers, body=body)
        if status == 0:
            last_err = f"network error: {text}"
            continue
        if 200 <= status < 300:
            return True, status, ep['path'], text
        last_err = f"{ep['method']} {ep['path']} -> HTTP {status}: {text[:200]}"
    return False, None, None, last_err


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--name')
    args = parser.parse_args()

    api_url, api_key = load_creds()
    if not args.dry_run and not api_key:
        print('ERROR: BILLIONMAIL_API_KEY not set.')
        print('  - Generate it from the panel: Settings -> API.')
        print(f'  - Add it to {PANEL_CREDS} or pass via env BILLIONMAIL_API_KEY.')
        sys.exit(1)

    if not os.path.exists(MANIFEST):
        print(f'ERROR: manifest not found: {MANIFEST}')
        print('  Run scripts/billionmail/convert_templates.py first.')
        sys.exit(1)

    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)

    targets = manifest if not args.name else (
        {args.name: manifest[args.name]} if args.name in manifest else {}
    )
    if not targets:
        print(f'ERROR: template "{args.name}" not in manifest')
        sys.exit(1)

    print(f'API URL : {api_url}')
    print(f'API key : {"<set>" if api_key else "<missing>"}')
    print(f'Mode    : {"DRY RUN" if args.dry_run else "UPLOAD"}')
    print(f'Templates to process: {len(targets)}')
    print()

    results = {}
    successes = 0
    failures = 0
    for name, info in targets.items():
        path = os.path.join(ROOT, info['file'])
        with open(path, encoding='utf-8') as f:
            html = f.read()

        if args.dry_run:
            print(f'  [dry-run] {name:<35s} {len(html):>6d} bytes  vars={len(info["variables"])}')
            results[name] = {'dry_run': True}
            continue

        ok, status, ep, body = try_upload(api_url, api_key, name, html, info['variables'])
        if ok:
            print(f'  [OK]      {name:<35s} via {ep}  HTTP {status}')
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {'raw': body[:200]}
            results[name] = {'ok': True, 'endpoint': ep, 'status': status, 'response': parsed}
            successes += 1
        else:
            print(f'  [FAIL]    {name:<35s}  {body}')
            results[name] = {'ok': False, 'error': body}
            failures += 1

    if not args.dry_run:
        with open(RESULT, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f'\nResult saved to {RESULT}')
        print(f'Summary: {successes} OK, {failures} failed')

    if failures > 0:
        print()
        print('Manual fallback for failed templates:')
        print('  1. Open the panel (https URL after DNS, or SSH tunnel)')
        print('  2. Settings -> Email Templates -> New Template')
        print('  3. For each failed template, paste the HTML from templates/email/billionmail/<name>.html')
        sys.exit(1 if failures > 0 and successes == 0 else 0)


if __name__ == '__main__':
    main()
