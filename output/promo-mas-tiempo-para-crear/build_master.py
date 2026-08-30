# -*- coding: utf-8 -*-
"""Ensambla el comercial We Ötzi — Más tiempo para crear (82 s)."""

from pathlib import Path
import subprocess
import sys


HERE = Path(__file__).parent
CLIPS = HERE / "clips"
UI = HERE / "ui"
AUDIO = HERE / "audio"
POST = HERE / "post"
POST.mkdir(exist_ok=True)

TOTAL = 82.0
FPS = 24

SCENES = [
    ("video", CLIPS / "source-a-1.mp4", 6.0, "mono"),
    ("still", UI / "01-agenda.png", 6.0, "light"),
    ("still", UI / "02-cotizacion.png", 7.0, "dark"),
    ("video", CLIPS / "source-a-2.mp4", 7.0, "mono"),
    ("video", CLIPS / "travel-guest-spot.mp4", 15.0, "travel"),
    ("still", UI / "03-guest-spot.png", 6.0, "light"),
    ("still", UI / "04-perfil.png", 6.0, "dark"),
    ("video", CLIPS / "source-a-6.mp4", 8.0, "mono"),
    ("video", CLIPS / "source-a-7.mp4", 7.0, "mono"),
    ("video", CLIPS / "source-a-8.mp4", 6.0, "mono"),
    ("still", UI / "05-end-1.png", 2.5, "end"),
    ("still", UI / "06-end-2.png", 3.0, "end"),
    ("still", UI / "07-end-3.png", 2.5, "end"),
]


def run(cmd):
    print(">>", " ".join(str(c) for c in cmd)[:220])
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        print(result.stderr[-5000:])
        raise SystemExit(result.returncode)


def conform_video(src, out, dur, look, first=False):
    if look == "travel":
        common = (
            f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps={FPS},setsar=1,"
            "eq=saturation=0.56:contrast=1.05:brightness=-0.015,colorbalance=rs=-0.02:bs=-0.03"
        )
        # Omite 7–10 s: el modelo anticipó el rótulo legible de la sede equivocada.
        # Los 12 s restantes se ralentizan suavemente para conservar el arco de 15 s.
        fc = (
            "[0:v]trim=start=0:end=7,setpts=PTS-STARTPTS[v0];"
            "[0:v]trim=start=10:end=15,setpts=PTS-STARTPTS[v1];"
            f"[v0][v1]concat=n=2:v=1:a=0,setpts={15 / 12:.9f}*PTS,{common}[v]"
        )
        run([
            "ffmpeg", "-y", "-v", "error", "-i", str(src), "-t", str(dur),
            "-filter_complex", fc, "-map", "[v]", "-an", "-c:v", "libx264",
            "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", str(out),
        ])
        return

    vf = [
        "scale=1920:1080:force_original_aspect_ratio=increase",
        "crop=1920:1080",
        f"fps={FPS}",
        "setsar=1",
    ]
    if look == "mono":
        vf += ["eq=contrast=1.03:brightness=-0.005"]
    if first:
        vf += ["fade=t=in:st=0:d=0.8"]
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(src), "-t", str(dur),
        "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "slow",
        "-crf", "16", "-pix_fmt", "yuv420p", str(out),
    ])


def conform_still(src, out, dur, look):
    frames = round(dur * FPS)
    fade_out = max(0, dur - 0.28)
    zoom = (
        "scale=1920:1080,"
        f"zoompan=z='min(zoom+0.00010,1.018)':x='iw/2-(iw/zoom/2)':"
        f"y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps={FPS},"
        "setsar=1"
    )
    if look == "end":
        zoom += f",fade=t=in:st=0:d=0.32,fade=t=out:st={fade_out}:d=0.28"
    run([
        "ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(src),
        "-t", str(dur), "-vf", zoom, "-an", "-c:v", "libx264", "-preset", "slow",
        "-crf", "16", "-pix_fmt", "yuv420p", str(out),
    ])


def build_video():
    outputs = []
    for idx, (kind, src, dur, look) in enumerate(SCENES):
        if not src.exists():
            raise FileNotFoundError(src)
        out = POST / f"scene-{idx:02d}.mp4"
        outputs.append(out)
        if kind == "video":
            conform_video(src, out, dur, look, first=(idx == 0))
        else:
            conform_still(src, out, dur, look)
        print(f"scene {idx:02d} ok")

    listing = POST / "concat.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in outputs), encoding="utf-8")
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
        "-c", "copy", str(POST / "video-82s.mp4"),
    ])


def build_audio():
    music = AUDIO / "music.m4a"
    voice = AUDIO / "voiceover.wav"
    travel = CLIPS / "travel-guest-spot.mp4"
    pencil = HERE.parent / "promo-a-ustedes" / "audio" / "sfx-pencil.mp3"
    machine = HERE.parent / "promo-a-ustedes" / "audio" / "sfx-machine.mp3"
    breath = HERE.parent / "promo-a-ustedes" / "audio" / "sfx-breath.mp3"
    machine_final = HERE.parent / "promo-a-ustedes" / "audio" / "sfx-machine-final.mp3"

    fc = ";".join([
        "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,atempo=0.926829,volume=0.30,afade=t=in:st=0:d=1.5,afade=t=out:st=79.5:d=2.5[m]",
        "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.00,adelay=1100|1100[v]",
        "[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:15,volume=0.20,adelay=26000|26000[t]",
        "[3:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.26,adelay=300|300[p1]",
        "[4:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.20,adelay=53200|53200[ma]",
        "[5:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.18,adelay=52800|52800[b]",
        "[6:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.24,adelay=61000|61000[mf]",
        "[m][v][t][p1][ma][b][mf]amix=inputs=7:normalize=0:dropout_transition=0,"
        f"loudnorm=I=-14:TP=-1.2:LRA=9,apad=pad_dur={TOTAL},atrim=0:{TOTAL}[out]",
    ])
    run([
        "ffmpeg", "-y", "-v", "error",
        "-i", str(music), "-i", str(voice), "-i", str(travel),
        "-i", str(pencil), "-i", str(machine), "-i", str(breath), "-i", str(machine_final),
        "-filter_complex", fc, "-map", "[out]", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
        str(POST / "audio-82s.m4a"),
    ])


def mux():
    master = HERE / "weotzi-mas-tiempo-para-crear.mp4"
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(POST / "video-82s.mp4"),
        "-i", str(POST / "audio-82s.m4a"), "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", str(master),
    ])
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(master), "-c:v", "libx264",
        "-preset", "medium", "-crf", "22", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", str(HERE / "weotzi-mas-tiempo-para-crear-web.mp4"),
    ])
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(master),
        "-vf", "fps=1/8.2,scale=480:270,tile=5x2", "-frames:v", "1",
        str(POST / "contact-sheet-final.png"),
    ])
    print("MASTER:", master)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "video"):
        build_video()
    if step in ("all", "audio"):
        build_audio()
    if step in ("all", "mux"):
        mux()
