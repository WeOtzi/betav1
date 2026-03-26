"""
We Otzi Server Logs
Fetch and display recent PM2 logs.
Usage: python server_logs.py [--lines N] [--errors]
  --lines N: Number of log lines (default 50)
  --errors: Show only error log
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

def main():
    lines = 50
    errors_only = False

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--lines' and i + 1 < len(args):
            lines = int(args[i + 1])
        elif arg == '--errors':
            errors_only = True

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
        ssh.connect(host, port=port, username=user, password=password)

        if errors_only:
            cmd = f"tail -n {lines} /home/u795331143/.pm2/logs/weotzi-beta-error.log 2>/dev/null || echo 'No error log found'"
            print(f"=== Error Log (last {lines} lines) ===\n")
        else:
            cmd = f"{ENV} && cd {DIR} && {PM2} logs weotzi-beta --lines {lines} --nostream 2>/dev/null || echo 'No logs available'"
            print(f"=== PM2 Logs (last {lines} lines) ===\n")

        stdin, stdout, stderr = ssh.exec_command(cmd)
        stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='replace').strip()
        print(out)

        print(f"\n--- Crash History (last 10 entries) ---")
        stdin, stdout, stderr = ssh.exec_command(f"tail -10 {DIR}/crash_history.log 2>/dev/null || echo 'No crash history'")
        stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='replace').strip()
        print(out)

    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
