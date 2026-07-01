/// <reference lib="webworker" />
import type { Token } from "../types";
import type { MainToWorker, FeedUpdate, SortKey } from "./feedProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const NAME_PREFIXES = [
  "Solar", "Lunar", "Hyper", "Mega", "Turbo", "Quantum", "Degen", "Based",
  "Giga", "Neon", "Astro", "Pixel", "Cyber", "Atomic", "Cosmic",
];
const NAME_SUFFIXES = [
  "Cat", "Dog", "Inu", "Pepe", "Moon", "Rocket", "Coin", "Floki", "Wif",
  "Bonk", "Chad", "Ape", "Frog", "Bull", "Doge",
];
const SUF = NAME_SUFFIXES.length;

/** Same LCG as the original generator, so the dataset is byte-for-byte the
 * same shape — just stored columnar instead of as an array of objects. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// ---- Columnar store. One typed array per field instead of 1M objects. ----
let N = 0;
let churn = 0;
let intervalMs = 500;

let priceUsd!: Float64Array;
let marketCapUsd!: Float64Array;
let volume24hUsd!: Float64Array;
let liquidityUsd!: Float64Array;
let priceChangePct!: Float64Array;
let ageSeconds!: Int32Array;
let holders!: Int32Array;
let txCount!: Int32Array;
// Names are drawn from a 15x15 set, so we store the two small indices and
// rebuild the string on demand (only ever for the ~visible window).
let prefixIdx!: Uint8Array;
let suffixIdx!: Uint8Array;

// Precomputed lowercase forms per name combo (225 entries) for fast search.
const nameLC: string[] = [];
const tickerPrefixLC: string[] = [];

// ---- View / query state ----
let query = "";
let sortKey: SortKey = "marketCapUsd";
let paused = false;

let selectedIndex = -1; // -1 = nothing selected
let lockedIndex: number | null = null; // display row the selected token is pinned to
let prevNaturalPos: number | null = null;
let rankDirection: "up" | "down" | null = null;

let viewStart = 0;
let viewEnd = 0;

// Order = filtered indices sorted by the active key (descending). `allOrder`
// is reused (sorted in place) when there's no query; a query builds a smaller
// filtered array whose membership is cached until the query text changes.
let allOrder!: Int32Array;
let activeOrder!: Int32Array;
let filteredForQuery: string | null = null;

function keyColumn(k: SortKey): Float64Array | Int32Array {
  switch (k) {
    case "marketCapUsd": return marketCapUsd;
    case "volume24hUsd": return volume24hUsd;
    case "priceChangePct": return priceChangePct;
    case "ageSeconds": return ageSeconds;
  }
}

function buildToken(i: number): Token {
  const name = NAME_PREFIXES[prefixIdx[i]] + NAME_SUFFIXES[suffixIdx[i]];
  return {
    id: `tok_${i}`,
    name,
    ticker: name.slice(0, 4).toUpperCase() + (i % 100),
    ageSeconds: ageSeconds[i],
    priceUsd: priceUsd[i],
    marketCapUsd: marketCapUsd[i],
    volume24hUsd: volume24hUsd[i],
    liquidityUsd: liquidityUsd[i],
    holders: holders[i],
    txCount: txCount[i],
    priceChangePct: priceChangePct[i],
  };
}

function generate() {
  const rng = makeRandom(42);
  priceUsd = new Float64Array(N);
  marketCapUsd = new Float64Array(N);
  volume24hUsd = new Float64Array(N);
  liquidityUsd = new Float64Array(N);
  priceChangePct = new Float64Array(N);
  ageSeconds = new Int32Array(N);
  holders = new Int32Array(N);
  txCount = new Int32Array(N);
  prefixIdx = new Uint8Array(N);
  suffixIdx = new Uint8Array(N);

  // rng call order matches the original object generator exactly.
  for (let i = 0; i < N; i++) {
    const p = Math.floor(rng() * NAME_PREFIXES.length);
    const s = Math.floor(rng() * SUF);
    prefixIdx[i] = p;
    suffixIdx[i] = s;
    const price = rng() * 10;
    const mc = price * (1_000_000 + rng() * 50_000_000);
    ageSeconds[i] = Math.floor(rng() * 60 * 60 * 24 * 30);
    priceUsd[i] = price;
    marketCapUsd[i] = mc;
    volume24hUsd[i] = rng() * 5_000_000;
    liquidityUsd[i] = rng() * 2_000_000;
    holders[i] = Math.floor(rng() * 50_000);
    txCount[i] = Math.floor(rng() * 100_000);
    priceChangePct[i] = (rng() - 0.5) * 200;
  }

  for (let p = 0; p < NAME_PREFIXES.length; p++) {
    for (let s = 0; s < SUF; s++) {
      const combo = NAME_PREFIXES[p] + NAME_SUFFIXES[s];
      nameLC[p * SUF + s] = combo.toLowerCase();
      tickerPrefixLC[p * SUF + s] = combo.slice(0, 4).toLowerCase();
    }
  }

  allOrder = new Int32Array(N);
  for (let i = 0; i < N; i++) allOrder[i] = i;
  activeOrder = allOrder;
}

function mutate() {
  const updates = Math.floor(N * churn);
  for (let k = 0; k < updates; k++) {
    const i = Math.floor(Math.random() * N);
    const drift = 1 + (Math.random() - 0.5) * 0.08;
    priceUsd[i] *= drift;
    marketCapUsd[i] *= drift;
    volume24hUsd[i] *= 1 + (Math.random() - 0.5) * 0.1;
    txCount[i] += Math.floor(Math.random() * 50);
    priceChangePct[i] += (drift - 1) * 100;
  }
}

/** Rebuild filtered membership (only when the query text changed) and re-sort
 * the active order by the current key, descending. */
