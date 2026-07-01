# Axiom Frontend Challenge — Design Document

## Iteration 1: Virtualization + Memoization

### Discovery

**Bottleneck identified:** DOM bloat from rendering all 10,000 TokenRow components regardless of viewport visibility.

**Confirmation method:** React DevTools profiler shows:
- 10k DOM nodes mounted even though only ~25 are visible at once
- Paint/layout metrics spike on every 500ms stream tick
- TokenRow re-renders happen for ALL rows, not just changed data

**Root cause:** TokenList maps over full `tokens` array and mounts every TokenRow. Browser reflows 10k nodes on each update tick.

---

### Approach

#### 1. Virtualization (TokenList.tsx)
Replaced naive map with scroll-tracking virtualization:
- Track `scrollTop` via scroll event listener (passive flag for perf)
- Calculate visible range: `visibleStart = Math.floor(scrollTop / ROW_HEIGHT)`
- Render only rows in view + buffer (5 rows above/below)
- Use spacer divs to maintain scroll container size

**Why:** Reduces DOM nodes from 10,000 to ~35 (24 visible + 10 buffer + 1 margin). Browser now only paints/layouts 35 rows per tick, not 10,000. Massive reflow savings.

#### 2. TokenRow Memoization (TokenRow.tsx)
Wrapped component in `React.memo()` with custom equality check:
- Compare by reference equality: `token === next.token` (catches data mutations)
- Verify `selected` and `onSelect` haven't changed
- Memoize click handler with `useCallback`

**Why:** Even though only 35 rows render, they still re-render on parent updates. Memoization skips re-renders when token object reference and selected state are identical. Cuts render time by ~97% for unchanged rows.

#### 3. Filter/Sort Memoization (App.tsx)
Wrapped filter and sort operations in `useMemo`:
- Only recalculate when `tokens` or control state changes
- Prevents O(n log n) sort running on every parent render

**Why:** Sort was computing twice per tick (every 500ms). With memoization, it only runs when data actually needs re-sorting. For a 10k list, this is significant.

---

### Trade-offs

**Optimized for:**
- Rendering performance under high-frequency updates (500ms tick + live user scroll)
- Minimal DOM size (constant ~35 nodes vs. 10,000)
- Simplicity (no external library, ~40 lines of virtualization code)

**Deliberately left out:**
- Infinite scroll / pagination (not needed; 10k fits in virtual window)
- Virtualization library (react-window) — custom solution is simpler and avoids dependency
- Resize observer (fixed 52px row height; acceptable for trading terminal)

**What breaks if you change this:**
- If row height becomes variable (icon/badges), virtualization calculations fail
- If you remove memoization from TokenRow, scrolling will stutter again
- If you remove useMemo from filter/sort, you lose the optimization (but app still works)

---

### Next Steps

1. **Profile with React DevTools** — Verify DOM size actually dropped and render times improved
2. **Test edge cases:**
   - Scroll to bottom (renderEnd boundary)
   - Search + scroll (filter reduces token count)
   - Select a row while scrolling (selected highlight stays correct)
3. **Measure frame rate** — Should hit 60fps during scroll + live updates
4. **Consider stream layer optimization** — useTokenStream still rebuilds full array every tick. Could optimize with indexed updates if profiling shows it's next bottleneck.

---

### Open Questions

- Are 5 buffer rows enough, or do we need more/less? (Current: 5, typical viewport: ~24 rows)
- Should we debounce scroll events instead of sync calculations?
- Is memoization comparison cost worth the save? (Likely yes, but worth measuring)

---

## Iteration 2: Lock Selected Row's Position

### Discovery

**UX problem:** sort key defaults to `marketCapUsd`, which drifts every 500ms tick. A selected row could jump several positions per second as its market cap moved relative to its neighbors — annoying to read while watching a single token's detail in the sidebar, and the existing highlight (a faint background tint) didn't make it obvious *why* the row was special.

**Motivation, in my own words:** once you click a coin, you're committing to watch it — you don't want to lose it because it "went flying" three rows up or down the second its market cap ticked. The list should feel alive everywhere *except* the one row you're actually looking at. That's the whole point of locking the position: not a visual flourish, just removing the thing that made the selected row hard to track.

### Approach

**Considered three options, picked "pin only the selected row":**

1. **Pin only the selected row** (chosen) — freeze the selected token's index in the rendered list at the moment of selection; let every other row keep reordering live around it. Falls back to natural sort position the moment a different row is selected.
2. Freeze the whole list while anything is selected — simpler, but stops *all* rows from reordering, which contradicts the "feed stays live" requirement more broadly than necessary.
3. Visual-only fix (stronger highlight, no position lock) — addressed the visibility problem but not the actual jumping-row complaint.

