"""
Wire BillionMail behind Easypanel's Traefik so https://mail.weotzi.com proxies to
http://billionmail-core-billionmail-1:8088 with Let's Encrypt SSL.

Steps:
1. Attach billionmail-core container to the `easypanel` overlay network so Traefik
   can resolve and reach it by container name.
2. Drop a dynamic config file at /etc/easypanel/traefik/config/billionmail.yaml.
   Traefik file-watch will pick it up automatically.
3. Verify Traefik can resolve billionmail-core-billionmail-1.
4. Once the user adds DNS, Let's Encrypt will run on first HTTPS request.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from _ssh import connect, run, write_remote_file  # type: ignore

CONTAINER = 'billionmail-core-billionmail-1'
NETWORK = 'easypanel'
DOMAIN = 'bm.weotzi.com'
PORT = 8088

TRAEFIK_DYNAMIC_FILE = '/etc/easypanel/traefik/config/billionmail.yaml'

DYNAMIC_CONFIG = f"""# Managed by scripts/billionmail/configure_traefik.py
# Routes mail.weotzi.com to BillionMail core container via Traefik.
http:
  routers:
    billionmail-https:
      rule: "Host(`{DOMAIN}`)"
      entryPoints:
        - https
      service: billionmail
      tls:
        certResolver: letsencrypt

    billionmail-http:
      rule: "Host(`{DOMAIN}`)"
      entryPoints:
        - http
      service: billionmail
      middlewares:
        - billionmail-https-redirect

  services:
    billionmail:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://{CONTAINER}:{PORT}"

  middlewares:
    billionmail-https-redirect:
      redirectScheme:
        scheme: https
        permanent: true
"""


def main():
    ssh, _ = connect()

    print('=== 1. Attach billionmail-core to easypanel network ===')
    # Always attempt the connect; treat "already attached" as success.
    out2, err, code = run(ssh, f'docker network connect {NETWORK} {CONTAINER}')
    combined = (err or '') + ' ' + (out2 or '')
    if code == 0:
        print(f'Connected {CONTAINER} -> {NETWORK}')
    elif 'already' in combined.lower():
        print(f'{CONTAINER} already on {NETWORK} (idempotent)')
    else:
        print(f'FAILED to connect: {err or out2}')
        ssh.close()
        sys.exit(1)

    out, _, _ = run(
        ssh,
        'docker inspect ' + CONTAINER + ' '
        '--format "{{json .NetworkSettings.Networks}}"',
    )
    print(f'Networks for {CONTAINER}: {out}')

    print('\n=== 2. Write Traefik dynamic config ===')
    write_remote_file(ssh, TRAEFIK_DYNAMIC_FILE, DYNAMIC_CONFIG)
    out, _, _ = run(ssh, f'cat {TRAEFIK_DYNAMIC_FILE}')
    print(f'Written {TRAEFIK_DYNAMIC_FILE}:\n')
    print(out)

    print('\n=== 3. Wait 3s for Traefik to reload, then verify ===')
    run(ssh, 'sleep 3')
    # Find traefik container
    traefik, _, _ = run(ssh, 'docker ps --filter name=traefik --format "{{.ID}}" | head -1')
    if traefik:
        print(f'Traefik container: {traefik}')
        out, _, _ = run(
            ssh,
            f'docker exec {traefik} sh -c "wget -qO- http://localhost:8080/api/http/routers 2>/dev/null | head -200" 2>&1 | head -30',
        )
        print('Traefik routers (api):')
        print(out or '(empty - might be authenticated)')

        print('\nDNS lookup of billionmail-core from inside Traefik:')
        out, _, code = run(
            ssh,
            f'docker exec {traefik} getent hosts {CONTAINER} 2>/dev/null || docker exec {traefik} nslookup {CONTAINER} 2>&1 | tail -5',
        )
        print(out)

    print('\n=== 4. Recent Traefik logs (last 25 lines) ===')
    out, _, _ = run(ssh, f'docker logs --tail 25 {traefik} 2>&1' if traefik else 'echo no traefik container')
    print(out)

    print('\n=== Done ===')
    print(f'Config in place. Once DNS A record for {DOMAIN} -> 69.62.98.207 propagates,')
    print("  - Traefik will fetch a Let's Encrypt cert on first HTTPS request")
    print(f'  - Panel will be at: https://{DOMAIN}/<SafePath from .env>')
    print(f'  - API will be at:   https://{DOMAIN}/api/batch_mail/api/send')

    ssh.close()


if __name__ == '__main__':
    main()
