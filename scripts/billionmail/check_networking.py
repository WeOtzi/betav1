"""
Check whether Traefik's `easypanel` overlay network is attachable, and find a way for
Traefik to reach BillionMail's core container.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from _ssh import connect, run  # type: ignore


def main():
    ssh, _ = connect()

    print('=== Is easypanel network attachable? ===')
    out, _, _ = run(
        ssh, 'docker network inspect easypanel -f "Attachable={{.Attachable}} Scope={{.Scope}} Driver={{.Driver}}"'
    )
    print(out)

    print('\n=== Easypanel network details (subnet, gateway, containers count) ===')
    out, _, _ = run(
        ssh,
        'docker network inspect easypanel --format "Subnet={{range .IPAM.Config}}{{.Subnet}}{{end}} Gateway={{range .IPAM.Config}}{{.Gateway}}{{end}}"',
    )
    print(out)

    print('\n=== Existing dynamic configs in /etc/easypanel/traefik ===')
    out, _, _ = run(ssh, 'ls -la /etc/easypanel/traefik/')
    print(out)
    out, _, _ = run(ssh, 'ls -la /etc/easypanel/traefik/config/ 2>/dev/null || echo NO_CONFIG_DIR')
    print(out)
    out, _, _ = run(ssh, 'cat /etc/easypanel/traefik/acme.json 2>/dev/null | head -3 || echo NO_ACME')
    print(out)

    print('\n=== Sample existing app to learn the pattern ===')
    out, _, _ = run(
        ssh,
        'docker ps --format "{{.Names}}" | head -3 | while read n; do '
        'echo "=== $n labels ==="; '
        'docker inspect $n -f "{{range \\$k,\\$v := .Config.Labels}}{{\\$k}}={{\\$v}}{{println}}{{end}}" '
        '| grep -i "traefik\\|easypanel" | head -10; '
        'done',
    )
    print(out)

    print('\n=== Can the host reach 127.0.0.1:8088 from a swarm container? ===')
    # Run a busybox in the easypanel network and curl host gateway
    out, _, _ = run(
        ssh,
        'docker run --rm --network easypanel alpine:3 sh -c '
        '"apk add -q curl >/dev/null 2>&1; '
        ' echo gateway:; ip route | grep default; '
        ' for ip in 172.17.0.1 172.18.0.1 host.docker.internal 169.254.0.1 169.254.169.254; do '
        '   echo testing $ip:8088; '
        '   curl -s --connect-timeout 2 -o /dev/null -w "  HTTP %{http_code} (%{time_total}s)\\n" http://$ip:8088/ || echo "  failed"; '
        ' done"',
        timeout=60,
    )
    print(out)

    ssh.close()


if __name__ == '__main__':
    main()
