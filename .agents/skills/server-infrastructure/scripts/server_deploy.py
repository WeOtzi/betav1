"""
We Otzi Server Deploy - Targeted File Deployment
Upload specific files to the beta server without full redeployment.
Usage: python server_deploy.py <file1> [file2] [...] [--restart]
  --restart: Restart PM2 after upload
  Files are uploaded relative to project root -> server beta dir

Examples:
  python server_deploy.py server.js --restart
  python server_deploy.py public/shared/js/main.js public/shared/css/dashboard.css
  python server_deploy.py ecosystem.config.js --restart
"""
import paramiko
import sys
import io
import os
import time
from scp import SCPClient

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
CREDS_FILE = os.path.join(PROJECT_ROOT, '.server-credentials')
REMOTE_DIR = "/home/u795331143/domains/weotzi.com/public_html/beta"

def load_credentials():
    creds = {}
    if os.path.exists(CREDS_FILE):
        with open(CREDS_FILE) as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    key, val = line.split('=', 1)
                    creds[key.strip()] = val.strip()
    return creds

def main():
    args = sys.argv[1:]
    restart = '--restart' in args
    files = [a for a in args if a != '--restart']

    if not files:
        print("Usage: python server_deploy.py <file1> [file2] [...] [--restart]")
        print("Files are relative to project root.")
        sys.exit(1)

    local_files = []
    for f in files:
        local_path = os.path.join(PROJECT_ROOT, f.replace('/', os.sep))
        if os.path.exists(local_path):
            local_files.append((local_path, f))
        else:
            print(f"WARNING: File not found: {local_path}")

    if not local_files:
        print("No valid files to deploy.")
        sys.exit(1)

    creds = load_credentials()
    host = creds.get('SSH_HOST', '92.112.189.44')
    port = int(creds.get('SSH_PORT', '65002'))
    user = creds.get('SSH_USER', 'u795331143')
    password = creds.get('SSH_PASS', 'Abnerisai24.')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"Connecting to {host}:{port}...")
        ssh.connect(host, port=port, username=user, password=password)
        print("Connected.\n")

        with SCPClient(ssh.get_transport()) as scp:
            for local_path, rel_path in local_files:
                remote_path = f"{REMOTE_DIR}/{rel_path.replace(os.sep, '/')}"
                remote_dir = os.path.dirname(remote_path)

                stdin, stdout, stderr = ssh.exec_command(f"mkdir -p {remote_dir}")
                stdout.channel.recv_exit_status()

                print(f"  Uploading: {rel_path} -> {remote_path}")
                scp.put(local_path, remote_path=remote_path)

        print(f"\nUploaded {len(local_files)} file(s).")

        if restart:
            ENV = "export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2"
            PM2 = "./node_modules/.bin/pm2"
            print("\nRestarting PM2...")
            stdin, stdout, stderr = ssh.exec_command(
                f"{ENV} && cd {REMOTE_DIR} && ({PM2} restart weotzi-beta || {PM2} start ecosystem.config.js)"
            )
            stdout.channel.recv_exit_status()
            out = stdout.read().decode('utf-8', errors='replace').strip()
            print(out)

            time.sleep(3)
            stdin, stdout, stderr = ssh.exec_command(
                f'curl -s -o /dev/null -w "%{{http_code}}" http://127.0.0.1:4545/'
            )
            stdout.channel.recv_exit_status()
            code = stdout.read().decode().strip()
            print(f"\nPort test: HTTP {code}")

            if code in ('200', '302'):
                print("SUCCESS: App is running after deploy.")
            else:
                print("WARNING: App may not be responding. Check logs.")

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
