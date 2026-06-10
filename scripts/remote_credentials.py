import os
from pathlib import Path


def load_ssh_password():
    for env_name in ("WEOTZI_SSH_PASSWORD", "SSH_PASS"):
        value = os.getenv(env_name)
        if value:
            return value

    credentials_file = Path(__file__).resolve().parents[1] / ".server-credentials"
    if credentials_file.exists():
        for line in credentials_file.read_text(encoding="utf-8").splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "SSH_PASS" and value.strip():
                return value.strip()

    raise RuntimeError(
        "Missing SSH password. Set WEOTZI_SSH_PASSWORD, SSH_PASS, or a local "
        ".server-credentials file with SSH_PASS=..."
    )
