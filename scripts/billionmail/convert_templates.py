"""
Convert email HTML templates from n8n syntax to BillionMail-compatible syntax.

n8n uses placeholders like:
  {{ $json.body.data.full_name }}
  {{ $json.body.data.whatsapp || 'No proporcionado' }}

BillionMail (Go templates) expects flat variables:
  {{full_name}}
  {{whatsapp}}      <-- fallback "No proporcionado" must be supplied via attribs (see
                       services/email-event-mapping.js).

Strategy:
1. Read every templates/email/<name>.html (skip .min.html duplicates).
2. Apply regex transforms to convert n8n placeholders to flat {{var}}.
3. Drop the inline `|| 'fallback'` portion (defaults move to email-event-mapping).
4. Write to templates/email/billionmail/<name>.html.
5. Emit a manifest JSON listing each template with the variables it references.

Idempotent: running twice does not double-convert (already-flat placeholders are left
untouched).
"""

import os
import re
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC_DIR = os.path.join(ROOT, 'templates', 'email')
OUT_DIR = os.path.join(SRC_DIR, 'billionmail')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')

N8N_DOTTED_RE = re.compile(r'\{\{\s*\$json(?:\.[A-Za-z_][A-Za-z0-9_]*)+\s*\}\}')
N8N_FALLBACK_RE = re.compile(
    r"\{\{\s*\$json(?:\.[A-Za-z_][A-Za-z0-9_]*)+\s*\|\|\s*['\"][^'\"]*['\"]\s*\}\}"
)
FLAT_RE = re.compile(r'\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}')
DOTTED_VAR_RE = re.compile(r'\$json(?:\.[A-Za-z_][A-Za-z0-9_]*)+')


def last_segment(expr: str) -> str:
    return expr.split('.')[-1]


def convert(text: str):
    variables = set()

    def _flatten_dotted(m):
        chunk = m.group(0)
        inner = re.search(DOTTED_VAR_RE, chunk).group(0)
        var = last_segment(inner)
        variables.add(var)
        return f'{{{{{var}}}}}'

    def _flatten_fallback(m):
        chunk = m.group(0)
        inner = re.search(DOTTED_VAR_RE, chunk).group(0)
        var = last_segment(inner)
        variables.add(var)
        return f'{{{{{var}}}}}'

    text = N8N_FALLBACK_RE.sub(_flatten_fallback, text)
    text = N8N_DOTTED_RE.sub(_flatten_dotted, text)

    for m in FLAT_RE.finditer(text):
        var = m.group(1)
        if len(var) >= 3 and not var.isdigit():
            variables.add(var)

    return text, sorted(variables)


def main():
    if not os.path.isdir(SRC_DIR):
        print(f'Templates directory not found: {SRC_DIR}')
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    manifest = {}
    converted = 0
    untouched = 0
    skipped_min = 0

    for name in sorted(os.listdir(SRC_DIR)):
        if not name.lower().endswith('.html'):
            continue
        if name.lower().endswith('.min.html'):
            skipped_min += 1
            continue
        src = os.path.join(SRC_DIR, name)
        with open(src, 'r', encoding='utf-8') as f:
            content = f.read()

        new_content, variables = convert(content)

        out = os.path.join(OUT_DIR, name)
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(new_content)

        if new_content != content:
            converted += 1
        else:
            untouched += 1

        template_hint = os.path.splitext(name)[0]
        manifest[template_hint] = {
            'file': f'templates/email/billionmail/{name}',
            'variables': variables
        }

    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f'Converted {converted} templates ({untouched} unchanged, skipped {skipped_min} .min.html duplicates)')
    print(f'Output dir : {OUT_DIR}')
    print(f'Manifest   : {MANIFEST}')


if __name__ == '__main__':
    main()
