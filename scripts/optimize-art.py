#!/usr/bin/env python3
"""Compress shipped artwork without changing URLs or source masters.

Requires Pillow with WebP support. Run from any directory. WebP outputs are
encoded from PNG masters in ../art; PNG texture optimization is pixel lossless.
The audit hashes make subsequent runs idempotent.
This is a manual asset preparation tool, not part of the application build.
"""
import io
import json
import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT.parent / "art"
AUDIT = ROOT / "docs/art-compression-2026-10-22.json"
POLICY = "webp-relic432-q84-background1280-q82-pose1152-q86-pnglossless-v1"
SELECTED = {"stone-v2", "wheel-v2", "kong_cauldron-v3", "board-v2",
            "phoenix-release", "lotus-release", "forest-release", "Normal01"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_for(path):
    rel = path.relative_to(ROOT / "dist")
    if rel.parts[:2] == ("art", "relics"):
        candidate = MASTERS / "relics" / (path.stem + ".png")
        if path.stem.endswith("-v3"):
            candidate = MASTERS / "settlement/relics" / (path.stem[:-3] + ".png")
        return candidate if candidate.exists() else path
    if rel.parts[:2] == ("art", "backgrounds"):
        candidate = MASTERS / "backgrounds" / (path.stem + ".png")
        return candidate if candidate.exists() else path
    if rel.parts[:2] == ("settlement", "cinematic"):
        candidate = MASTERS / "settlement/cinematic" / (path.stem + ".png")
        return candidate if candidate.exists() else path
    if rel.parts[:3] == ("settlement", "v4", "assets"):
        candidate = MASTERS / "settlement/v4/assets" / (path.stem + ".png")
        if path.stem.endswith("-background"):
            candidate = MASTERS / "settlement/cinematic-v3" / (path.stem.replace("-background", "-empty") + ".png")
        return candidate if candidate.exists() else path
    return path


def flatten(image):
    rgba = image.convert("RGBA")
    bg = Image.new("RGBA", rgba.size, "#183d40")
    return Image.alpha_composite(bg, rgba).convert("RGB")


def settings(path):
    if path.suffix == ".png":
        return None, None
    if "/art/relics/" in path.as_posix():
        return 432, 84
    if path.parent.name == "assets" and not path.stem.endswith("background"):
        return 1152, 86
    return 1280, 82


def main():
    old = json.loads(AUDIT.read_text()) if AUDIT.exists() else {}
    known = {r["path"]: r for r in old.get("files", [])} if old.get("policy") == POLICY else {}
    candidates = sorted((ROOT / "dist/art").rglob("*.webp"))
    candidates += sorted((ROOT / "dist/settlement/cinematic").glob("*.webp"))
    candidates += sorted((ROOT / "dist/settlement/v4/assets").glob("*.webp"))
    candidates += sorted((ROOT / "dist/settlement/v4/fx").rglob("*.png"))
    records, comparisons = [], []
    for path in candidates:
        name = path.relative_to(ROOT).as_posix()
        original = path.read_bytes()
        previous = known.get(name)
        if previous and previous["afterSha256"] == sha(original):
            records.append(previous)
            continue
        source_path = source_for(path)
        if path.suffix == ".webp" and source_path == path:
            raise FileNotFoundError(f"PNG source master missing for {name}; refusing another lossy generation")
        source_bytes = source_path.read_bytes()
        before = Image.open(io.BytesIO(original)); before.load()
        source = Image.open(io.BytesIO(source_bytes)); source.load()
        original_size = list(before.size)
        width, quality = settings(path)
        if width:
            if source.mode not in ("RGB", "RGBA"):
                source = source.convert("RGBA")
            if source.width > width:
                source = source.resize((width, round(source.height * width / source.width)), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        if quality:
            # Lossy colour; WebP's alpha plane is lossless (verified below).
            source.save(encoded, "WEBP", quality=quality, method=6, exact=True)
        else:
            source.save(encoded, "PNG", optimize=True, compress_level=9)
        payload = encoded.getvalue()
        result = Image.open(io.BytesIO(payload)); result.load()
        if result.size != source.size:
            raise ValueError(f"Unexpected dimensions: {name}")
        alpha = "A" in source.getbands()
        if alpha and source.getchannel("A").tobytes() != result.getchannel("A").tobytes():
            raise ValueError(f"Alpha changed during encoding: {name}")
        if not quality and source.tobytes() != result.tobytes():
            raise ValueError(f"PNG pixels changed: {name}")
        selected = len(payload) < len(original)
        if not selected:
            payload, result = original, before
        error = ImageStat.Stat(ImageChops.difference(flatten(source), flatten(result))).rms
        mse = sum(v*v for v in error) / 3
        record = {
            "path": name, "source": str(source_path.relative_to(ROOT.parent)),
            "sourceSha256": sha(source_bytes), "beforeSha256": sha(original),
            "afterSha256": sha(payload), "beforeBytes": len(original), "afterBytes": len(payload),
            "savedBytes": len(original)-len(payload), "beforeDimensions": original_size,
            "afterDimensions": list(result.size), "quality": quality, "alpha": alpha,
            "encodingAlphaLosslessVerified": alpha, "pixelLosslessVerified": not quality,
            "opaqueCompositePsnr": round(10*math.log10(255*255/mse), 2) if mse else None,
            "changed": selected,
        }
        if path.stem in SELECTED:
            comparisons.append((path.stem, before.copy(), result.copy(), record))
        if selected:
            temporary = path.with_suffix(path.suffix + ".optimize-tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)
        records.append(record)
        print(f"{name}: {len(original):,} -> {len(payload):,}", flush=True)
    report = {
        "policy": POLICY, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "encoder": f"Pillow {PILLOW_VERSION}",
        "beforeBytes": sum(r["beforeBytes"] for r in records),
        "afterBytes": sum(r["afterBytes"] for r in records),
        "savedBytes": sum(r["savedBytes"] for r in records),
        "fileCount": len(records), "files": records,
        "notes": ["Source masters retained; existing runtime URLs retained.",
                  "RGBA resizing uses premultiplied alpha; encoded alpha matches resized source exactly.",
                  "34 tile SVGs retained as vectors; no rasterization or lossy path simplification.",
                  "Legacy V3 MP4/poster files retained, because older modules still refer to them.",
                  "No app, cache, build, or API code is changed by this script."],
    }
    groups = {}
    for record in records:
        group = str(Path(record["path"]).parent)
        if "/fx/" in group:
            group = "dist/settlement/v4/fx"
        row = groups.setdefault(group, {"count": 0, "beforeBytes": 0, "afterBytes": 0})
        row["count"] += 1
        row["beforeBytes"] += record["beforeBytes"]
        row["afterBytes"] += record["afterBytes"]
    report["groups"] = groups
    if all(known.get(r["path"], {}).get("afterSha256") == r["afterSha256"] for r in records):
        if "verification" in old:
            report["verification"] = old["verification"]
    AUDIT.parent.mkdir(exist_ok=True)
    AUDIT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if comparisons:
        sheet = Image.new("RGB", (1040, len(comparisons)*325), "#112c2f")
        draw = ImageDraw.Draw(sheet)
        for i, (name, before, after, record) in enumerate(comparisons):
            y = i*325
            draw.text((14, y+8), f"{name}: BEFORE {record['beforeBytes']:,} B / AFTER {record['afterBytes']:,} B", fill="white")
            for x, im in ((12, before), (532, after)):
                im = flatten(im); im.thumbnail((496, 290), Image.Resampling.LANCZOS)
                sheet.paste(im, (x+(496-im.width)//2, y+30+(290-im.height)//2))
        sheet.save(ROOT / "docs/art-compression-comparison.webp", quality=88, method=6)
    print(json.dumps({k:report[k] for k in ("fileCount","beforeBytes","afterBytes","savedBytes")}, indent=2))


if __name__ == "__main__":
    main()
