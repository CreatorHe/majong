# Runtime artwork compression — 2026-10-22

62 shipped raster images decreased from **35,046,641 bytes to 9,510,143 bytes**: a saving of **25,536,498 bytes (72.9%)**. Existing runtime filenames and artwork contents are retained. Original PNG artwork remains in the sibling `art/` source directory.

| Group | Files | Before | After | Encoding |
|---|---:|---:|---:|---|
| Relics | 21 | 14,253,592 B | 619,828 B | 432×432, WebP quality 84 |
| Page / board / shop backgrounds | 3 | 4,947,356 B | 244,004 B | Width 1280, WebP quality 82 |
| V4 subjects and backgrounds | 24 | 11,588,472 B | 6,693,962 B | Subjects 1152×768 quality 86; backgrounds width 1280 quality 82 |
| Cinematic illustrations | 7 | 2,634,730 B | 1,508,116 B | Width 1280, WebP quality 82 |
| Effekseer PNG textures | 7 | 1,622,491 B | 444,233 B | Same dimensions and identical decoded pixels |

The largest relic presentation is 144 CSS pixels; the new 432-pixel assets cover 3× density. The four core relics (wheel, stone, reserve, river) total **136,128 bytes**, down from 3,796,368 bytes. All 34 tile SVGs remain vectors, totalling 357,563 bytes; tile glyphs and paths were not rasterized or simplified.

Verification covered decoding and SHA-256 for all 62 outputs, exact alpha-plane agreement after resizing for all 47 images with alpha, and exact pixel agreement for all 7 PNG textures. A second optimizer run made no further image changes. Side-by-side inspection covered the four core relics, cauldron, board, phoenix, lotus, forest crane and normal map: fine edges and subject details remain legible at game display size. The atlas comparison is in `art-compression-comparison.webp`; per-file sizes, sources, dimensions and hashes are in `art-compression-2026-10-22.json`. Integrated loading and actual game rendering are verified by the main task.

The seven legacy V3 videos and posters (6,333,958 bytes) were retained because older modules still refer to them. The current `CinematicSettlementPlayer` delegates to the V4 burst player; unused legacy assets need not be included in the new background preload list. No video, tile, font, vendor JS, WASM or game logic was changed in this compression work.

To reproduce, use Python with Pillow and WebP support:

```sh
python3 scripts/optimize-art.py
```

The optimizer runs outside the normal application build. It uses source PNG masters and refuses to perform an additional lossy generation if a source is missing. Existing outputs whose audit hashes still match are skipped. No large backup copy is created.
