# -*- coding: utf-8 -*-
"""Ensambla el master de 60s: conforma clips, overlays tipográficos, mezcla de audio.
Uso: python build_master.py
Requiere: clips/clip-N.mp4 (9), audio/vo-N.mp3 (9), audio/sfx-*.mp3, audio/music.mp3
"""
import io, json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
CLIPS = HERE / "clips"
AUDIO = HERE / "audio"
POST = HERE / "post"
POST.mkdir(exist_ok=True)

FONTS = "C\\:/dev/weotzi-unified/landing/shared/fonts"
FRAUNCES = f"{FONTS}/Fraunces-600-latin-ext.woff2"
INTER = f"{FONTS}/InterTight-600-latin-ext.woff2"

IVORY = "0xF2EDE4"
OBSIDIAN = "0x07080B"
AMBER = "0xE8893B"

DUR = {1: 5, 2: 7, 3: 6, 4: 9, 5: 8, 6: 8, 7: 7, 8: 7, 9: 3}
START = {}
_t = 0
for n in range(1, 10):
    START[n] = _t
    _t += DUR[n]
assert _t == 60

def fade(t0, dur=0.5):
    return f"if(lt(t\\,{t0})\\,0\\,min(1\\,(t-{t0})/{dur}))"

def dt(text, t0, t1, color, size=58, y="h*0.80", font=FRAUNCES, alpha_fade=0.5, x="(w-text_w)/2"):
    a = f"alpha='{fade(t0, alpha_fade)}'"
    en = f"enable='between(t,{t0},{t1})'"
    return (f"drawtext=fontfile='{font}':text='{text}':fontsize={size}:fontcolor={color}:"
            f"x={x}:y={y}:{a}:{en}")

# Overlays por escena (tiempos locales a la escena)
OVERLAYS = {
    1: [dt("UNA IDEA.", 2.8, 5, OBSIDIAN, y="h*0.32")],
    2: [dt("ESTILO. UBICACIÓN.", 4.0, 7, OBSIDIAN)],
    3: [dt("EL TRABAJO HABLA.", 3.2, 6, OBSIDIAN)],
    4: [dt("COTIZAR.", 0.8, 3.1, OBSIDIAN),
        dt("CONVERSAR.", 3.4, 6.1, OBSIDIAN),
        dt("AGENDAR.", 6.4, 9, OBSIDIAN)],
    5: [dt("JOB BOARD. GUEST SPOTS.", 1.2, 8, IVORY)],
    6: [dt("SEDES. EQUIPO. IDENTIDAD.", 4.6, 8, IVORY)],
    7: [dt("EXPERIENCIA REAL.", 1.2, 7, IVORY, size=44, y="h*0.80", x="w*0.055"),
        dt("RESEÑA VERIFICADA.", 4.9, 7, IVORY, size=44, y="h*0.80+56", x="w*0.055")],
    8: [dt("CLIENTES · TATUADORES · ESTUDIOS", 1.2, 7, OBSIDIAN, size=48)],
    9: [dt("WE ÖTZI", 0.9, 3, IVORY, size=120, y="h*0.46", alpha_fade=0.6),
        dt("S U M A T E   A   L A   B E T A", 1.4, 3, AMBER, size=30, y="h*0.62", font=INTER, alpha_fade=0.6)],
}

def run(cmd):
    print(">>", " ".join(str(c) for c in cmd)[:180])
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stderr[-3000:])
        sys.exit(1)

def conform_scenes():
    for n in range(1, 10):
        src = CLIPS / f"clip-{n}.mp4"
        out = POST / f"s{n}.mp4"
        if out.exists():
            print(f"skip s{n}")
            continue
        if not src.exists():
            print(f"FALTA {src}")
            continue
        vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,setsar=1," + ",".join(OVERLAYS[n])
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
             "-t", str(DUR[n]), "-vf", vf, "-an",
             "-c:v", "libx264", "-preset", "slow", "-crf", "16",
             "-pix_fmt", "yuv420p", str(out)])
        print(f"s{n} ok")

def concat_video():
    lst = POST / "list.txt"
    lst.write_text("".join(f"file 's{n}.mp4'\n" for n in range(1, 10)), encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", str(POST / "video-60s.mp4")])
    print("concat ok")

# ---- Audio ----
VO_AT = {1: 1.2, 2: 6.0, 3: 12.2, 4: 18.5, 5: 27.5, 6: 35.5, 7: 43.5, 8: 50.3, 9: 55.5}
VO_GAIN = 1.0
SFX_GAIN = 0.40
MUSIC_BASE = 0.32

def build_audio():
    sfx_spec = json.load(io.open(HERE / "sfx.json", encoding="utf-8"))
    inputs = ["-i", str(AUDIO / "music.mp3")]
    filters = []
    labels = []
    idx = 1
    # música: cama con dip a silencio 57.15-57.65 y regreso suave
    filters.append(
        "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,"
        f"volume='{MUSIC_BASE}*if(between(t,57.15,57.65),0,if(gt(t,57.65),0.55,1))':eval=frame,"
        "afade=t=in:st=0:d=1.5,afade=t=out:st=58.6:d=1.4[m]"
    )
    labels.append("[m]")
    for n in range(1, 10):
        inputs += ["-i", str(AUDIO / f"vo-{n}.mp3")]
        d = int(VO_AT[n] * 1000)
        filters.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={VO_GAIN},adelay={d}|{d}[v{n}]")
        labels.append(f"[v{n}]")
        idx += 1
    for item in sfx_spec:
        sid = item["id"]
        scene = int(sid.split("-")[0])
        at = START[scene] + float(item["at"])
        if at >= 59.5:
            continue
        inputs += ["-i", str(AUDIO / f"sfx-{sid}.mp3")]
        d = int(at * 1000)
        filters.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={SFX_GAIN},adelay={d}|{d}[x{idx}]")
        labels.append(f"[x{idx}]")
        idx += 1
    mix = "".join(labels) + f"amix=inputs={len(labels)}:normalize=0[premix];[premix]loudnorm=I=-14:TP=-1.2:LRA=9,atrim=0:60[out]"
    fc = ";".join(filters) + ";" + mix
    (POST / "audio-filter.txt").write_text(fc, encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error"] + inputs +
        ["-filter_complex_script", str(POST / "audio-filter.txt"),
         "-map", "[out]", "-c:a", "aac", "-b:a", "256k", str(POST / "audio-60s.m4a")])
    print("audio ok")

def mux():
    out = HERE / "weotzi-todo-conecta.mp4"
    run(["ffmpeg", "-y", "-v", "error",
         "-i", str(POST / "video-60s.mp4"), "-i", str(POST / "audio-60s.m4a"),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
         "-movflags", "+faststart", str(out)])
    print("master:", out)

if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "video"):
        conform_scenes()
        concat_video()
    if step in ("all", "audio"):
        build_audio()
    if step in ("all", "mux"):
        mux()
