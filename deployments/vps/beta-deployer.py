#!/usr/bin/env python3
"""We Ötzi · deployer de beta en el VPS (Easypanel / Docker Swarm).

Reemplaza al poller de Hostinger (scripts/release/poll.cjs + deploy.cjs) con las
mismas garantías:
  * solo publica la punta de main;
  * solo si el job «Tests and release policy» de «Verify delivery» pasó para ese
    commit exacto (push a main);
  * solo la imagen que construyó «Publish beta image» (workflow_run desde main) para
    ese commit: el digest se lee de la anotación «beta-image-digest» de ese job en
    la API pública de GitHub y se despliega por digest (las etiquetas de GHCR son
    mutables y no se usan como prueba);
  * comprueba /api/release a través de Traefik local (commit == sha) y, si falla,
    vuelve sola a la versión anterior y bloquea ese commit hasta un «resume»;
  * cada pasada corrige la deriva: si el servicio corre otra imagen que la
    registrada (p. ej. un «Deploy» desde el panel con «:main»), vuelve a fijarla;
  * guarda estado e historial en /var/lib/weotzi-deployer.

Sin dependencias: Python 3 de la distro, git, curl y docker. Sin tokens: el repo,
la API de GitHub usada y la imagen son públicos. Las variables secretas viven en
/etc/weotzi/beta.env (montado en el contenedor); este script no lo lee.

Uso:
  beta-deployer.py poll                 # lo corre el timer de systemd cada minuto
  beta-deployer.py status               # no toma el lock
  beta-deployer.py adopt                # fija por digest la imagen que corre hoy y la registra
  beta-deployer.py deploy --sha <sha>   # publica un commit verificado (si no es la punta, bloquea la punta)
  beta-deployer.py rollback [--sha <sha>]   # vuelve a la anterior (o a <sha>) y bloquea la punta
  beta-deployer.py resume               # quita el bloqueo
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("WEOTZI_REPO", "WeOtzi/betav1")
IMAGE = os.environ.get("WEOTZI_IMAGE", "ghcr.io/weotzi/betav1")
SERVICE = os.environ.get("WEOTZI_SERVICE", "we-otzi-app_beta")
PUBLIC_HOST = os.environ.get("WEOTZI_PUBLIC_HOST", "beta.weotzi.com")
STATE_DIR = os.environ.get("WEOTZI_STATE_DIR", "/var/lib/weotzi-deployer")
LOG_FILE = os.environ.get("WEOTZI_LOG_FILE", "/var/log/weotzi-deployer.log")
WORKFLOW_FILE = "verify.yml"
WORKFLOW_NAME = "Verify delivery"
GATE_JOB = "Tests and release policy"
PUBLISH_FILE = "publish-image.yml"
PUBLISH_JOB = "Build and push beta image"
DIGEST_ANNOTATION = "beta-image-digest"
KEEP_IMAGES = 5
HEALTH_ATTEMPTS = 40
HEALTH_DELAY = 3
STOP_GRACE = "25s"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


class DeployError(Exception):
    pass


class Pending(Exception):
    """Todavía no se puede publicar (CI o imagen en curso); se reintenta con espera creciente."""


# ── utilidades ────────────────────────────────────────────────────────────
def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(moment=None):
    return (moment or now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(message):
    line = f"{iso()} {message}"
    print(line, flush=True)
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1024 * 1024:
            os.replace(LOG_FILE, LOG_FILE + ".1")
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def run(args, timeout=300, check=True):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise DeployError(f"{os.path.basename(args[0])} {args[1] if len(args) > 1 else ''} excedió {timeout}s")
    if check and result.returncode != 0:
        raise DeployError(f"{os.path.basename(args[0])} {args[1] if len(args) > 1 else ''} falló ({result.returncode}): {last_line(result)}")
    return result


def last_line(result):
    lines = (result.stderr or result.stdout or "").strip().splitlines()
    return lines[-1][:300] if lines else ""


def state_path(name):
    return os.path.join(STATE_DIR, name)


def load_state():
    path = state_path("state.json")
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (ValueError, OSError) as error:
        aside = f"{path}.corrupt-{now().strftime('%Y%m%dT%H%M%SZ')}"
        try:
            os.replace(path, aside)
        except OSError:
            pass
        log(f"ERROR state.json ilegible ({error}); apartado como {os.path.basename(aside)} y sigo con estado vacío")
        return {}


def save_state(state):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    temporary = state_path("state.json.new")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, state_path("state.json"))


def try_save_state(state):
    try:
        save_state(state)
        return True
    except OSError as error:
        log(f"ERROR no pude guardar el estado: {error}")
        return False


def history(entry):
    try:
        os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
        with open(state_path("history.jsonl"), "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": iso(), **entry}) + "\n")
    except OSError as error:
        log(f"AVISO no pude escribir el historial: {error}")


def digest_of(reference):
    if reference and "@sha256:" in reference:
        return reference.split("@", 1)[1]
    return None


# ── GitHub (público, sin token) ───────────────────────────────────────────
def main_tip():
    output = run(["git", "ls-remote", f"https://github.com/{REPO}.git", "refs/heads/main"], timeout=60).stdout.strip()
    sha = output.split("\t", 1)[0] if output else ""
    if not SHA_RE.match(sha):
        raise DeployError("No pude leer la punta de main")
    return sha


def github_json(url):
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "weotzi-beta-deployer",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in (403, 429):
            raise Pending(f"GitHub limitó las consultas ({error.code})")
        raise DeployError(f"GitHub respondió {error.code}")
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise Pending(f"GitHub no respondió: {error}")


def latest_run(workflow_file, sha, event, name=None):
    runs = github_json(
        f"https://api.github.com/repos/{REPO}/actions/workflows/{workflow_file}/runs"
        f"?head_sha={sha}&event={event}&per_page=20"
    ).get("workflow_runs", [])
    runs = [r for r in runs if r.get("head_sha") == sha and r.get("head_branch") == "main"
            and r.get("event") == event and str(r.get("path", "")).endswith(workflow_file)
            and (name is None or r.get("name") == name)]
    if not runs:
        return None
    return max(runs, key=lambda r: (r.get("created_at", ""), r.get("run_attempt", 1), r.get("id", 0)))


def successful_job(run_info, job_name, sha):
    jobs = github_json(run_info["jobs_url"] + "?per_page=100").get("jobs", [])
    for job in jobs:
        if job.get("name") == job_name and job.get("head_sha") == sha:
            if job.get("status") != "completed":
                raise Pending(f"«{job_name}» sigue en curso")
            return job if job.get("conclusion") == "success" else None
    return None


def ci_passed(sha):
    """True solo si «Tests and release policy» pasó para un push de ese commit a main."""
    verify = latest_run(WORKFLOW_FILE, sha, "push", WORKFLOW_NAME)
    if not verify:
        return False
    try:
        return successful_job(verify, GATE_JOB, sha) is not None
    except Pending:
        return False


def published_digest(sha):
    """Digest de la imagen que construyó «Publish beta image» (desde main) para ese commit."""
    publish = latest_run(PUBLISH_FILE, sha, "workflow_run")
    if not publish:
        raise Pending("«Publish beta image» aún no corrió para este commit")
    if publish.get("status") != "completed":
        raise Pending("«Publish beta image» sigue en curso")
    if publish.get("conclusion") != "success":
        raise DeployError(f"«Publish beta image» terminó en {publish.get('conclusion')} para {sha[:12]}")
    job = successful_job(publish, PUBLISH_JOB, sha)
    if not job:
        raise DeployError(f"«{PUBLISH_JOB}» no pasó para {sha[:12]}")
    annotations = github_json(f"https://api.github.com/repos/{REPO}/check-runs/{job['id']}/annotations?per_page=50")
    for note in annotations if isinstance(annotations, list) else []:
        message = str(note.get("message", "")).strip()
        if note.get("title") == DIGEST_ANNOTATION and DIGEST_RE.match(message):
            return message
    raise DeployError(f"«{PUBLISH_JOB}» no dejó la anotación {DIGEST_ANNOTATION} para {sha[:12]}")


# ── Docker ────────────────────────────────────────────────────────────────
def service_exists():
    return run(["docker", "service", "inspect", SERVICE], check=False, timeout=30).returncode == 0


def service_image():
    return run(["docker", "service", "inspect", SERVICE, "--format",
                "{{.Spec.TaskTemplate.ContainerSpec.Image}}"], timeout=30).stdout.strip()


def pull_digest(sha, digest):
    """Descarga IMAGE@digest y comprueba que la imagen declare ese commit. Devuelve la referencia."""
    reference = f"{IMAGE}@{digest}"
    result = run(["docker", "pull", "--quiet", reference], check=False, timeout=600)
    if result.returncode != 0:
        raise Pending(f"docker pull {digest[:19]} falló: {last_line(result)}")
    labels = json.loads(run(["docker", "image", "inspect", reference, "--format",
                             "{{json .Config.Labels}}"], timeout=30).stdout or "{}") or {}
    if labels.get("org.opencontainers.image.revision") != sha:
        raise DeployError(f"La imagen {digest[:19]} no declara el commit {sha[:12]}")
    return reference


def update_service(image_ref):
    """Pide a Swarm el cambio de imagen. Devuelve True si la spec quedó con ese digest."""
    try:
        run(["docker", "service", "update", "--quiet", "--detach=false",
             "--image", image_ref,
             "--update-order", "start-first",
             "--update-failure-action", "rollback",
             "--update-monitor", "40s",
             "--rollback-order", "start-first",
             "--stop-grace-period", STOP_GRACE,
             SERVICE], timeout=600, check=False)
    except DeployError as error:
        log(f"aviso: {error}; lo decide el chequeo de salud")
    try:
        return digest_of(service_image()) == digest_of(image_ref) or digest_of(image_ref) is None
    except DeployError:
        return False


def release_info():
    """Pide /api/release a través de Traefik local, con el Host público (sirve antes y después del DNS)."""
    try:
        result = run([
            "curl", "-sS", "-k", "-L", "--max-time", "10",
            "--resolve", f"{PUBLIC_HOST}:443:127.0.0.1",
            "--resolve", f"{PUBLIC_HOST}:80:127.0.0.1",
            f"http://{PUBLIC_HOST}/api/release",
        ], check=False, timeout=20)
    except DeployError:
        return None
    if result.returncode != 0:
        return None
    try:
        info = json.loads(result.stdout)
        return info if isinstance(info, dict) else None
    except ValueError:
        return None


def healthy(sha):
    for _ in range(HEALTH_ATTEMPTS):
        info = release_info()
        if info and info.get("ok") is True and info.get("commit") == sha:
            return info
        time.sleep(HEALTH_DELAY)
    return None


def prune_images(keep_refs):
    """Borra imágenes «sha-*» viejas, conservando las últimas KEEP_IMAGES y las indicadas."""
    try:
        listing = run(["docker", "image", "ls", IMAGE, "--format", "{{.ID}}\t{{.Tag}}\t{{.CreatedAt}}"],
                      timeout=60, check=False).stdout.strip().splitlines()
        keep_ids = set()
        for reference in keep_refs:
            if reference:
                out = run(["docker", "image", "inspect", reference, "--format", "{{.ID}}"], check=False, timeout=30)
                if out.returncode == 0:
                    keep_ids.add(out.stdout.strip().split(":")[-1][:12])
        rows = [line.split("\t") for line in listing if line.count("\t") == 2]
        rows = sorted((r for r in rows if r[1].startswith("sha-")), key=lambda r: r[2], reverse=True)
        for index, (image_id, tag, _) in enumerate(rows):
            if index < KEEP_IMAGES or any(image_id.startswith(k) or k.startswith(image_id) for k in keep_ids):
                continue
            run(["docker", "image", "rm", f"{IMAGE}:{tag}"], check=False, timeout=60)
    except DeployError as error:
        log(f"aviso: no pude podar imágenes: {error}")


# ── acciones ──────────────────────────────────────────────────────────────
def schedule_retry(state, sha, why):
    retry = state.get("retry") or {}
    attempts = retry.get("attempts", 0) + 1 if retry.get("sha") == sha else 1
    delay = min(60 * (2 ** ((attempts - 1) // 3)), 900)
    state["retry"] = {"sha": sha, "attempts": attempts, "until": iso(now() + dt.timedelta(seconds=delay)), "why": why}
    try_save_state(state)
    if retry.get("why") != why:
        log(f"{sha[:12]}: {why}; reintento en {delay}s")


def activate(state, sha, image_ref, reason):
    previous = state.get("current")
    log(f"publicando {sha[:12]} ({reason})")
    if not update_service(image_ref):
        # Swarm no aceptó el cambio: el servicio sigue como estaba. Se reintenta, no se bloquea.
        schedule_retry(state, sha, "docker service update no aplicó la imagen")
        return False
    info = healthy(sha)
    if info:
        if previous and previous.get("sha") != sha:
            state["previous"] = previous
        state["current"] = {"sha": sha, "image": image_ref, "version": info.get("version"), "activatedAt": iso()}
        state.pop("retry", None)
        try_save_state(state)
        history({"event": "deployed", "sha": sha, "version": info.get("version"), "reason": reason})
        log(f"OK {sha[:12]} versión {info.get('version')}")
        prune_images([image_ref, (state.get("previous") or {}).get("image")])
        return True
    # Primero bloquear (para no reintentar el commit malo), después volver atrás.
    state["blocked"] = {"sha": sha, "at": iso(), "reason": "falló el chequeo de salud"}
    try_save_state(state)
    log(f"ERROR {sha[:12]} no respondió /api/release con ese commit; vuelvo a la versión anterior")
    history({"event": "failed", "sha": sha, "reason": reason})
    if previous and digest_of(previous.get("image")):
        update_service(previous["image"])
        if healthy(previous["sha"]):
            log(f"rollback OK a {previous['sha'][:12]}")
        else:
            log("ERROR el rollback tampoco respondió; revisar el servicio en Easypanel")
    else:
        log("ERROR no hay versión anterior registrada por digest; revisar el servicio en Easypanel")
    return False


def correct_drift(state):
    """Si el servicio corre otra imagen que la registrada, vuelve a fijarla. Devuelve True si actuó."""
    current = state.get("current") or {}
    want = digest_of(current.get("image"))
    if not want:
        return False
    running = service_image()
    if digest_of(running) == want:
        return False
    log(f"deriva: el servicio corre {running} y lo registrado es {current['sha'][:12]}; lo vuelvo a fijar")
    history({"event": "drift", "running": running, "expected": current["image"]})
    update_service(current["image"])
    if not healthy(current["sha"]):
        log("ERROR la versión registrada no respondió tras corregir la deriva")
    return True


def poll(_args):
    if not service_exists():
        log(f"el servicio {SERVICE} no existe todavía; nada que hacer")
        return 0
    state = load_state()
    if not (state.get("current") or {}).get("image"):
        log("sin versión registrada: correr «adopt» antes de encender el timer")
        return 0
    if correct_drift(state):
        return 0
    sha = main_tip()
    if (state.get("current") or {}).get("sha") == sha or (state.get("blocked") or {}).get("sha") == sha:
        return 0
    retry = state.get("retry") or {}
    if retry.get("sha") == sha and retry.get("until", "") > iso():
        return 0
    try:
        if not ci_passed(sha):
            raise Pending("el gate de CI no figura aprobado todavía")
        digest = published_digest(sha)
        image_ref = pull_digest(sha, digest)
    except (Pending, DeployError) as wait:
        # Con espera creciente (hasta 15 min) para no gastar las 60 consultas/h sin token.
        schedule_retry(state, sha, str(wait))
        return 0
    if main_tip() != sha:
        log(f"main avanzó mientras verificaba {sha[:12]}; se toma el siguiente en la próxima pasada")
        return 0
    return 0 if activate(state, sha, image_ref, "poll") else 1


def verified_reference(sha):
    if not SHA_RE.match(sha or ""):
        raise DeployError("--sha necesita el SHA completo en minúsculas")
    try:
        if not ci_passed(sha):
            raise DeployError("Ese commit no tiene aprobado «Tests and release policy»")
        return pull_digest(sha, published_digest(sha))
    except Pending as wait:
        raise DeployError(str(wait))


def deploy(args):
    sha = args.sha
    image_ref = verified_reference(sha)
    tip = main_tip()
    state = load_state()
    if not activate(state, sha, image_ref, "manual"):
        return 1
    if tip != sha:
        state["blocked"] = {"sha": tip, "at": iso(), "reason": f"deploy manual de {sha[:12]}"}
        try_save_state(state)
        log(f"la punta {tip[:12]} queda bloqueada hasta «resume» (se publicó {sha[:12]} a mano)")
    return 0


def rollback(args):
    state = load_state()
    current = state.get("current") or {}
    from_previous = not args.sha
    if args.sha:
        target = {"sha": args.sha, "image": verified_reference(args.sha)}
    else:
        target = state.get("previous")
    if not target or not digest_of(target.get("image")):
        raise DeployError("No hay versión anterior registrada por digest a la cual volver")
    try:
        blocked_sha = main_tip()
    except DeployError:
        blocked_sha = current.get("sha")  # sin GitHub, al menos bloquear lo que corre ahora
    log(f"rollback manual a {target['sha'][:12]}")
    update_service(target["image"])
    info = healthy(target["sha"])
    if not info:
        raise DeployError("La versión de rollback no respondió /api/release")
    if blocked_sha:
        state["blocked"] = {"sha": blocked_sha, "at": iso(), "reason": "rollback manual"}
    if from_previous or (state.get("previous") or {}).get("sha") == target["sha"]:
        state["previous"] = None  # no volver a ofrecer la versión de la que se huyó
    state["current"] = {"sha": target["sha"], "image": target["image"], "version": info.get("version"), "activatedAt": iso()}
    try_save_state(state)
    history({"event": "rollback", "sha": target["sha"], "from": current.get("sha"), "blocked": blocked_sha})
    log(f"rollback OK; {(blocked_sha or '?')[:12]} queda bloqueado hasta «resume»")
    return 0


def resume(_args):
    state = load_state()
    blocked = state.pop("blocked", None)
    state.pop("retry", None)
    save_state(state)
    history({"event": "resume", "unblocked": (blocked or {}).get("sha")})
    log("bloqueo quitado" if blocked else "no había bloqueo")
    return 0


def adopt(_args):
    if not service_exists():
        raise DeployError(f"El servicio {SERVICE} no existe")
    info = release_info()
    sha = str((info or {}).get("commit") or "")
    if not SHA_RE.match(sha):
        raise DeployError("El servicio no responde /api/release con un commit")
    image_ref = verified_reference(sha)
    if not update_service(image_ref):
        raise DeployError("No pude fijar el servicio por digest")
    info = healthy(sha)
    if not info:
        raise DeployError("La imagen adoptada no respondió /api/release")
    state = load_state()
    state["current"] = {"sha": sha, "image": image_ref, "version": info.get("version"), "activatedAt": iso()}
    save_state(state)
    history({"event": "adopted", "sha": sha, "version": info.get("version")})
    log(f"adoptado {sha[:12]} versión {info.get('version')} ({image_ref.split('@')[1][:19]})")
    return 0


def status(_args):
    exists = service_exists()
    print(json.dumps({
        "service": SERVICE,
        "serviceExists": exists,
        "serviceImage": service_image() if exists else None,
        "release": release_info() if exists else None,
        "state": load_state(),
    }, indent=2))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Deployer de beta (We Ötzi) en el VPS")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("poll").set_defaults(func=poll)
    sub.add_parser("status").set_defaults(func=status)
    sub.add_parser("adopt").set_defaults(func=adopt)
    sub.add_parser("resume").set_defaults(func=resume)
    p_deploy = sub.add_parser("deploy")
    p_deploy.add_argument("--sha", required=True)
    p_deploy.set_defaults(func=deploy)
    p_rollback = sub.add_parser("rollback")
    p_rollback.add_argument("--sha")
    p_rollback.set_defaults(func=rollback)
    args = parser.parse_args(argv)

    if args.command == "status":
        try:
            return status(args)
        except DeployError as error:
            print(f"ERROR {error}", file=sys.stderr)
            return 1

    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    with open(state_path("lock"), "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.command == "poll":
                return 0
            print("Otro deploy está en curso", file=sys.stderr)
            return 2
        try:
            return args.func(args)
        except (DeployError, Pending) as error:
            log(f"ERROR {error}")
            return 1
        except Exception as error:  # noqa: BLE001 — nunca dejar el timer muerto sin rastro
            log(f"ERROR inesperado {type(error).__name__}: {error}")
            return 1


if __name__ == "__main__":
    sys.exit(main())