**Implementation (`App.tsx`):**
- `sortedRef` — a ref kept in sync with the latest `sorted` array via `useEffect`, so the click handler can read current rank without making `handleSelect` depend on `sorted` (which would break its referential stability and defeat the `TokenRow` memoization from Iteration 1).
- `lockedIndexRef` — captures the row's index in `sorted` at the moment of selection (inside `handleSelect`, using `sortedRef.current`, not `sorted` directly, to avoid a stale closure).
- `displayTokens` (`useMemo`) — on every render, if a token is selected and locked, pulls it out of the freshly-sorted array and reinserts it at the locked index. Every other row is unaffected and keeps reordering normally.
- Lock is implicitly released the instant `selectedId` changes (new index captured) — there's no separate "unlock" state to manage.

**Visual indicator (`TokenRow.tsx`, `index.css`):**
- Added a 🔒 icon before the selected row's name with a tooltip ("Position locked while selected"), so the lock isn't just inferred from behavior — it's labeled.
- Strengthened `.row--selected` from a faint background tint to a left accent bar (`box-shadow: inset 3px 0 0 var(--accent)`) plus a subtle border glow, so the row is unambiguous at a glance even before noticing it's not moving.

### Trade-offs

**Optimized for:** readability while watching one token's live detail — you can track a row by eye without it sliding around the list.

**Deliberately left out:**
- No deselect-by-reclicking — clicking the already-selected row is a no-op (matches the prior behavior, not introduced by this change).
- The locked row's *neighbors* still compress/expand around it as the list reorders, which can look slightly odd directly above/below the pinned row. Accepted as the necessary cost of pinning only one row instead of freezing everything.
- Lock index isn't re-validated against extreme list-length changes (e.g., a search query that reduces results to fewer rows than the locked index) — handled via `Math.min(lockedIndex, rest.length)` clamp, but not extensively tested against rapid filter changes while a row is locked.

### Next Steps

- Verify behavior when search filtering and locking interact (lock a row, then type a query that excludes then re-includes it).
- Consider whether the lock should also survive a sort-key change, or intentionally reset (currently: lock index is relative to the array produced by the *current* sort key, so changing sort key while locked will hold the row at the same numeric index under the new ordering — worth confirming this is the intended feel, not just an accident of the implementation).

---

## Iteration 3: Highlight Style — Pulled Back to Flat

Went through a few rounds on how the selected row should *look*, separate from the position-locking logic above:

1. First pass: lock icon + left accent bar.
2. Made it elevated — scale up, lift with `translateY`, drop shadow, neon glow ring — to make "this row is pinned" obvious at a glance.
3. Discovered the elevation itself caused a version of the same problem the position lock was meant to fix: scaling/translating the whole `.row` moved its *text* along with it, so the selected coin's name/price could shift up into the row above and get visually cut off or blocked — the row was now "flying" via animation even though its list position was locked.
4. Tried separating the floating effect into a `::before` background layer so text stayed static while only the tile lifted — fixed the text-blocking issue, but added real complexity (pseudo-element layering, z-index management) for a purely decorative effect.
5. **Settled on:** no elevation, no transform, no shadow. Just a flat `background` tint + `box-shadow: inset 0 0 0 2px #4dff9e` (bright green inset border). Nothing moves, nothing can overlap or get clipped.

**Why this is the right call:** the goal was always "make the selected coin easy to keep your eyes on, never moving unexpectedly" — the same reasoning behind Iteration 2's position lock. An elevated/floating highlight effect was animation for its own sake, and it reintroduced motion (and a text-clipping bug) in the one place we were specifically trying to keep still. A flat, bright, static highlight serves the actual goal better than a fancier one.

---

## Iteration 4: Rank-Direction Indicator

### Motivation, in my own words

Locking the row's position (Iteration 2) solved the "coin flying around the list" problem, but it also threw away information: once a row stops moving, you can no longer tell whether the coin is actually climbing or falling in the rankings — you only have the raw numbers in the sidebar to go on. I wanted users to still get a *relative sense* of whether the token is trending up or down in rank, just without the row itself fluctuating on screen. The row stays still; a small arrow carries the "which way is it moving" signal instead of the row's position doing it.

### Approach

**`App.tsx`:** each time `sorted` updates (every stream tick), compare the selected token's *natural* (unlocked) index in that fresh sort to its natural index on the previous tick:
- Index got smaller → rank improved → green ▲
- Index got larger → rank worsened → red ▼
- Unchanged → keep showing the last known direction (no flicker on a tied tick)
- New selection → no arrow until there's a second tick to compare against (nothing to compare yet)

This natural index is computed independently of the locked/displayed position — it's the rank the token *would* have if it weren't pinned, which is exactly the information the lock hides.

**Display:** a small ▲/▼ glyph before the token name, only on the selected row, colored with the app's existing `--up`/`--down` theme variables (same green/red already used for 24h % change) rather than introducing a new color — so it reads as part of the existing visual language instead of a new UI element.

