# -*- coding: utf-8 -*-
"""Ensambla el master "A ustedes" (~70s): conforma clips B&N, end card ámbar, mezcla.
Uso: python build_master.py [all|video|card|audio|mux]
Requiere: clips/clip-<id>.mp4, audio/vo-N.mp3, audio/sfx-*.mp3, audio/music.mp3
"""
import subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
CLIPS = HERE / "clips"
AUDIO = HERE / "audio"
POST = HERE / "post"
POST.mkdir(exist_ok=True)

# TTF convertidos desde los .woff2 de marca (freetype de este ffmpeg no decodifica woff2)
FONTS = "C\\:/dev/weotzi-unified/output/promo-a-ustedes/fonts_ttf"
FRAUNCES = f"{FONTS}/fraunces600.ttf"
INTER = f"{FONTS}/intertight600.ttf"

IVORY = "0xF2EDE4"
AMBER = "0xE8893B"

# Orden y duración de escenas generadas (id de clip -> segundos)
SCENES = [("1", 6), ("2", 7), ("3", 7), ("4a", 5), ("4b", 4),
          ("5a", 5), ("5b", 5), ("6", 8), ("7", 8), ("8", 6)]
GEN_TOTAL = sum(d for _, d in SCENES)   # 61
CARD_DUR = 9.0
TOTAL = GEN_TOTAL + CARD_DUR            # 70


def run(cmd):
    print(">>", " ".join(str(c) for c in cmd)[:160])
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stderr[-3000:])
        sys.exit(1)


def conform_scenes():
    for i, (sid, dur) in enumerate(SCENES):
        src = CLIPS / f"clip-{sid}.mp4"
        out = POST / f"s{i:02d}.mp4"
        if out.exists():
            print(f"skip s{i:02d} (clip-{sid})")
            continue
        if not src.exists():
            print(f"FALTA {src}")
            continue
        vf = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,setsar=1,hue=s=0"
        if sid == "1":
            vf += ",fade=t=in:st=0:d=0.8"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
             "-t", str(dur), "-vf", vf, "-an",
             "-c:v", "libx264", "-preset", "slow", "-crf", "16",
             "-pix_fmt", "yuv420p", str(out)])
        print(f"s{i:02d} (clip-{sid}) ok")


def esc(s):
    return s.replace("Ö", "Ö")


def build_card():
    out = POST / "s99.mp4"
    if out.exists():
        print("skip card")
        return

    def fade_in(t0, d=0.9):
        return f"alpha='if(lt(t\\,{t0})\\,0\\,min(1\\,(t-{t0})/{d}))'"

    texts = [
        # (texto, fuente, size, color, y, t_in)
        ("WE ÖTZI", FRAUNCES, 150, AMBER, "h*0.34-text_h/2", 0.8),
        ("P A R A   Q U I E N E S   V I V E N   E L   A R T E", INTER, 34, IVORY, "h*0.55", 2.4),
        ("E S T E   E S   S U   L U G A R", INTER, 34, IVORY, "h*0.63", 3.6),
        ("Ú N A N S E", INTER, 46, AMBER, "h*0.76", 5.0),
    ]
    dts = []
    for txt, font, size, color, y, t0 in texts:
        dts.append(f"drawtext=fontfile='{font}':text='{txt}':fontsize={size}:fontcolor={color}:"
                   f"x=(w-text_w)/2:y={y}:{fade_in(t0)}")
    vf = ",".join(dts) + f",fade=t=out:st={CARD_DUR-0.8}:d=0.8"
    run(["ffmpeg", "-y", "-v", "error",
         "-f", "lavfi", "-i", f"color=c=0x07080B:s=1920x1080:r=24:d={CARD_DUR}",
         "-vf", vf, "-an",
         "-c:v", "libx264", "-preset", "slow", "-crf", "16",
         "-pix_fmt", "yuv420p", str(out)])
    print("card ok")


