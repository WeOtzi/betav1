"""
BillionMail VPS inventory check.
Connects to the new VPS and reports state of Docker, ports, etc.
"""
import paramiko
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = os.environ.get('BM_HOST', '69.62.98.207')
PORT = int(os.environ.get('BM_PORT', '22'))
USER = os.environ.get('BM_USER', 'root')
PASS = os.environ.get('BM_PASS', 'Abnerisai24.')

def run(ssh, cmd, timeout=20):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}:{PORT} as {USER}...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
    print("Connected.\n")

    checks = [
        ('docker_ps', 'docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Status}}"'),
        ('docker_ps_all', 'docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}" | head -20'),
        ('docker_volumes', 'docker volume ls 2>/dev/null | head -20'),
        ('docker_networks', 'docker network ls'),
        ('opt_dir', 'ls -la /opt/ 2>/dev/null'),
        ('home_dir', 'ls -la /root/ 2>/dev/null'),
        ('compose_files', 'find / -maxdepth 5 -name docker-compose.yml -o -name compose.yml 2>/dev/null | head -10'),
        ('mail_ports', 'ss -tnlp 2>/dev/null | grep -E ":(25|465|587|110|143|993|995)" || echo NO_MAIL_PORTS_LISTENING'),
        ('postfix', 'systemctl is-active postfix 2>&1 || echo not-active'),
        ('container_for_3000', 'docker ps --filter publish=3000 --format "{{.Names}} ({{.Image}})" 2>/dev/null'),
        ('container_for_80', 'docker ps --filter publish=80 --format "{{.Names}} ({{.Image}})" 2>/dev/null'),
        ('container_for_443', 'docker ps --filter publish=443 --format "{{.Names}} ({{.Image}})" 2>/dev/null'),
    ]
    for name, cmd in checks:
        print(f"--- {name} ---")
        out, err = run(ssh, cmd)
        if out:
            print(out)
        if err and 'systemctl' not in cmd:
            print(f"(stderr) {err}")
        print()
    ssh.close()

if __name__ == '__main__':
    main()