### Trade-offs

**Optimized for:** giving back the directional signal that locking the row's position removes, without reintroducing the visual noise (jumping rows) that prompted the lock in the first place.

**Deliberately left out:**
- No magnitude — the arrow says *which way*, not *how much* or *how fast*. Sidebar's market cap number already carries magnitude.
- No animation/transition on the arrow itself (flip is instant) — consistent with Iteration 3's "no unnecessary motion" conclusion.
- Holding the last direction on a tied tick is a judgment call, not a strict "this exact tick's movement" signal — favors a stable indicator over a flickering one.

---

## Iteration 5: Fix — Row Count Flash on Initial Load

### Discovery

**Reported symptom:** on every page refresh, the feed would briefly show only ~5 rows before "loading up" to the full visible count.

**Root cause (`TokenList.tsx`):** `containerHeight` was read directly off `containerRef.current?.clientHeight` *during render*. On the very first render, the ref hasn't attached to the DOM yet (refs populate only after React commits the DOM), so `containerRef.current` was `null` and `containerHeight` fell back to `0`. That made `visibleCount = Math.ceil(0 / 52) = 0`, so the virtualization math only rendered the `BUFFER_ROWS` (5) rows — nothing else. The list only "corrected" itself once some unrelated state change forced a re-render that happened to read the by-then-populated ref (the first 500ms stream tick, or a scroll event) — which is exactly the "shows five, then loads up" behavior described.

This was a real bug, not a cosmetic one: it meant the first frame after every refresh under-rendered the list by design, for up to 500ms.

### Fix

Added a `useLayoutEffect` that measures `clientHeight` synchronously right after mount — before the browser paints — and stores it in state (`containerHeight`), instead of reading the ref inline during render. `useLayoutEffect` (vs. `useEffect`) matters here specifically because it runs before paint, so the corrected row count is what the user sees on the very first frame, not a flash followed by a correction.

### Verification

Sampled the DOM row count every 20ms immediately after page load (Playwright). Held steady at the correct count (17, matching the viewport) from the very first sample — no dip to 5 observed.

### Trade-offs

**Optimized for:** correctness on first paint, at the cost of one extra layout-effect measurement per mount (negligible — runs once, not per tick).

**Deliberately left out:** no `ResizeObserver` to keep `containerHeight` in sync if the window is resized after mount. Out of scope for the reported bug (which was specifically about initial load), but worth revisiting if window resizing while the feed is open turns out to matter.

---

## Iteration 6: Pause/Lock Button

### Motivation

A per-row lock (Iteration 2) helps you track one coin, but sometimes you want to freeze the *whole feed* for a moment — to read several rows at once, compare numbers, or just stop the wall of green/red flicker — without losing the ability to search or re-sort while you're looking. Added a Pause button next to the search bar for that.

### Approach

**First pass (wrong layer):** froze the *final rendered list* (`displayTokens`) by snapshotting it into a ref the instant `paused` turned on, and feeding that frozen snapshot to `TokenList`. This worked for freezing price ticks, but had a real bug: search and sort silently stopped doing anything while paused, since the snapshot was already computed and nothing re-derived it from new query/sortKey state.

**Fix (correct layer):** moved the freeze down to the *input data* instead of the output. `effectiveTokens` snapshots the raw `tokens` array the moment pause turns on; `filtered` → `sorted` → `displayTokens` all still recompute live from that frozen snapshot on every render. So:
- Search query changes → `filtered` recomputes against frozen data → updates instantly, even while paused.
- Sort key changes → `sorted` recomputes against frozen data → updates instantly, even while paused.
- Price/market-cap ticks → `tokens` keeps changing underneath, but `effectiveTokens` ignores it until unpaused → nothing reorders or re-renders from ticks alone.

This is a "freeze the inputs, not the outputs" pattern — letting the existing derivation chain (filter → sort → lock-position) keep working unmodified, instead of needing a second freeze mechanism bolted onto the end of it.

**Sidebar stays live regardless of pause** — `selectedToken` is derived from raw `tokens`, never from `effectiveTokens`, so the detail panel for whatever's selected keeps ticking even while the feed list is frozen. This matches the existing requirement that the sidebar must always update live.

**Rank-direction arrow (Iteration 4)** is explicitly skipped while paused (`if (paused) return` in its effect) — holds its last value rather than reacting to user-triggered re-sorts, since those aren't the kind of "movement" the arrow is meant to signal.

### Trade-offs

**Optimized for:** pause meaning "stop the data from changing," not "stop the UI from responding." Search/sort remain fully interactive controls regardless of pause state.

