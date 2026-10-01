"""Turn the downloaded prefabpartner.nl media into the files cs_prefab_website ships.

Run it again whenever the download or the inventory changes; it is idempotent and it is the
only thing allowed to write ``addons/cs_prefab_website/static/src/{media,video,pdf}`` and
``addons/cs_prefab_website/data/media_index.json``. Editing those by hand does not hold --
the next run overwrites it. Corrections belong here.

    python scripts/import_site_media.py --assets <download dir> [--check]
    python scripts/import_site_media.py --reencode <filename>
    python scripts/import_site_media.py --reposter <filename>

``--check`` writes nothing and exits non-zero when the shipped tree does not match what this
script would produce, which is what the repository test asserts.

``--reencode`` re-derives ONE shipped video through its current profile, starting from the
shipped file rather than from the download -- for the machine that has the module but not the
60 MB of originals. It stamps the record ``"generation": 2`` so that shortcut is visible in
the index instead of being invisible in a byte count. See ``reencode_video``.

``--reposter`` redraws only the still frame of one shipped video, at the size it is shown,
and leaves the film untouched. Use it when the POSTER policy changed and the video profile did
not: re-encoding a content video for no reason costs a generation of picture for nothing.

Three decisions are encoded here, each measured rather than assumed:

* **Photographs are capped at 1600 px on the long edge.** The site's own measurements show
  project photos rendered at 262x186 and the hotspot photo at 312x312, against masters of
  2048x1536 and 720x720 -- so the masters are 4-8x oversized in each direction. 1600 px is
  the largest size that is still useful (a full-bleed hero on a 1440 px screen at 1x, or a
  lightbox), and Odoo serves every smaller variant from ``/web/image/<id>/<w>x<h>`` on demand.
  Shipping the 2048 px original instead would put ~10 MB into the release archive to serve
  pixels nobody ever sees.
* **Banner strips, logos, posters, icons and the favicon are shipped untouched.** They are
  already small, and a 2560x250 full-bleed strip resampled to 1600 px is visibly softer.
* **The 13.4 MB animated GIF and the five raw MP4s are re-encoded.** The GIF alone is 22.7%
  of the whole 60 MB site payload for a logo shown at 348x348. Both keep their animation --
  the customer asked for that explicitly -- they simply stop costing a data bundle.
* **The hero background loop gets its own, smaller profile.** Four of the five videos are
  content a visitor presses play on; one is weather behind a headline, under a scrim, on the
  page everybody opens. See ``HERO_PROFILE``.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "docs/website/content-inventory.json"
MODULE = ROOT / "addons/cs_prefab_website"
IMAGE_DIR = MODULE / "static/src/media"
VIDEO_DIR = MODULE / "static/src/video"
PDF_DIR = MODULE / "static/src/pdf"
INDEX = MODULE / "data/media_index.json"

# A photograph never needs more than this on its long edge on this site.
MAX_LONG_EDGE = 1600
# Wider than this and the image is a full-bleed decorative strip, not a photograph.
STRIP_ASPECT = 5.0
# Below this it is already a logo, a poster or an icon; resampling only loses detail.
SMALL_ENOUGH = 1000
# A photograph heavier than this is badly compressed rather than large: prefab-partner-
# referentie.jpg is 776 kB for 1000x750 px, four Project-2026-*.jpg are 400-555 kB for
# 1333x1000. Those are inside the pixel cap and still over the site's weight budget, so the
# rule has to be about bytes as well as pixels.
MAX_IMAGE_BYTES = 250 * 1024
# The animated brand logo is displayed at 348 px on the live site and is capped at 360 px here
# (see .o_prefab_brandmark in the stylesheet). 696 px -- twice that, for a retina screen -- cost
# 640 kB for a 250-frame loop, which is half of /over-ons on a phone. Measured at the same
# quality: 696 px = 640 kB, 480 px = 460 kB, 480 px at half the frame rate = 215 kB. 480 is
# still 1,33x the size it is shown at, and the frames are a slow turn of a flat logo, where
# 12,5 per second is not visible as stepping.
ANIMATION_EDGE = 480
# The same loop at half its frame rate. The source is 250 frames at 40 ms; this halves the
# frame count and doubles the interval, so the animation lasts exactly as long and turns at
# exactly the same speed.
ANIMATION_FPS = 12.5

# Images that carry no information and must ship with alt="" so a screen reader skips them.
# Each is a page-title strip or a CSS background, never a photograph of the work.
DECORATIVE = {
    "header-sub.jpg", "header-home-2.jpg", "header-home-3.jpg",
    "prefabpartner-icon-03.svg", "prefabpartner-icon-04.svg", "prefabpartner-icon-05.svg",
}

# The eight images that carried no alt text in WordPress, written by looking at each of them
# once it had a place on a page. Dutch, factual, no marketing -- an alt text says what is in
# the picture, not why it is good.
#
# The three video-*.jpg are the overlay stills WordPress showed over the three project films.
# The films themselves keep a frame from their own footage as their poster (a 368 px overlay
# stretched to 420 is visibly soft), so these three describe what the overlay showed; the same
# sentences are what the three <video> elements carry as their accessible name, because it is
# the same scene from the same film.
WRITTEN = {
    # De klant beschrijft zijn eigen logo in het bericht "Het verhaal achter ons logo": een huis
    # met dak, en de letter P voor Prefab Partner, in zwart en oranje. Die beschrijving is hier
    # aangehouden in plaats van een eigen lezing van de vormen.
    "logo-2.gif": ("Het beeldmerk van Prefab Partner: een oranje letter P met een puntdak, "
                   "staand in de zwarte omtrek van een huis. Het beeldmerk draait langzaam om "
                   "zijn as."),
    "Project-2026-1.jpg": ("Een aanbouw met verticale houten latten in een achtertuin, met "
                           "daarachter een kleiner bijgebouw in dezelfde latten."),
    "Project-2026-2.jpg": ("De aanbouw met houten latten vanuit de tuin gezien, met de woning "
                           "links en een houten overkapping rechts."),
    "Project-2026-3.jpg": ("De afgeronde aanbouw van bovenaf: een plat dak met de randen nog "
                           "afgeplakt, en een gevel van verticale houten latten."),
    "Project-2026-4.jpg": ("Een prefab element staat vastgesjord op een dieplader in de straat, "
                           "ingepakt in zwarte folie en met houten schoren erin."),
    "video-1.jpg": ("Een ingepakt prefab element hangt aan de kraan boven de achtertuin, voor "
                    "een rij bakstenen woningen."),
    "video-2.jpg": "De afgewerkte gevel van verticale houten latten, van dichtbij.",
    "video-3.jpg": ("Een ingepakt prefab element hangt aan de kettingen van de kraan boven een "
                    "tuinmuur met druivenrank."),
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def encode_image(source, target, long_edge):
    """Resample to ``long_edge``, keeping the aspect ratio and the source format.

    Quality steps down until the file fits the per-file weight budget, because the pixel cap
    alone does not get there: Project-aanbouw-denhaag-03.webp is 1800x1350 and still 511 kB
    after being resampled to 1600 px. The floor is 68 -- below that the compression starts to
    show on brickwork and window frames, which is the entire subject of these photographs.
    """
    with Image.open(source) as image:
        image.load()
        width, height = image.size
        scale = min(1.0, long_edge / max(width, height))
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        webp = target.suffix.lower() == ".webp"
        converted = image.convert("RGBA" if webp and image.mode in ("RGBA", "LA", "P") else "RGB")
        resized = converted.resize(size, Image.LANCZOS)
        for quality in (82, 76, 70, 68):
            if webp:
                resized.save(target, "WEBP", quality=quality, method=6)
            else:
                resized.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
            if target.stat().st_size <= MAX_IMAGE_BYTES:
                break
    return size


def run_ffmpeg(arguments, label):
    completed = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *arguments],
                               capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError(f"{label} failed: {completed.stderr.strip()[:400]}")


def encode_animation(source, target):
    """The 13.4 MB GIF becomes an animated WebP that an <img> plays exactly the same way."""
    run_ffmpeg(["-i", str(source),
                "-vf", f"scale={ANIMATION_EDGE}:-1:flags=lanczos,fps={ANIMATION_FPS}",
                "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "62",
                "-compression_level", "6", "-loop", "0", "-an", str(target)],
               f"animated webp for {source.name}")


def encode_animation_still(source, target):
    """The first frame of the animation, as a still image of its own.

    This is not a nicety: an animated image cannot be stopped by CSS -- ``animation``,
    ``transition`` and ``prefers-reduced-motion`` all address the box, never the frames inside
    the file. The only mechanism that reaches it is to not download the animation at all, and
    ``<picture><source media="(prefers-reduced-motion: no-preference)">`` is what does that. It
    needs a second file to fall back to, and this is it -- about 3 kB, because the frame is a
    flat logo on a flat ground.
    """
    run_ffmpeg(["-i", str(source),
                "-vf", f"scale={ANIMATION_EDGE}:-1:flags=lanczos",
                "-frames:v", "1", "-c:v", "libwebp", "-lossless", "0", "-q:v", "80",
                str(target)],
               f"still frame for {source.name}")


def has_audio(source):
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=codec_name", "-of", "csv=p=0", str(source)], capture_output=True, text=True)
    return bool(completed.stdout.strip())


# The one video that is nobody's content and everybody's first impression.
#
# `video-prefab-partner.mp4` is the HERO BACKGROUND: muted, looping, cropped by
# `object-fit: cover`, and covered by an ink scrim that runs from 84% at the left edge to 26%
# at the right. Nothing in it is ever read; it is weather and movement behind a headline. The
# other four videos are content -- a visitor presses play on them, with sound, at full size --
# and they keep the 720p profile.
#
# Treating both as the same thing cost 1.066 kB on the page every single visitor opens. The
# homepage weighed 1.646 kB at first load against the audit's own budget of 1.500 kB, and this
# one file was two thirds of the gap.
#
# Measured, at 19,7 seconds, on the shipped 1280x720 master:
#
#   1280 / crf 30 / 1400k   1.066 kB   (the shared profile, what shipped until today)
#    960 / crf 31 /  400k     531 kB
#    960 / crf 32 /  300k     473 kB   <- this
#    960 / crf 34 /  300k     395 kB   (visibly soft on the scaffolding, even under the scrim)
#    854 / crf 34 /  300k     322 kB
#
# 960 at crf 32 is where the scaffold poles still read as poles in a frame-by-frame comparison
# against the master, and it is under the audit's 500 kB per-file ceiling -- which no video on
# this site met before. It is displayed at `cover` on a band of at most 760 px high, so 960 px
# wide is still more pixels than any viewport asks for at 1x.
HERO_BACKGROUND = "video-prefab-partner.mp4"
HERO_PROFILE = {"width": 960, "crf": "32", "maxrate": "300k", "bufsize": "600k", "poster": 1280}

# The poster is the ONLY part of a <video> that `preload="none"` does not hold back: the
# browser fetches it the moment the element is laid out, lazily for nothing, because there is
# no `loading="lazy"` for a poster. Four posters at 1280 px were 601 kB, and three of them sit
# in a three-column row on /projecten where they are drawn at about 380 px.
#
# So the poster is sized to where it is SHOWN, not to the video it belongs to:
#   full-bleed hero    1280 px  (it is the first paint of the homepage and carries the <h1>)
#   a video in a row    800 px  (2,1x the 380 px it is drawn at -- enough for a 2x screen)
#
# Measured on Project-2026-03: 1280/q6 = 157 kB, 960/q7 = 94 kB, 800/q7 = 74 kB.
POSTER_EDGE_INLINE = 800
POSTER_QUALITY = "7"


def encode_video(source, mp4, poster, profile=None):
    """720p H.264 with a hard bitrate ceiling, plus a poster frame.

    Two things measured here, both of which contradict the obvious approach:

    * **Quality-targeted encoding makes these files BIGGER.** The sources are already
      1280x720 at 2.4-3.7 Mbps and were encoded at a lower quality than ``-crf 26`` implies,
      so CRF 26 spends bits faithfully reproducing the source's own compression artefacts.
      Measured: Project-2026-03 went from 4.66 MB to 7.82 MB. A ``-maxrate`` ceiling is what
      actually bounds the result, and the caller keeps whichever file is smaller -- an
      encoder setting is a hypothesis, the file size on disk is the measurement.
    * **WebM was dropped.** A VP9 sibling was produced and compared: it was larger than the
      H.264 in three of the four videos (Project-2026-01 5.33 MB vs 4.33 MB) and would in any
      case double the archive for a format H.264 already covers everywhere.

    Audio is preserved when the source has it -- the three /projecten/ videos play with
    controls, so silently stripping their sound is a content change, not an optimisation.
    """
    profile = profile or {"width": 1280, "crf": "30", "maxrate": "1400k", "bufsize": "2800k"}
    scale = f"scale={profile['width']}:-2:flags=lanczos"
    # A background loop has no sound to lose; forcing -an there keeps the two profiles from
    # differing in more than the three numbers they are meant to differ in.
    audio = (["-c:a", "aac", "-b:a", "96k"]
             if has_audio(source) and profile["width"] >= 1280 else ["-an"])
    run_ffmpeg(["-i", str(source), "-vf", scale,
                "-c:v", "libx264", "-preset", "slow", "-crf", profile["crf"],
                "-maxrate", profile["maxrate"], "-bufsize", profile["bufsize"],
                "-profile:v", "high",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", *audio, str(mp4)],
               f"mp4 for {source.name}")
    encode_poster(source, poster, profile.get("poster", POSTER_EDGE_INLINE))


def encode_poster(source, poster, edge):
    """The still frame a <video> shows before anybody presses play.

    Without one the first paint of the hero is flat grey (#666666 on the live site) for the
    whole time the video is downloading. With one, and with `preload="none"`, the poster is
    the ONLY thing that travels until a visitor asks for the film -- so its size is the size
    of the promise, and it is worth getting right. See POSTER_EDGE_INLINE.
    """
    run_ffmpeg(["-i", str(source), "-vf", f"scale={edge}:-2:flags=lanczos", "-frames:v", "1",
                "-q:v", POSTER_QUALITY, str(poster)], f"poster for {source.name}")


def plan(entry):
    """What ships for one inventory entry, and why."""
    name = entry["filename"]
    kind = entry["media_kind"]
    suffix = Path(name).suffix.lower()
    if kind == "pdf":
        return {"kind": "pdf", "action": "copy", "reason": "gelinkt vanaf de site; blijft bereikbaar op zijn eigen adres"}
    if kind == "video":
        return {"kind": "video", "action": "transcode", "reason": "720p H.264 + WebM + posterframe"}
    if suffix == ".svg":
        return {"kind": "image", "action": "copy", "reason": "vector; schaalt zelf"}
    if suffix == ".gif":
        return {"kind": "image", "action": "animate", "reason": "geanimeerd logo; hercodeerd naar animated WebP"}
    width, height = entry.get("pixel_width") or 0, entry.get("pixel_height") or 0
    if not width or not height:
        return {"kind": "image", "action": "copy", "reason": "onbekende afmeting; ongewijzigd overgenomen"}
    if max(width, height) / max(1, min(width, height)) >= STRIP_ASPECT:
        return {"kind": "image", "action": "copy", "reason": "paginabrede sierstrook; verkleinen maakt hem zichtbaar zachter"}
    if max(width, height) > MAX_LONG_EDGE:
        return {"kind": "image", "action": "resize",
                "reason": f"teruggebracht naar {MAX_LONG_EDGE} px op de lange zijde"}
    if entry["bytes"] > MAX_IMAGE_BYTES:
        return {"kind": "image", "action": "recompress",
                "reason": f"afmeting klopt, bestandsgrootte niet ({entry['bytes'] // 1024} kB); "
                          "opnieuw gecomprimeerd op dezelfde afmeting"}
    if max(width, height) <= SMALL_ENOUGH:
        return {"kind": "image", "action": "copy", "reason": "al klein genoeg voor de plek waar hij staat"}
    return {"kind": "image", "action": "copy", "reason": "binnen de bovengrens van 1600 px"}


def alt_for(entry):
    """Alt text carried from WordPress, written here, or an honest record that there is none.

    74 of the 91 files carry the customer's own alt text and it is passed through verbatim.
    Eight carried none at all in WordPress. Those eight were deliberately left ``pending`` for
    one build, because alt text describes an image *in the sentence it sits in* and inventing
    one from "Project-2026-3.jpg" produces a sentence nobody meant. They now sit on a page, so
    they are written -- in ``WRITTEN`` below, by looking at each photograph.

    ``pending`` stays in the vocabulary. The next image the customer adds without a description
    lands there, and the count in the summary is what keeps that from going unnoticed.
    """
    name = entry["filename"]
    if entry["media_kind"] != "image":
        return "", "not_applicable"
    alt = (entry.get("wp_alt_text") or "").strip()
    if name in DECORATIVE:
        return "", "decorative"
    if alt:
        return alt, "wordpress"
    if name in WRITTEN:
        return WRITTEN[name], "written"
    return "", "pending"


def build(assets_dir, check):
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    entries = inventory["assets"]["files"]
    for directory in (IMAGE_DIR, VIDEO_DIR, PDF_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    records = []
    produced = {IMAGE_DIR: set(), VIDEO_DIR: set(), PDF_DIR: set()}
    seen_digests = {}
    for entry in sorted(entries, key=lambda item: item["filename"].lower()):
        source = assets_dir / entry["filename"]
        if not source.is_file():
            raise SystemExit(f"missing download: {source}")
        digest = sha256(source)
        decision = plan(entry)
        alt, alt_source = alt_for(entry)
        record = {
            "filename": entry["filename"],
            "kind": decision["kind"],
            "action": decision["action"],
            "reason": decision["reason"],
            "alt": alt,
            "alt_source": alt_source,
            "used_in": entry["used_in"],
            "original": {"bytes": entry["bytes"], "sha256": digest,
                         "width": entry.get("pixel_width"), "height": entry.get("pixel_height")},
        }
        # Deduplicate on content, not on name: aanbouw-in-5-dagen.jpg and
        # aanbouw-in-5-dagen-1.jpg are the same 27.937 bytes twice.
        if digest in seen_digests:
            record["duplicate_of"] = seen_digests[digest]
            record["shipped"] = None
            records.append(record)
            continue
        seen_digests[digest] = entry["filename"]
        if decision["kind"] == "pdf":
            target = PDF_DIR / entry["filename"]
            if not check:
                shutil.copy2(source, target)
            produced[PDF_DIR].add(target.name)
            record["shipped"] = {"path": f"static/src/pdf/{target.name}"}
        elif decision["kind"] == "video":
            stem = Path(entry["filename"]).stem
            mp4, poster = VIDEO_DIR / f"{stem}.mp4", VIDEO_DIR / f"{stem}-poster.jpg"
            if not check and not (mp4.exists() and poster.exists()):
                candidate = VIDEO_DIR / f"{stem}.candidate.mp4"
                encode_video(source, candidate, poster,
                             HERO_PROFILE if entry["filename"] == HERO_BACKGROUND else None)
                # Keep the smaller file. Re-encoding is a hypothesis; the byte count is the
                # measurement, and it does not always agree.
                if candidate.stat().st_size < source.stat().st_size:
                    candidate.replace(mp4)
                    record["reason"] = "720p H.264 met bitrateplafond + posterframe"
                else:
                    candidate.unlink()
                    shutil.copy2(source, mp4)
                    record["action"] = "copy"
                    record["reason"] = ("hercodering leverde een groter bestand op; "
                                        "het origineel is behouden, met posterframe")
            if entry["filename"] == HERO_BACKGROUND:
                record["reason"] = (
                    f"achtergrondlus van de hero: {HERO_PROFILE['width']}p H.264 met "
                    f"bitrateplafond {HERO_PROFILE['maxrate']}, zonder geluid, plus 720p "
                    "posterframe")
            produced[VIDEO_DIR].update({mp4.name, poster.name})
            record["shipped"] = {"path": f"static/src/video/{mp4.name}",
                                 "poster": f"static/src/video/{poster.name}"}
        elif decision["action"] == "animate":
            stem = Path(entry["filename"]).stem
            target = IMAGE_DIR / f"{stem}.webp"
            still = IMAGE_DIR / f"{stem}-still.webp"
            if not check and not target.exists():
                encode_animation(source, target)
            if not check and not still.exists():
                encode_animation_still(source, still)
            produced[IMAGE_DIR].update({target.name, still.name})
            # `poster` is the same key the videos use, and it means the same thing: the frame
            # that is shown when the moving version is not played. Here it is what a visitor who
            # asked for less motion gets INSTEAD of the animation -- see the <picture> on
            # /over-ons.
            record["shipped"] = {"path": f"static/src/media/{target.name}",
                                 "poster": f"static/src/media/{still.name}"}
        elif decision["action"] in ("resize", "recompress"):
            target = IMAGE_DIR / entry["filename"]
            if not check:
                long_edge = (MAX_LONG_EDGE if decision["action"] == "resize"
                             else max(entry["pixel_width"], entry["pixel_height"]))
                encode_image(source, target, long_edge)
                # Re-compressing is a hypothesis too; keep the smaller file.
                if target.stat().st_size >= entry["bytes"]:
                    shutil.copy2(source, target)
                    record["action"] = "copy"
                    record["reason"] = "opnieuw comprimeren gaf geen winst; origineel behouden"
            produced[IMAGE_DIR].add(target.name)
            record["shipped"] = {"path": f"static/src/media/{target.name}"}
        else:
            target = IMAGE_DIR / entry["filename"]
            if not check:
                shutil.copy2(source, target)
            produced[IMAGE_DIR].add(target.name)
            record["shipped"] = {"path": f"static/src/media/{target.name}"}
        shipped_path = MODULE / record["shipped"]["path"]
        if shipped_path.is_file():
            record["shipped"]["bytes"] = shipped_path.stat().st_size
            if decision["kind"] == "image":
                try:
                    with Image.open(shipped_path) as image:
                        record["shipped"]["width"], record["shipped"]["height"] = image.size
                except Exception:  # noqa: BLE001 - SVG has no raster size
                    pass
            for extra in ("poster",):
                if extra in record["shipped"]:
                    record["shipped"][extra + "_bytes"] = (MODULE / record["shipped"][extra]).stat().st_size
        records.append(record)
    # Anything left over is from an earlier download and must not silently keep shipping.
    stale = []
    for directory, expected in produced.items():
        for path in sorted(directory.iterdir()):
            if path.is_file() and path.name not in expected:
                stale.append(str(path.relative_to(MODULE)))
                if not check:
                    path.unlink()
    document = {
        "generated_by": "scripts/import_site_media.py",
        "source": inventory["assets"]["downloaded_to"],
        "policy": {"max_long_edge": MAX_LONG_EDGE, "strip_aspect": STRIP_ASPECT,
                   "small_enough": SMALL_ENOUGH, "animation_edge": ANIMATION_EDGE},
        "files": records,
    }
    payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if check:
        current = INDEX.read_text(encoding="utf-8") if INDEX.is_file() else ""
        if current != payload or stale:
            print(json.dumps({"ok": False, "stale": stale,
                              "indexMatches": current == payload}, ensure_ascii=False))
            return 1
        print(json.dumps({"ok": True, "files": len(records)}))
        return 0
    INDEX.write_text(payload, encoding="utf-8")
    original = sum(item["original"]["bytes"] for item in records)
    shipped = sum(
        (item["shipped"] or {}).get("bytes", 0)
        + (item["shipped"] or {}).get("poster_bytes", 0)
        for item in records)
    print(json.dumps({
        "files": len(records),
        "duplicates": sum(1 for item in records if item.get("duplicate_of")),
        "originalBytes": original, "shippedBytes": shipped,
        "savedBytes": original - shipped,
        "savedPercent": round(100 * (original - shipped) / original, 1),
        "stale": stale,
        "altPending": [item["filename"] for item in records if item["alt_source"] == "pending"],
    }, ensure_ascii=False, indent=2))
    return 0


def reencode_video(filename, poster_only=False):
    """Re-derive ONE shipped video through its current profile, from the shipped file itself.

    With ``poster_only`` it re-derives only the still frame and leaves the film untouched --
    which is what you want when the POSTER policy changed and the video profile did not, since
    re-encoding a content video for no reason costs a generation of picture for nothing.

    Why this exists, stated plainly so nobody has to guess later. The full run reads the
    original download; that download is not on every machine, and on the machine where the
    hero profile above was introduced it was gone. Re-encoding by hand and then hand-editing
    ``media_index.json`` is exactly the pattern that does not hold -- the next full run
    overwrites both and the reasoning disappears with them. So the correction lives here, in
    the generator, and it is re-runnable.

    What it costs, also plainly: the result is a SECOND-GENERATION encode. It is produced from
    the already-transcoded 1280p file rather than from the master, so it carries one extra
    round of H.264 loss. The record is stamped ``"generation": 2`` for exactly that reason.
    A full ``python scripts/import_site_media.py --assets <download>`` with the shipped video
    deleted first replaces it with a first-generation encode of the SAME profile -- same size
    ceiling, slightly better picture -- and the stamp disappears by itself.
    """
    document = json.loads(INDEX.read_text(encoding="utf-8"))
    record = next((item for item in document["files"] if item["filename"] == filename), None)
    if record is None:
        raise SystemExit(f"{filename} staat niet in {INDEX.name}")
    if record.get("kind") != "video":
        raise SystemExit(f"{filename} is geen video")
    shipped = MODULE / record["shipped"]["path"]
    if not shipped.is_file():
        raise SystemExit(f"{record['shipped']['path']} staat niet op schijf")

    profile = HERO_PROFILE if filename == HERO_BACKGROUND else None
    poster = MODULE / record["shipped"]["poster"]

    if poster_only:
        before = poster.stat().st_size
        encode_poster(shipped, poster, (profile or {}).get("poster", POSTER_EDGE_INLINE))
        record["shipped"]["poster_bytes"] = poster.stat().st_size
        INDEX.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
        print(json.dumps({"file": filename, "poster": record["shipped"]["poster"],
                          "beforeBytes": before,
                          "afterBytes": record["shipped"]["poster_bytes"],
                          "savedBytes": before - record["shipped"]["poster_bytes"]},
                         ensure_ascii=False, indent=2))
        return 0

    before = shipped.stat().st_size
    candidate = shipped.with_suffix(".candidate.mp4")
    encode_video(shipped, candidate, poster, profile)
    # Same rule as the full run: an encoder setting is a hypothesis, the file size on disk is
    # the measurement. A profile that makes the file bigger is not applied.
    if candidate.stat().st_size >= before:
        candidate.unlink()
        raise SystemExit(f"hercodering gaf {candidate.stat().st_size} bytes tegen {before}; niets gewijzigd")
    candidate.replace(shipped)

    record["generation"] = 2
    if profile:
        record["reason"] = (
            f"achtergrondlus van de hero: {profile['width']}p H.264 met bitrateplafond "
            f"{profile['maxrate']}, zonder geluid, plus posterframe van {profile['poster']} px")
    record["shipped"]["bytes"] = shipped.stat().st_size
    record["shipped"]["poster_bytes"] = poster.stat().st_size
    INDEX.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"file": filename, "beforeBytes": before,
                      "afterBytes": record["shipped"]["bytes"],
                      "savedBytes": before - record["shipped"]["bytes"],
                      "generation": 2}, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, required=False)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--reencode", metavar="FILENAME",
                        help="hercodeer één geleverde video door zijn huidige profiel, "
                             "uitgaande van het geleverde bestand in plaats van de download")
    parser.add_argument("--reposter", metavar="FILENAME",
                        help="maak alleen het posterframe van één geleverde video opnieuw, "
                             "op de maat waarop het wordt getoond; de film blijft ongemoeid")
    args = parser.parse_args()
    if args.reposter:
        return reencode_video(args.reposter, poster_only=True)
    if args.reencode:
        return reencode_video(args.reencode)
    assets = args.assets
    if assets is None:
        assets = Path(json.loads(INVENTORY.read_text(encoding="utf-8"))["assets"]["downloaded_to"])
    return build(assets, args.check)


if __name__ == "__main__":
    sys.exit(main())
