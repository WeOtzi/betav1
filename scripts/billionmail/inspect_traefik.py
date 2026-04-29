"""
Inspect Traefik (Easypanel) configuration to plan how to add a route for mail.weotzi.com.
We need to understand:
- What providers Traefik uses (Docker labels, file-based, swarm)
- Where the dynamic config lives (if file-based)
- What entrypoints exist (web, websecure)
- What network Traefik is on (so BillionMail can reach Traefik or vice versa)
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from _ssh import connect, run  # type: ignore


def main():
    ssh, _ = connect()

    print('=== Traefik container details ===')
    out, _, _ = run(ssh, 'docker ps --filter "name=traefik" --format "{{.Names}} -> {{.Image}}"')
    print(out)

    name, _, _ = run(ssh, 'docker ps --filter "name=traefik" --format "{{.ID}}" | head -1')
    if not name:
        print('No Traefik container found.')
        ssh.close()
        return

    print('\n=== Traefik command line / args ===')
    out, _, _ = run(ssh, f'docker inspect {name} -f "{{{{json .Args}}}}" | python3 -m json.tool')
    print(out)

    print('\n=== Traefik mounted volumes ===')
    out, _, _ = run(ssh, f'docker inspect {name} -f "{{{{range .Mounts}}}}{{{{.Source}}}} -> {{{{.Destination}}}}\\n{{{{end}}}}"')
    print(out)

    print('\n=== Traefik environment ===')
    out, _, _ = run(ssh, f'docker inspect {name} -f "{{{{range .Config.Env}}}}{{{{.}}}}\\n{{{{end}}}}"')
    print(out)

    print('\n=== Traefik networks ===')
    out, _, _ = run(ssh, f'docker inspect {name} -f "{{{{json .NetworkSettings.Networks}}}}" | python3 -m json.tool')
    print(out)

    print('\n=== Easypanel data directory ===')
    out, _, _ = run(ssh, 'ls -la /etc/easypanel/ 2>/dev/null || ls -la /var/lib/easypanel/ 2>/dev/null || find / -maxdepth 3 -type d -name "easypanel*" 2>/dev/null | head -10')
    print(out)

    print('\n=== Likely traefik dynamic configuration files ===')
    out, _, _ = run(ssh, 'find / -maxdepth 5 -type f \\( -name "traefik*.yml" -o -name "traefik*.yaml" -o -name "traefik*.toml" \\) 2>/dev/null | head')
    print(out)

    print('\n=== Files in any traefik dynamic dir ===')
    out, _, _ = run(ssh, 'find / -maxdepth 6 -type d -name "dynamic*" 2>/dev/null | head')
    print(out)

    ssh.close()


if __name__ == '__main__':
    main()
