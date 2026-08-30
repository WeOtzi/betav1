# -*- coding: utf-8 -*-
"""Genera VO (eleven_v3), SFX y musica con la API de ElevenLabs.
Uso: python gen_audio.py vo | music | sfx <sfx.json>
La API key se lee de la config de la extension Claude Desktop (nunca se imprime).
"""
import io, json, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).parent
AUDIO = HERE / "audio"
AUDIO.mkdir(exist_ok=True)

SETTINGS = Path(r"C:\Users\Isaí\AppData\Roaming\Claude\Claude Extensions Settings\ant.dir.gh.elevenlabs.elevenlabs-player.json")
API_KEY = json.load(io.open(SETTINGS, encoding="utf-8"))["userConfig"]["api_key"]

VOICE_ID = "IRHApOXLvnW57QJPQH2P"

VO_LINES = [
    (1, "[warm] [softly] Todo empieza con una idea."),
    (2, "[warm] Y con encontrar la mano capaz de hacerla real."),
    (3, "[confident] Explorá artistas por estilo y ubicación. [warm] Conocelos a través de su trabajo."),
    (4, "[confident] Cuando algo conecte, pedí una cotización. Conversá. Elegí el momento."),
    (5, "[confident] Si tatuás, encontrá oportunidades y nuevos lugares para crear."),
    (6, "[warm] Si tenés un estudio, mostrá tus sedes, tu equipo y lo que construyen juntos."),
    (7, "[softly] Y después de cada sesión, una experiencia real construye confianza."),
    (8, "[confident] Clientes. Tatuadores. Estudios. Cada parte, conectada."),
    (9, "[warm] We Ötzi. Todo el mundo del tatuaje. En un solo lugar."),
]


def post(url, body, out_path, extra_headers=None):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("xi-api-key", API_KEY)
    req.add_header("Content-Type", "application/json")
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            audio = r.read()
        Path(out_path).write_bytes(audio)
        print(f"OK {out_path} ({len(audio)//1024} KB)")
        return True
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {out_path}: {e.read().decode('utf-8', 'replace')[:400]}")
        return False


def gen_vo():
    ok = 0
    for n, text in VO_LINES:
        out = AUDIO / f"vo-{n}.mp3"
        if out.exists():
            print(f"skip {out} (existe)")
            ok += 1
            continue
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128"
        body = {
            "text": text,
            "model_id": "eleven_v3",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        if post(url, body, out):
            ok += 1
        time.sleep(1)
    print(f"VO: {ok}/{len(VO_LINES)}")


def gen_music():
    out = AUDIO / "music.mp3"
    if out.exists():
        print("skip music (existe)")
        return
    url = "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128"
    body = {
        "prompt": (
            "Minimal warm electronic brand-film bed, 60 seconds. Soft analog synth pulse, "
            "clean subtle percussion ticks, warm sub bass, understated. Builds gradually and "
            "confidently but never becomes epic or cinematic-trailer. Precise, elegant, modern, "
            "product-film feel. Instrumental only, no vocals. Ends cleanly with a soft resolve."
        ),
        "music_length_ms": 60000,
    }
    post(url, body, out)


def gen_sfx(spec_path):
    spec = json.load(io.open(spec_path, encoding="utf-8"))
    ok = 0
    for item in spec:
        out = AUDIO / f"sfx-{item['id']}.mp3"
        if out.exists():
            print(f"skip {out} (existe)")
            ok += 1
            continue
        url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"
        body = {"text": item["prompt"], "duration_seconds": max(0.5, min(22, item["dur"]))}
        if post(url, body, out):
            ok += 1
        time.sleep(1)
    print(f"SFX: {ok}/{len(spec)}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "vo"
    if mode == "vo":
        gen_vo()
    elif mode == "music":
        gen_music()
    elif mode == "sfx":
        gen_sfx(sys.argv[2])
    else:
        print("modo desconocido")
