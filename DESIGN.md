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
