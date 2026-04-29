"""
Shared SSH helper for BillionMail VPS scripts.
Loads credentials from .server-credentials-billionmail at the project root.
"""
import paramiko
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CREDS_FILE = os.path.join(
    os.path.dirname(__file__), '..', '..', '.server-credentials-billionmail'
)


def load_creds():
    creds = {}
    if os.path.exists(CREDS_FILE):
        with open(CREDS_FILE, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1)
                    creds[k.strip()] = v.strip()
    creds.setdefault('BM_HOST', os.environ.get('BM_HOST', '69.62.98.207'))
    creds.setdefault('BM_PORT', os.environ.get('BM_PORT', '22'))
    creds.setdefault('BM_USER', os.environ.get('BM_USER', 'root'))
    creds.setdefault('BM_PASS', os.environ.get('BM_PASS', ''))
    if not creds['BM_PASS']:
        raise SystemExit(
            'BM_PASS not set. Create .server-credentials-billionmail or pass BM_PASS env var.'
        )
    return creds


def connect(timeout=30):
    creds = load_creds()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        creds['BM_HOST'],
        port=int(creds['BM_PORT']),
        username=creds['BM_USER'],
        password=creds['BM_PASS'],
        timeout=timeout,
    )
    return ssh, creds


def run(ssh, cmd, timeout=120, check=False, pty=False):
    """Run a command on the remote server. Returns (stdout, stderr, exit_code)."""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout, get_pty=pty)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if check and exit_code != 0:
        raise RuntimeError(
            f'Command failed (exit {exit_code}): {cmd}\nstdout: {out}\nstderr: {err}'
        )
    return out, err, exit_code


def upload_file(ssh, local_path, remote_path):
    """Upload a single file via SFTP."""
    sftp = ssh.open_sftp()
    sftp.put(local_path, remote_path)
    sftp.close()


def write_remote_file(ssh, remote_path, content):
    """Write content directly to a remote file via SFTP (overwrites)."""
    sftp = ssh.open_sftp()
    with sftp.open(remote_path, 'w') as f:
        f.write(content)
    sftp.close()
