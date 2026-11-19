#!/usr/bin/env bash
# Instala o actualiza el deployer de beta en el VPS. Idempotente. Correr como root
# desde una copia de deployments/vps/ (no hace falta el repo entero).
#   sudo bash install.sh            # instala y deja el timer APAGADO
#   sudo bash install.sh --enable   # además enciende el timer
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "Correr como root" >&2; exit 1; }
for bin in python3 git curl docker; do command -v "$bin" >/dev/null || { echo "Falta $bin" >&2; exit 1; }; done

install -d -m 0755 /opt/weotzi-deployer
install -m 0755 "$here/beta-deployer.py" /opt/weotzi-deployer/beta-deployer.py
install -d -m 0700 /var/lib/weotzi-deployer
install -d -m 0700 /etc/weotzi
install -m 0644 "$here/weotzi-beta-deployer.service" /etc/systemd/system/weotzi-beta-deployer.service
install -m 0644 "$here/weotzi-beta-deployer.timer" /etc/systemd/system/weotzi-beta-deployer.timer
systemctl daemon-reload

if [ -f /etc/weotzi/beta.env ]; then
  # El contenedor corre como «node» (uid/gid 1000): lo lee por el grupo, pero como el
  # dueño es root no puede reescribirlo ni cambiarle permisos aunque el bind sea rw.
  chown 0:1000 /etc/weotzi/beta.env
  chmod 0440 /etc/weotzi/beta.env
else
  echo "Aviso: falta /etc/weotzi/beta.env (ver README, «Variables»)." >&2
fi

if [ "${1:-}" = "--enable" ]; then
  systemctl enable --now weotzi-beta-deployer.timer
  echo "Timer encendido."
else
  echo "Instalado. El timer queda apagado; encenderlo con: systemctl enable --now weotzi-beta-deployer.timer"
fi