def concat_video():
    lst = POST / "list.txt"
    names = [f"s{i:02d}.mp4" for i in range(len(SCENES))] + ["s99.mp4"]
    missing = [n for n in names if not (POST / n).exists()]
    if missing:
        # el demuxer concat trunca en silencio si falta un archivo (exit 0)
        print("concat ABORTADO, faltan:", ", ".join(missing))
        sys.exit(1)
    lst.write_text("".join(f"file '{n}'\n" for n in names), encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", str(POST / "video-full.mp4")])
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(POST / "video-full.mp4")],
                       capture_output=True, text=True)
    dur = float(r.stdout.strip())
    assert abs(dur - TOTAL) < 0.5, f"duración concat {dur} != {TOTAL}"
    print(f"concat ok ({dur:.2f}s)")


# ---- Audio ----
VO_AT = {1: 1.2, 2: 6.8, 3: 13.6, 4: 20.4, 5: 28.9, 6: 40.8, 7: 47.6, 8: 52.6, 9: 62.0}
MUSIC_BASE = 0.30

SFX_AT = [  # (archivo, t_abs, volumen)
    ("sfx-pencil.mp3", 0.8, 0.35),
    ("sfx-breath.mp3", 39.3, 0.40),
    ("sfx-machine.mp3", 41.8, 0.25),
    ("sfx-machine.mp3", 47.2, 0.18),
    ("sfx-machine-final.mp3", 64.5, 0.35),
]


def build_audio():
    # cola de piano: nota final de la música, reubicada tras el silencio dirigido
    tail = AUDIO / "piano-tail.wav"
    if not tail.exists():
        run(["ffmpeg", "-y", "-v", "error", "-i", str(AUDIO / "music.mp3"),
             "-ss", "59.5", "-t", "6.5", "-af", "afade=t=in:st=0:d=0.6", str(tail)])
    inputs = ["-i", str(AUDIO / "music.mp3")]
    filters = []
    labels = []
    # cama musical: entra suave, muere a silencio antes de "A ustedes" (~60.8)
    filters.append(
        "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,"
        f"volume={MUSIC_BASE},afade=t=in:st=0:d=1.5,afade=t=out:st=59.3:d=1.5,"
        "atrim=0:61[m]"
    )
    labels.append("[m]")
    idx = 1
    for n in range(1, 10):
        inputs += ["-i", str(AUDIO / f"vo-{n}.mp3")]
        d = int(VO_AT[n] * 1000)
        filters.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={d}|{d}[v{n}]")
        labels.append(f"[v{n}]")
        idx += 1
    for fname, at, vol in SFX_AT:
        inputs += ["-i", str(AUDIO / fname)]
        d = int(at * 1000)
        filters.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol},adelay={d}|{d}[x{idx}]")
        labels.append(f"[x{idx}]")
        idx += 1
    # nota final de piano fundida con la máquina
    inputs += ["-i", str(tail)]
    d = int(64.8 * 1000)
    filters.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.5,adelay={d}|{d}[pt]")
    labels.append("[pt]")
    mix = "".join(labels) + (f"amix=inputs={len(labels)}:normalize=0[premix];"
                             f"[premix]loudnorm=I=-14:TP=-1.2:LRA=9,atrim=0:{TOTAL},"
                             f"afade=t=out:st={TOTAL-0.8}:d=0.8[out]")
    fc = ";".join(filters) + ";" + mix
    (POST / "audio-filter.txt").write_text(fc, encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error"] + inputs +
        ["-filter_complex_script", str(POST / "audio-filter.txt"),
         "-map", "[out]", "-c:a", "aac", "-b:a", "256k", str(POST / "audio-full.m4a")])
    print("audio ok")


def mux():
    out = HERE / "weotzi-a-ustedes.mp4"
    run(["ffmpeg", "-y", "-v", "error",
         "-i", str(POST / "video-full.mp4"), "-i", str(POST / "audio-full.m4a"),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy",
         "-movflags", "+faststart", str(out)])
    print("master:", out)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "video"):
        conform_scenes()
        build_card()
        concat_video()
    elif step == "card":
        build_card()
    if step in ("all", "audio"):
        build_audio()
    if step in ("all", "mux"):
        mux()
