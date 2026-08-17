/* ── Shared-group clustering sort ─────────────────────────────────── */

/**
 * Order items so that items sharing group labels end up as close to each
 * other as possible, while items without any group stay outside the
 * clustering (first in ascending order, last in descending order, keeping
 * their original relative order among themselves).
 *
 * The old scheme joined a goal's group names into one key and sorted those
 * strings lexicographically, so the placement of a multi-group goal was
 * decided by whichever group name happened to be stored first (["B","A"]
 * sorts differently from ["A","B"]). This function instead treats shared
 * groups as "relatedness": two items are close when they share a group, and
 * a multi-group item acts as a bridge that lands between the blocks of every
 * group it belongs to.
 *
 * Algorithm: greedy insertion. Affinity is the number of shared groups
 * (affinity(i, j) = |groups(i) ∩ groups(j)|). Start from the item with the
 * highest total affinity to the others (the most "bridging" item); then
 * repeatedly insert the remaining item at the position — front, back or
 * between two placed items — that adds the most adjacency affinity.
 * Ties are resolved deterministically: lower original index first, then the
 * later insertion position (so clusters grow outward from the bridge).
 *
 * Worst case is O(m³) with m = number of grouped items (m² precomputed
 * affinity matrix, m² candidate evaluations per insertion step at most).
 * Disjoint groups (all affinities 0) collapse to the original order, and a
 * single shared group (all affinities equal) appends in original order.
 *
 * @param items Items to order (not mutated).
 * @param groupsOf Returns the group labels of an item (deduped internally).
 * @param dir 1 keeps grouped items in clustered (ascending) order, -1
 *   reverses the cluster block; ungrouped items stay first (asc) / last
 *   (desc) regardless of direction.
 */
export function clusterSortByGroups<T>(
  items: readonly T[],
  groupsOf: (item: T, index: number) => readonly string[],
  dir: 1 | -1 = 1,
): T[] {
  const n = items.length;

  // Split into grouped / ungrouped original indices; dedupe each item's
  // group labels so "A|A" cannot create a self-affinity.
  const itemGroups: string[][] = new Array(n);
  const grouped: number[] = [];
  const ungrouped: number[] = [];
  for (let i = 0; i < n; i++) {
    const gs = [...new Set(groupsOf(items[i], i))];
    itemGroups[i] = gs;
    (gs.length > 0 ? grouped : ungrouped).push(i);
  }

  const m = grouped.length;
  if (m <= 1) {
    const order =
      dir === 1 ? [...ungrouped, ...grouped] : [...grouped, ...ungrouped];
    return order.map((i) => items[i]);
  }

  // Group name -> positions inside `grouped`.
  const byGroup = new Map<string, number[]>();
  for (let p = 0; p < m; p++) {
    for (const g of itemGroups[grouped[p]]) {
      let list = byGroup.get(g);
      if (!list) byGroup.set(g, (list = []));
      list.push(p);
    }
  }

  // shared[a][b] = groups shared by grouped items a and b.
  const shared: number[][] = Array.from({ length: m }, () =>
    new Array<number>(m).fill(0),
  );
  for (const list of byGroup.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        shared[i][j]++;
        shared[j][i]++;
      }
    }
  }

  // Total affinity per item; pick the most bridging item as the seed.
  const total = new Array<number>(m);
  let start = 0;
  let bestTotal = -1;
  for (let p = 0; p < m; p++) {
    let s = 0;
    for (let q = 0; q < m; q++) s += shared[p][q];
    total[p] = s;
    if (s > bestTotal || (s === bestTotal && grouped[p] < grouped[start])) {
      bestTotal = s;
      start = p;
    }
  }

  // Greedy insertion. A position's gain is the adjacency affinity it adds:
  // at the ends it is the affinity with the end item; in the middle it is
  // affinity with both neighbours minus the affinity the two neighbours
  // already had (what we would tear apart).
  const seq: number[] = [start];
  const inSeq = new Set<number>([start]);
  while (seq.length < m) {
    let bestGain = -1;
    let bestU = -1;
    let bestPos = -1;
    for (let u = 0; u < m; u++) {
      if (inSeq.has(u)) continue;
      for (let pos = 0; pos <= seq.length; pos++) {
        let gain: number;
        if (pos === 0) gain = shared[u][seq[0]];
        else if (pos === seq.length) gain = shared[u][seq[seq.length - 1]];
        else
          gain =
            shared[u][seq[pos - 1]] +
            shared[u][seq[pos]] -
            shared[seq[pos - 1]][seq[pos]];
        if (
          gain > bestGain ||
          (gain === bestGain &&
            (grouped[u] < grouped[bestU] ||
              (grouped[u] === grouped[bestU] && pos > bestPos)))
        ) {
          bestGain = gain;
          bestU = u;
          bestPos = pos;
        }
      }
    }
    seq.splice(bestPos, 0, bestU);
    inSeq.add(bestU);
  }

  const cluster = seq.map((p) => grouped[p]);
  if (dir === -1) cluster.reverse();
  const order =
    dir === 1 ? [...ungrouped, ...cluster] : [...cluster, ...ungrouped];
  return order.map((i) => items[i]);
}
