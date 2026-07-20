/**
 * Hex coordinate utilities using axial coordinates (q, r) for flat-top hexagons.
 * Board: 0 <= q < sizeBlue, 0 <= r < sizeRed.  Total cells = sizeBlue * sizeRed.
 * Index = r * sizeBlue + q.
 *
 * Red:  connects r=0 (NW edge) to r=sizeRed-1 (SE edge)
 * Blue: connects q=0 (NE edge) to q=sizeBlue-1 (SW edge)
 */

import type { Team } from "../utils/colors";
import type { MarkEntry } from "../types";

export function indexToAxial(
  idx: number,
  sizeBlue: number,
): { q: number; r: number } {
  return { q: idx % sizeBlue, r: Math.floor(idx / sizeBlue) };
}

export function axialToIndex(q: number, r: number, sizeBlue: number): number {
  return r * sizeBlue + q;
}

const AXIAL_NEIGHBORS: [number, number][] = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
];

export function getNeighbors(
  q: number,
  r: number,
  sizeBlue: number,
  sizeRed: number,
): number[] {
  const result: number[] = [];
  for (const [dq, dr] of AXIAL_NEIGHBORS) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq >= 0 && nq < sizeBlue && nr >= 0 && nr < sizeRed) {
      result.push(axialToIndex(nq, nr, sizeBlue));
    }
  }
  return result;
}

class UnionFind {
  parent: number[];
  rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

/**
 * Red:  connects q=0 to q=sizeBlue-1  (NW -> SE)
 * Blue: connects r=0 to r=sizeRed-1 (NE -> SW)
 */
export function checkWin(
  marks: Record<number, MarkEntry[]>,
  team: Team,
  sizeBlue: number,
  sizeRed: number,
): number[] | null {
  const totalCells = sizeBlue * sizeRed;
  const EDGE_A = totalCells;
  const EDGE_B = totalCells + 1;
  const uf = new UnionFind(totalCells + 2);

  const playerCells: number[] = [];
  for (let idx = 0; idx < totalCells; idx++) {
    if (marks[idx]?.[0]?.by === team) {
      playerCells.push(idx);
    }
  }

  if (playerCells.length === 0) return null;

  if (team === "red") {
    for (const idx of playerCells) {
      const { q, r } = indexToAxial(idx, sizeBlue);
      if (r === 0) uf.union(idx, EDGE_A);
      if (r === sizeRed - 1) uf.union(idx, EDGE_B);
      for (const nIdx of getNeighbors(q, r, sizeBlue, sizeRed)) {
        if (marks[nIdx]?.[0]?.by === team) {
          uf.union(idx, nIdx);
        }
      }
    }
    if (uf.connected(EDGE_A, EDGE_B)) {
      return findWinningPath(marks, team, sizeBlue, sizeRed, "blue");
    }
  } else {
    for (const idx of playerCells) {
      const { q, r } = indexToAxial(idx, sizeBlue);
      if (q === 0) uf.union(idx, EDGE_A);
      if (q === sizeBlue - 1) uf.union(idx, EDGE_B);
      for (const nIdx of getNeighbors(q, r, sizeBlue, sizeRed)) {
        if (marks[nIdx]?.[0]?.by === team) {
          uf.union(idx, nIdx);
        }
      }
    }
    if (uf.connected(EDGE_A, EDGE_B)) {
      return findWinningPath(marks, team, sizeBlue, sizeRed, "red");
    }
  }

  return null;
}

function findWinningPath(
  marks: Record<number, MarkEntry[]>,
  team: Team,
  sizeBlue: number,
  sizeRed: number,
  direction: "red" | "blue",
): number[] {
  const startCells: number[] = [];

  if (direction === "red") {
    for (let r = 0; r < sizeRed; r++) {
      const idx = axialToIndex(0, r, sizeBlue);
      if (marks[idx]?.[0]?.by === team) startCells.push(idx);
    }
  } else {
    for (let q = 0; q < sizeBlue; q++) {
      const idx = axialToIndex(q, 0, sizeBlue);
      if (marks[idx]?.[0]?.by === team) startCells.push(idx);
    }
  }

  for (const start of startCells) {
    const visited = new Set<number>();
    const parent = new Map<number, number>();
    const queue: number[] = [start];
    visited.add(start);

    let found: number | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const { q, r } = indexToAxial(cur, sizeBlue);

      if (direction === "red" && q === sizeBlue - 1) {
        found = cur;
        break;
      }
      if (direction === "blue" && r === sizeRed - 1) {
        found = cur;
        break;
      }

      for (const nIdx of getNeighbors(q, r, sizeBlue, sizeRed)) {
        if (!visited.has(nIdx) && marks[nIdx]?.[0]?.by === team) {
          visited.add(nIdx);
          parent.set(nIdx, cur);
          queue.push(nIdx);
        }
      }
    }

    if (found !== null) {
      const path: number[] = [];
      let node: number | undefined = found;
      while (node !== undefined) {
        path.push(node);
        node = parent.get(node);
      }
      return path;
    }
  }

  return [];
}
