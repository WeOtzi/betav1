"""
We Otzi Server Restart
Clean restart of the Node.js app via PM2.
Usage: python server_restart.py [--force]
  --force: Delete process and start fresh instead of graceful restart
"""
import paramiko
import sys
import io
import os
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CREDS_FILE = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', '.server-credentials')

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

def run_cmd(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err, exit_code

def main():
    force = '--force' in sys.argv
    creds = load_credentials()
    host = creds.get('SSH_HOST', '92.112.189.44')
    port = int(creds.get('SSH_PORT', '65002'))
    user = creds.get('SSH_USER', 'u795331143')
    password = creds.get('SSH_PASS', 'Abnerisai24.')

    ENV = "export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2"
    DIR = "/home/u795331143/domains/weotzi.com/public_html/beta"
    PM2 = "./node_modules/.bin/pm2"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        print(f"Connecting to {host}:{port}...")
        ssh.connect(host, port=port, username=user, password=password)
        print("Connected.\n")

        if force:
            print("[1/4] Deleting existing PM2 process...")
            out, err, _ = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} delete weotzi-beta 2>/dev/null || echo 'No process to delete'")
            print(f"  {out}")

            print("[2/4] Starting fresh from ecosystem.config.js...")
            out, err, code = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} start ecosystem.config.js")
            print(f"  {out}")
        else:
            print("[1/4] Attempting graceful restart...")
            out, err, code = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} restart weotzi-beta 2>/dev/null")
            if code != 0:
                print("  Graceful restart failed. Starting from ecosystem...")
                out, err, code = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} start ecosystem.config.js")
            print(f"  {out}")

        print("[3/4] Saving PM2 state...")
        run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} save")

        print("[4/4] Waiting 5s then verifying...")
        time.sleep(5)

        out, _, _ = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} list")
        print(f"\n{out}")

        out, _, _ = run_cmd(ssh, f'curl -s -o /dev/null -w "%{{http_code}}" http://127.0.0.1:4545/')
        print(f"\nLocal port test: HTTP {out}")

        if out in ('200', '302'):
            print("\nSUCCESS: App is running.")
        else:
            print("\nWARNING: Port 4545 not responding. Check PM2 logs.")
            out, _, _ = run_cmd(ssh, f"{ENV} && cd {DIR} && {PM2} logs weotzi-beta --lines 20 --nostream")
            print(out)

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
