# V4 production integration

Source: `art/settlement/v4` library and burst delivery. The game imports this copy through `settlement/cinematic-player.js`; old `motion-v3` videos are no longer referenced by the production player. The existing public facade remains intact.

- Legal hands use a 5.4-second real-time Pixi/WebGL/Effekseer theme and frozen-ledger burst. Script dependencies and the selected theme load on demand. Loading is visible and skip is immediate. One 8-second wall-clock deadline covers all decorative initialization and theme loading; expiry shows the frozen final result and completes with fallback. Cancelled/late renderer results cannot mount again and are disposed. Failed art loading keeps the ledger and authoritative result usable.
- Invalid hands stay on `SettlementPlayer`'s non-celebrating text branch and say “诈胡”. No exported image/video with baked-in old terminology is used.
- The adapter reads only engine result fields. `hand.tiles` contains the final hand; separately frozen `hand.heldTiles` supplies retained-tile event identities. No score, growth, payment or pass/fail result is recomputed here.
- V4 mappings require current catalogue `enabled` support. Preview-only entries, including pure nine gates, cannot select a production theme. Actual pattern name/classification supplies the title/seal.
- Speed, reduced motion, mute, skip, replay, cancellation and disposal retain the host API. Audio is shared with the false-hand branch and disposed only by the facade. Delayed frames apply every text update once and coalesce sound.
- The production copy adds grouping, retained-tile rows, full frozen ledger details, large-number fitting, tier-sensitive emphasis and existing relic image aliases. No changes were made to the art source.

## Runtime assets

The 21 transparent poses for seven enabled families and three empty backgrounds were converted to WebP at quality 92 without resizing. Decoded alpha channels and dimensions were checked against all 24 originals. Total image payload: **11,588,472 bytes**, compared with **61,024,254 bytes** of source PNGs. RGB is lossy-compressed; original PNGs remain under `art/settlement`. Gate/scroll backgrounds and the brush WOFF2 reuse existing product assets. Whale-only preview art is excluded because every whale scene is unavailable in current rules. No MP4, GIF, preview UI or exported scene library is included.

Pixi and filters licenses remain under `vendor/pixi`; Effekseer runtime license is under `vendor/effekseer`; sample effect licenses remain under `fx`. The existing font license remains in `../cinematic/FONT-LICENSE.txt`.

The focused existing `tests/settlement-adapter.test.mjs` covers frozen totals, actual engine results, invalid-hand outcomes, held references, loading skip, replay and cleanup. Real browser/mobile and audible playback acceptance remains a separate host check.
