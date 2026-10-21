// Structural rules only. Tile supply and future player actions are deliberately not solved here.
export const faceValue = tile => typeof tile === 'number' ? tile : tile.face;
export const suit = tile => faceValue(tile) < 27 ? Math.floor(faceValue(tile) / 9) : 3;
export const rank = tile => faceValue(tile) < 27 ? faceValue(tile) % 9 + 1 : 0;
export function groupType(group) {
  const a = group.map(faceValue).sort((x, y) => x - y);
  if (a.length === 2 && a[0] === a[1]) return 'pair';
  if (a.length === 4 && a.every(t => t === a[0])) return 'kong';
  if (a.length !== 3) return null;
  if (a[0] === a[2]) return 'pung';
  if (suit(a[0]) < 3 && suit(a[0]) === suit(a[2]) && a[1] === a[0] + 1 && a[2] === a[0] + 2) return 'chow';
  return null;
}
export const structuralCount = s => s.formed.length - s.kongs.length;
const countsOf = tiles => { const counts = Array(34).fill(0); for (const t of tiles) counts[faceValue(t)]++; return counts; };
const ORPHANS = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
// Each suit receives one different 147 / 258 / 369 sequence.
const KNITTED = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]
  .map(order => order.flatMap((offset, suitIndex) => [0,3,6].map(n => suitIndex * 9 + offset + n)));
const allFaces = counts => counts.flatMap((n, face) => Array(n).fill(face));
const isMcr = mode => mode === 'mcr' || mode === 'guobiao';

function canCoverOrphans(counts) {
  return counts.every((n, face) => !n || ORPHANS.has(face) && n <= 2)
    && counts.filter(n => n === 2).length <= 1;
}
function canCoverUnconnected(counts) {
  return counts.every(n => n <= 1)
    && KNITTED.some(knit => counts.every((n, face) => !n || face >= 27 || knit.includes(face)));
}

export function assignments(tiles, kongs = []) {
  const locked = new Map(kongs.flatMap(k => k.tileIds.map(id => [id, k.face])));
  let variants = [[]];
  for (const tile of tiles) {
    const faces = locked.has(tile.id) ? [locked.get(tile.id)] : tile.wild ? [0, 9, 18].map(offset => offset + rank(tile) - 1) : [tile.face];
    variants = variants.flatMap(v => faces.map(face => [...v, { ...tile, face }]));
  }
  return variants;
}

function ordinary(counts, meldsLeft, groups = [], pair = [], out = []) {
  const t = counts.findIndex(n => n > 0);
  if (t === -1) { if (meldsLeft === 0 && pair.length) out.push({ groups, pair }); return out; }
  if (!pair.length && counts[t] >= 2) {
    counts[t] -= 2; ordinary(counts, meldsLeft, groups, [t, t], out); counts[t] += 2;
  }
  if (!meldsLeft) return out;
  if (counts[t] >= 3) {
    counts[t] -= 3; ordinary(counts, meldsLeft - 1, [...groups, [t, t, t]], pair, out); counts[t] += 3;
  }
  if (t < 27 && rank(t) <= 7 && counts[t + 1] && counts[t + 2]) {
    counts[t]--; counts[t + 1]--; counts[t + 2]--;
    ordinary(counts, meldsLeft - 1, [...groups, [t, t + 1, t + 2]], pair, out);
    counts[t]++; counts[t + 1]++; counts[t + 2]++;
  }
  return out;
}

