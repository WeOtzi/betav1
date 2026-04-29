"""
BillionMail status & health check.
Reports container health, recent logs, and the DNS records the user must configure.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from _ssh import connect, run  # type: ignore


def step(msg):
    print(f'\n=== {msg} ===')


def main():
    ssh, creds = connect()

    step('Container health')
    out, _, _ = run(
        ssh,
        'docker ps --filter "name=billionmail" --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    )
    print(out)

    step('All containers exit code (None means running)')
    out, _, _ = run(
        ssh,
        'docker compose -f /opt/billionmail/docker-compose.yml --env-file /opt/billionmail/.env ps -a',
    )
    print(out)

    step('Last 30 lines of core container log')
    out, _, _ = run(ssh, 'docker logs --tail 30 billionmail-core-billionmail-1 2>&1')
    print(out)

    step('Last 15 lines of postfix container log')
    out, _, _ = run(ssh, 'docker logs --tail 15 billionmail-postfix-billionmail-1 2>&1')
    print(out)

    step('Last 15 lines of dovecot container log')
    out, _, _ = run(ssh, 'docker logs --tail 15 billionmail-dovecot-billionmail-1 2>&1')
    print(out)

    step('Local panel HTTP status')
    out, _, _ = run(
        ssh,
        'curl -ks -o /dev/null -w "HTTP %{http_code}\\n" https://127.0.0.1:8443/'
        ' && curl -s -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:8088/',
    )
    print(out)

    step('Read .env credentials')
    out, _, _ = run(ssh, 'grep -E "^(ADMIN_|SafePath|BILLIONMAIL_HOSTNAME|HTTP_PORT|HTTPS_PORT)=" /opt/billionmail/.env')
    print(out)

    step('Check `bm` helper if available')
    out, _, code = run(ssh, 'which bm 2>/dev/null && bm default 2>/dev/null || echo "bm helper not available"')
    print(out)

    step('Check public reachability of mail server (port 25)')
    out, _, _ = run(ssh, 'curl -s --connect-timeout 5 -v telnet://69.62.98.207:25 2>&1 | head -5 || true')
    print(out)

    step('DKIM keys present in /opt/billionmail/conf')
    out, _, _ = run(ssh, 'ls /opt/billionmail/conf/postfix/dkim/ 2>/dev/null || ls -la /opt/billionmail/ssl/ 2>/dev/null | head -10')
    print(out)

    ssh.close()


if __name__ == '__main__':
    main()
