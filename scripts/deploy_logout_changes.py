"""
Deploy artist logout changes to production server.
Uploads modified files to beta.weotzi.com server.
"""

import paramiko
import os
import sys

# Server credentials
HOST = '92.112.189.44'
PORT = 65002
USERNAME = 'u795331143'
PASSWORD = 'Abnerisai24.'

# Local workspace root
LOCAL_ROOT = r'c:\Users\Isaí\OneDrive\Compartida MacWin\We Otzi\Beta Cerrada V1\weotzi-unified'

# Confirmed remote base path (where the main server.js lives)
REMOTE_BASE = '/home/u795331143/domains/weotzi.com/public_html/beta'

# Files modified during this session
MODIFIED_FILES = [
    'public/shared/js/dashboard.js',
    'public/artist/dashboard/index.html',
    'public/registerclosedbeta/index.html',
    'public/shared/js/main.js',
    'public/my-quotations/index.html',
    'public/shared/js/quotations.js',
    'public/shared/css/dashboard.css',
    'public/shared/css/quotations.css',
]


def upload_file(sftp, local_path, remote_path):
    """Upload a single file, creating directories as needed."""
    remote_dir = os.path.dirname(remote_path)
    # Ensure all parent directories exist
    parts = remote_dir.lstrip('/').split('/')
    current = ''
    for part in parts:
        current = f'{current}/{part}' if current else f'/{part}'
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)

    sftp.put(local_path, remote_path)
    print(f'  OK  {remote_path}')


def main():
    print(f'Connecting to {HOST}:{PORT}...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USERNAME, password=PASSWORD)
    print(f'Connected. Remote base: {REMOTE_BASE}')

    sftp = ssh.open_sftp()
    errors = []

    for rel_path in MODIFIED_FILES:
        local_file = os.path.join(LOCAL_ROOT, rel_path.replace('/', os.sep))
        remote_file = f"{REMOTE_BASE}/{rel_path}"

        if not os.path.exists(local_file):
            print(f'  SKIP (not found locally): {local_file}')
            continue

        try:
            upload_file(sftp, local_file, remote_file)
        except Exception as e:
            print(f'  FAIL {rel_path}: {e}')
            errors.append((rel_path, str(e)))

    sftp.close()
    ssh.close()

    print('\n--- Upload summary ---')
    print(f'Files attempted: {len(MODIFIED_FILES)}')
    print(f'Errors: {len(errors)}')
    for path, err in errors:
        print(f'  {path}: {err}')

    if not errors:
        print('\nAll files uploaded successfully.')
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