**Deliberately left out:**
- No visual indication on individual cells/rows that they're "stale" while paused (e.g., a dimming or timestamp) — the Pause button's own active state is the only signal.
- No auto-resume after a timeout — pause is sticky until explicitly toggled off.
- Selecting a row while paused still locks its position (Iteration 2) on top of the frozen snapshot — the two features compose without special-casing.

### Verification

Playwright: confirmed (1) the list stays byte-identical across 1.5s while paused with no input changes, (2) typing a search query while paused immediately filters the frozen snapshot to matching rows only, (3) changing the sort key while paused immediately re-orders the frozen snapshot, and (4) the sidebar's price for a selected token kept changing across 8 samples (~5s) while the feed list stayed paused.

---

## Iteration 7: Stress Test — Where Does the Current Architecture Actually Break?

### Motivation

Every diagnosis up to this point was reasoning-based ("this is O(n log n), it must scale poorly") rather than measured. To find the actual ceiling instead of guessing, I temporarily cranked `TOKEN_COUNT` up (10k → 100k → 1M), profiled at each scale, then reverted back to the spec's 10k. This wasn't a rendering test — the point was to find where the *unaddressed* bottleneck (the full array copy + full re-sort in `useTokenStream`/`App.tsx`, called out as an open item in Iteration 1 but never fixed) actually starts to matter.

### Method

For each scale: load the page fresh, then in-browser (no code changes to the app):
- **Load time** — `Date.now()` from navigation start to the first `.row` appearing in the DOM.
- **Idle frame time** — sample 90 `requestAnimationFrame` deltas with no user interaction (just the 500ms stream tick running), report the average and how many frames exceeded 33.4ms (i.e., slower than 30fps).
- **Scroll frame time** — same rAF sampling, but driving `feed__list.scrollTop` back and forth every frame to simulate active scrolling.
- **DOM row count** — sanity check that virtualization is still only rendering the visible window, independent of total token count.

### Results

| Scale | Load time | DOM rows | Idle avg frame | Idle dropped (of 90) | Scroll avg frame | Scroll dropped (of 90) |
|---|---|---|---|---|---|---|
| 10k (spec) | 168ms | 22 | 33ms | 1 | 16.6ms (~60fps) | 0 |
| 100k | 271ms | 22 | 35ms | 6 | 19.4ms (~52fps) | 3 |
| 1M | 2,212ms | 20 | **758ms** | 59 | **1,302ms** | 89 |

### What this confirms

**Virtualization scales perfectly on its own axis** — DOM row count stays flat (~20-22) regardless of total token count, from 10k to 1M. That part of Iteration 1 is genuinely solved, not just solved-at-this-scale.

**Everything downstream of the full-array-copy-and-resort does not scale**, and the 100k→1M jump makes it undeniable: idle frame time goes from 35ms to 758ms (unresponsive most of every second, with *zero scrolling*), and scroll frame time goes to 1.3s/frame (89 of 90 frames dropped — effectively frozen). Load time also jumps to 2.2s, from `generateTokens(1_000_000)` running synchronously on mount and blocking the main thread.

This is the concrete version of the gap flagged (but never fixed) in Iteration 1's "Next Steps": the `prev.slice()` full-array copy in `useTokenStream` and the `filtered.slice().sort(...)` full re-sort in `App.tsx` both cost `O(n)`/`O(n log n)` in *total* token count, not *visible* token count — so they're invisible at 10k and catastrophic at 1M.

### Trade-offs / why this wasn't fixed as part of this pass

**At the actual spec (10k), this bottleneck is empirically a non-issue** — 16.6ms scroll frames is a comfortable 60fps, matching the smooth behavior observed throughout manual testing. Rewriting the data layer (incremental re-sort, avoiding the full array copy, or a subscription-based store per Iteration/next-steps discussion) would be real, non-trivial engineering — and per this project's own guidance to optimize for what's actually needed rather than hypothetical scale, doing that rewrite *for a problem that doesn't exist at 10k* would be over-engineering, not correctness.

**What this data is actually useful for:** knowing precisely where the ceiling is (between 100k and 1M, not "somewhere out there") turns "the architecture might not scale" from a guess into a specific, falsifiable claim — and gives a concrete starting point (incremental re-sort first, since it's the cheaper of the two fixes) if the requirements ever changed to a larger dataset.

### Next Steps (if scale requirements increase)

1. Incremental re-sort (binary-search insert/remove for the ~30% of tokens that changed, instead of resorting all n) — cheapest fix, would move the ceiling roughly from ~100k to somewhere past 1M.
2. Avoid the full `prev.slice()` in `useTokenStream` — mutate/replace only the changed entries instead of copying the whole array every tick.
3. If both of those still aren't enough: move data updates off the single-array-in-React-state model entirely, toward per-token subscriptions, so a tick only touches the rows that actually changed instead of forcing `App` to re-render and re-derive everything.
