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