function recompute() {
  if (query) {
    if (filteredForQuery !== query) {
      const buf: number[] = [];
      for (let i = 0; i < N; i++) {
        const combo = prefixIdx[i] * SUF + suffixIdx[i];
        if (
          nameLC[combo].includes(query) ||
          (tickerPrefixLC[combo] + (i % 100)).includes(query)
        ) {
          buf.push(i);
        }
      }
      activeOrder = Int32Array.from(buf);
      filteredForQuery = query;
    }
  } else {
    activeOrder = allOrder;
    filteredForQuery = null;
  }
  const c = keyColumn(sortKey);
  activeOrder.sort((a, b) => c[b] - c[a]);
}

function findPos(idx: number): number {
  for (let i = 0; i < activeOrder.length; i++) {
    if (activeOrder[i] === idx) return i;
  }
  return -1;
}

/** Materialize just the requested viewport, applying the "pin the selected row
 * at its locked display index" transform without allocating a full-length
 * reordered array (an O(1)-per-row remove-and-insert index remap). */
function buildWindow(naturalPos: number): { rows: Token[]; start: number } {
  const len = activeOrder.length;
  const start = Math.min(Math.max(0, viewStart), len);
  const end = Math.min(len, Math.max(start, viewEnd));

  const pinned =
    selectedIndex >= 0 && naturalPos >= 0 && lockedIndex !== null;
  const L = pinned ? Math.min(lockedIndex as number, len - 1) : -1;

  const rows: Token[] = [];
  for (let d = start; d < end; d++) {
    let idx: number;
    if (L >= 0) {
      if (d === L) {
        idx = selectedIndex;
      } else {
        const dPrime = d < L ? d : d - 1; // position in list minus selected
        const srcPos = dPrime < naturalPos ? dPrime : dPrime + 1;
        idx = activeOrder[srcPos];
      }
    } else {
      idx = activeOrder[d];
    }
    rows.push(buildToken(idx));
  }
  return { rows, start };
}

function emit(isTick: boolean) {
  let naturalPos = -1;
  if (selectedIndex >= 0) {
    naturalPos = findPos(selectedIndex);
    if (naturalPos >= 0) {
      if (
        isTick &&
        !paused &&
        prevNaturalPos !== null &&
        naturalPos !== prevNaturalPos
      ) {
        rankDirection = naturalPos < prevNaturalPos ? "up" : "down";
      }
      prevNaturalPos = naturalPos; // rebaseline every emit
    } else {
      prevNaturalPos = null;
    }
  } else {
    prevNaturalPos = null;
  }

  const { rows, start } = buildWindow(naturalPos);
  const msg: FeedUpdate = {
    type: "update",
    total: N,
    visibleCount: activeOrder.length,
    windowStart: start,
    rows,
    rankDirection,
    selectedToken: selectedIndex >= 0 ? buildToken(selectedIndex) : null,
    ready: true,
  };
  ctx.postMessage(msg);
}

function tick() {
  if (!paused) {
    mutate();
    recompute();
    emit(true);
  }
  setTimeout(tick, intervalMs);
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      N = m.count;
      churn = m.churn;
      intervalMs = m.intervalMs;
      generate();
      recompute();
      emit(false);
      setTimeout(tick, intervalMs);
      break;
    }
    case "query": {
      query = m.query;
      recompute();
      emit(false);
      break;
    }
    case "sort": {
      sortKey = m.sortKey;
      recompute();
      emit(false);
      break;
    }
    case "paused": {
      paused = m.paused;
      break;
    }
    case "select": {
      if (m.id === null) {
        selectedIndex = -1;
        lockedIndex = null;
        rankDirection = null;
        prevNaturalPos = null;
      } else {
        selectedIndex = Number(m.id.slice(4)); // "tok_<i>"
        const pos = findPos(selectedIndex);
        lockedIndex = pos === -1 ? null : pos;
        prevNaturalPos = pos === -1 ? null : pos;
        rankDirection = null;
      }
      emit(false);
      break;
    }
    case "viewport": {
      viewStart = m.start;
      viewEnd = m.end;
      emit(false);
      break;
    }
  }
};

export {};
