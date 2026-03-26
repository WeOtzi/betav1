"""
We Otzi Server Health Check
Full diagnostics: PM2 status, port connectivity, disk, memory, recent logs.
"""
import paramiko
import sys
import io
import os

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

        checks = [
            ("PM2 Process List", f"{ENV} && cd {DIR} && {PM2} list"),
            ("Port 4545 Health", f'curl -s -o /dev/null -w "%{{http_code}}" http://127.0.0.1:4545/ 2>/dev/null || echo "UNREACHABLE"'),
            ("Disk Usage", "df -h / | tail -1"),
            ("Memory Usage", "free -h | grep Mem"),
            ("Node.js Version", "/opt/alt/alt-nodejs22/root/bin/node --version"),
            ("Recent PM2 Logs (last 15 lines)", f"{ENV} && cd {DIR} && {PM2} logs weotzi-beta --lines 15 --nostream 2>/dev/null || echo 'No logs available'"),
            ("Crash History (last 10 lines)", f"tail -10 {DIR}/crash_history.log 2>/dev/null || echo 'No crash history'"),
            ("Public URL Test", 'curl -s -o /dev/null -w "%{http_code}" https://beta.weotzi.com/quotation/ 2>/dev/null || echo "UNREACHABLE"'),
        ]

        for name, cmd in checks:
            print(f"--- {name} ---")
            out, err, code = run_cmd(ssh, cmd)
            if out:
                print(out)
            if err and "pm2" not in cmd.lower():
                print(f"  (stderr: {err})")
            print()

        print("=== Health Check Complete ===")

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
