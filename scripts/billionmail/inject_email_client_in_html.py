"""
Inject `<script src="/shared/js/email-client.js"></script>` into every HTML page that
loads config-manager.js, immediately after the config-manager.js <script> tag.

Idempotent: if email-client.js is already loaded by a page, it is left untouched.
Targets only files under public/ (skips backups and .claude worktrees).
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUBLIC = os.path.join(ROOT, 'public')

CONFIG_RE = re.compile(
    r'(?P<indent>[ \t]*)<script\s+src="/shared/js/config-manager\.js"\s*>\s*</script>',
    re.IGNORECASE,
)
ALREADY_RE = re.compile(r'/shared/js/email-client\.js', re.IGNORECASE)


def find_html_files():
    out = []
    for root, _, files in os.walk(PUBLIC):
        for f in files:
            if f.lower().endswith('.html'):
                out.append(os.path.join(root, f))
    return out


def patch(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return None

    if not CONFIG_RE.search(content):
        return None
    if ALREADY_RE.search(content):
        return 'already'

    def repl(m):
        indent = m.group('indent') or ''
        return f'{m.group(0)}\n{indent}<script src="/shared/js/email-client.js"></script>'

    new_content, count = CONFIG_RE.subn(repl, content, count=1)
    if count == 0:
        return None
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(new_content)
    return 'patched'


def main():
    patched = []
    skipped = []
    no_match = []
    for p in find_html_files():
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        result = patch(p)
        if result == 'patched':
            patched.append(rel)
        elif result == 'already':
            skipped.append(rel)
        elif result is None:
            no_match.append(rel)

    print(f'Patched ({len(patched)}):')
    for x in patched:
        print(f'  {x}')
    print(f'\nAlready had email-client.js ({len(skipped)}):')
    for x in skipped:
        print(f'  {x}')
    if any('config-manager' in open(os.path.join(ROOT, f), encoding='utf-8').read()
           for f in no_match if os.path.exists(os.path.join(ROOT, f))):
        # informational only; nothing to do
        pass


if __name__ == '__main__':
    main()
