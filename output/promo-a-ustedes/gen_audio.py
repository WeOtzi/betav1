# -*- coding: utf-8 -*-
"""Genera VO (eleven_v3), musica y SFX con la API de ElevenLabs para "A ustedes".
Uso: python gen_audio.py vo | music | sfx | probe
La API key se lee de la config de la extension Claude Desktop (nunca se imprime).
"""
import io, json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).parent
AUDIO = HERE / "audio"
AUDIO.mkdir(exist_ok=True)

SETTINGS = Path(r"C:\Users\Isaí\AppData\Roaming\Claude\Claude Extensions Settings\ant.dir.gh.elevenlabs.elevenlabs-player.json")
API_KEY = json.load(io.open(SETTINGS, encoding="utf-8"))["userConfig"]["api_key"]

VOICE_ID = "IRHApOXLvnW57QJPQH2P"

VO_LINES = [
    (1, "[softly] Esto es para quienes viven el arte."),
    (2, "[warm] Para las manos rebeldes que convierten ideas en algo que permanece."),
    (3, "[warm] Y para quienes llevan su historia a la vista."),
    (4, "[confident] Curan. Calculan. Gobiernan. Compiten. Trabajan. Componen. Pintan."),
    (5, "[warm] Pero todos llevan algo que merece una forma. [softly] Un manifiesto. Un recuerdo. Una promesa. Una pérdida. Una victoria."),
    (6, "[softly] No buscan el dolor. [confident] Pero se atreven a atravesarlo."),
    (7, "[warm] Y en manos de un artista, lo convierten en creación."),
    (8, "[confident] Esto es para quienes crean. Para quienes confían. Para quienes se niegan a pasar por el mundo sin dejar una marca."),
    (9, "[warm] A ustedes les habla We Ötzi. [softly] El lugar donde el arte encuentra a los suyos. [confident] Únanse."),
]

MUSIC_PROMPT = (
    "Intimate black-and-white documentary brand film score, 66 seconds. Opens with a single "
    "solitary felt piano note and long silences between sparse piano notes. Low cello and double "
    "bass drones enter very slowly, with subtle room tone and soft ambient breath texture. Builds "
    "restrained emotional intensity — never epic, never trailer-like, no percussion. Around the "
    "final ten seconds the music thins out almost to silence, then closes with one last warm "
    "resolving piano note that decays naturally. Instrumental only, no vocals."
)

SFX = [
    ("pencil",  "soft graphite pencil sketching strokes on paper, sketchbook pages turning slowly, intimate close mic, quiet room tone, gentle and real", 5),
    ("breath",  "one deep calm human inhale through the nose and a slow steady exhale, intimate, close-miked, quiet room", 4),
    ("machine", "tattoo machine buzzing softly and steadily, slightly muffled, intimate professional studio ambience, calm", 6),
    ("machine-final", "a tattoo machine buzz that softens and fades away, dissolving into quiet warm silence", 4),
]


def post(url, body, out_path):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("xi-api-key", API_KEY)
    req.add_header("Content-Type", "application/json")
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
    post(url, {"prompt": MUSIC_PROMPT, "music_length_ms": 66000}, out)


def gen_sfx():
    ok = 0
    for sid, prompt, dur in SFX:
        out = AUDIO / f"sfx-{sid}.mp3"
        if out.exists():
            print(f"skip {out} (existe)")
            ok += 1
            continue
        url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"
        if post(url, {"text": prompt, "duration_seconds": max(0.5, min(22, dur))}, out):
            ok += 1
        time.sleep(1)
    print(f"SFX: {ok}/{len(SFX)}")


def probe():
    for f in sorted(AUDIO.glob("*.mp3")):
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "csv=p=0", str(f)], capture_output=True, text=True)
        print(f"{f.name}: {r.stdout.strip()}s")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "vo"
    {"vo": gen_vo, "music": gen_music, "sfx": gen_sfx, "probe": probe}[mode]()
