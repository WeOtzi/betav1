"""Inspect Docker network subnets on the VPS to find safe IPV4_NETWORK for BillionMail."""
import paramiko
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = os.environ.get('BM_HOST', '69.62.98.207')
PORT = int(os.environ.get('BM_PORT', '22'))
USER = os.environ.get('BM_USER', 'root')
PASS = os.environ.get('BM_PASS', 'Abnerisai24.')

def run(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    return stdout.read().decode('utf-8', errors='replace').strip()

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
    print('Networks and their subnets:\n')
    nets = run(ssh, 'docker network ls --format "{{.Name}}"')
    for net in nets.splitlines():
        net = net.strip()
        if not net:
            continue
        subnet = run(ssh, f'docker network inspect {net} -f "{{{{range .IPAM.Config}}}}{{{{.Subnet}}}}|{{{{end}}}}"')
        print(f'  {net:40s} -> {subnet}')
    print()
    print('Free port check (8088, 8443, 8089):')
    for p in [8088, 8443, 8089, 8090]:
        out = run(ssh, f'ss -tnlp | grep -E ":{p} " || echo FREE')
        print(f'  port {p}: {out}')
    ssh.close()

if __name__ == '__main__':
    main()