export function decompose(tiles, kongs = [], mode = 'riichi') {
  if (tiles.length - kongs.length !== 14 || kongs.length > 4) return [];
  const locked = new Set(kongs.flatMap(k => k.tileIds));
  const result = [];
  for (const effective of assignments(tiles, kongs)) {
    const free = effective.filter(t => !locked.has(t.id));
    const counts = countsOf(free);
    const explanations = ordinary(counts, 4 - kongs.length).map(d => ({ ...d, shape: 'normal' }));
    if (!kongs.length) {
      if (counts.every(n => n === 0 || n === 2 || isMcr(mode) && n === 4)) {
        explanations.push({ shape: 'pairs', groups: counts.flatMap((n, t) => Array.from({ length: n / 2 }, () => [t, t])), pair: [] });
      }
      if (canCoverOrphans(counts)) explanations.push({ shape: 'orphans', groups: [allFaces(counts)], pair: [] });
      if (isMcr(mode) && canCoverUnconnected(counts)) explanations.push({ shape: 'unconnected', groups: [allFaces(counts)], pair: [] });
    }
    if (isMcr(mode) && kongs.length <= 1) {
      for (const knit of KNITTED) {
        if (!knit.every(face => counts[face])) continue;
        const rest = [...counts]; for (const face of knit) rest[face]--;
        for (const d of ordinary(rest, 1 - kongs.length)) {
          explanations.push({ ...d, shape: 'knitted', groups: [knit, ...d.groups] });
        }
      }
    }
    for (const explanation of explanations) {
      const pool = new Map();
      for (const t of free.slice().sort((a,b) => a.id.localeCompare(b.id))) { if (!pool.has(t.face)) pool.set(t.face, []); pool.get(t.face).push(t.id); }
      const take = group => group.map(face => pool.get(face).shift());
      const kongGroups = kongs.map(k => Array(4).fill(k.face)), kongIds = kongs.map(k => [...k.tileIds]);
      const freeGroupIds = explanation.groups.map(take);
      const groups = explanation.shape === 'knitted' ? [...explanation.groups, ...kongGroups] : [...kongGroups, ...explanation.groups];
      const groupTileIds = explanation.shape === 'knitted' ? [...freeGroupIds, ...kongIds] : [...kongIds, ...freeGroupIds];
      const pairTileIds = take(explanation.pair);
      result.push({ ...explanation, groups, groupTileIds, pairTileIds, tiles: effective,
        wildcardAssignments: effective.filter(t => t.wild).map(t => ({ tileId: t.id, face: t.face, suit: suit(t) })),
        declaredKongs: kongs.map(k => ({ ...k, tileIds: [...k.tileIds] })),
      });
    }
  }
  return result;
}

// Covers every existing tile with at most four melds and one pair. Missing tiles may be
// supplied later; undeclared four-of-a-kind may become a kong. Never claims wall availability.
function canCover(counts, meldsLeft, pairLeft, memo) {
  const t = counts.findIndex(n => n);
  if (t === -1) return true;
  if (!meldsLeft && !pairLeft) return false;
  const key = `${meldsLeft}/${pairLeft}/${counts.join(',')}`;
  if (memo.has(key)) return memo.get(key);
  const candidates = [];
  if (pairLeft) candidates.push({ group: [t, t], melds: meldsLeft, pair: 0 });
  if (meldsLeft) {
    candidates.push({ group: [t, t, t, t], melds: meldsLeft - 1, pair: pairLeft });
    if (t < 27) for (let start = Math.max(Math.floor(t / 9) * 9, t - 2); start <= Math.min(t, Math.floor(t / 9) * 9 + 6); start++) {
      candidates.push({ group: [start, start + 1, start + 2], melds: meldsLeft - 1, pair: pairLeft });
    }
  }
  for (const c of candidates) {
    const next = [...counts]; for (const face of c.group) if (next[face]) next[face]--;
    if (canCover(next, c.melds, c.pair, memo)) { memo.set(key, true); return true; }
  }
  memo.set(key, false); return false;
}
export function canCompleteByAdding(tiles, kongs = [], mode = 'riichi') {
  if (tiles.length - kongs.length > 14 || kongs.length > 4) return false;
  const locked = new Set(kongs.flatMap(k => k.tileIds));
  for (const effective of assignments(tiles, kongs)) {
    const counts = countsOf(effective.filter(t => !locked.has(t.id)));
    if (!kongs.length) {
      const maxPairCopies = isMcr(mode) ? 4 : 2;
      if (counts.every(n => n <= maxPairCopies) && counts.reduce((n, copies) => n + Math.ceil(copies / 2), 0) <= 7) return true;
      if (canCoverOrphans(counts)) return true;
      if (isMcr(mode) && canCoverUnconnected(counts)) return true;
    }
    if (isMcr(mode) && kongs.length <= 1) {
      for (const knit of KNITTED) {
        const rest = [...counts]; for (const face of knit) if (rest[face]) rest[face]--;
        if (canCover(rest, 1 - kongs.length, 1, new Map())) return true;
      }
    }
    if (canCover(counts, 4 - kongs.length, 1, new Map())) return true;
  }
  return false;
}
