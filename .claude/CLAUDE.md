# Axiom Frontend Challenge — Local CLAUDE.md

## Goal

Refactor the app into an efficient, virtualized implementation **without changing what it does**.

Transform a janky ~10,000-token live-updating feed into a smooth, performant trading terminal by optimizing rendering and the update loop.

## Ground Rules

- **Stay in React + TypeScript.** Keep it type-safe.
- **Add dependencies deliberately.** If you add something, justify it in DESIGN.md.
- **Restructure anything needed.** Components, data flow, mock data/stream layer — all fair game. Just keep the behavior intact.
- **Don't fake performance.** No dropping data, no pausing updates while scrolling, no reducing token count. The feed represents ALL 10k tokens and stays live.

## Requirements: What Must Still Work

Everything working today must still work when done:

- ✅ List of **all** tokens that scrolls smoothly, even under live updates
- ✅ Live data updates in place (no freezing the feed)
- ✅ Clicking a row selects it and shows detail in sidebar
- ✅ Sidebar keeps updating live for the selected token
- ✅ Search box filters by name/ticker
- ✅ Sort control re-orders the feed
- ✅ Responsive layout: sidebar right on desktop, below feed on mobile

## Success Criteria

We evaluate on:

1. **Performance under load** — smooth scrolling and interaction with 10k live-updating rows
2. **Correctness** — all existing behavior still works, including during live updates
3. **Code quality** — clear structure, readable, maintainable code
4. **DESIGN.md writeup** — quality of reasoning about bottlenecks, approach, and trade-offs

## Project Structure

```
src/
  App.tsx                  # composes feed + sidebar, owns filter/sort/selection state
  types.ts                 # Token data shape
  format.ts                # display formatting helpers
  data/
    generateTokens.ts      # seeds ~10k tokens
    useTokenStream.ts      # simulated live market feed
  components/
    Controls.tsx           # search + sort
    TokenList.tsx          # the feed (renders every row today — bottleneck)
    TokenRow.tsx           # a single row
    Sidebar.tsx            # detail panel for the selected token
```

## Known Bottlenecks

(Reference for context; diagnose yourself in DESIGN.md)

- **No virtualization** — All 10k TokenRows mounted to DOM regardless of viewport visibility
- **Re-renders on every update** — useTokenStream updates every 500ms, triggering full App re-render
- **No memoization** — TokenRow re-renders even if its token data didn't change
- **Full filter/sort per render** — App.tsx runs O(n log n) sort on every stream tick
- **New array reference per tick** — useTokenStream rebuilds the entire array every 500ms

## DESIGN.md Requirements

When you're done, DESIGN.md must cover:

1. **Diagnosis** — How you identified bottlenecks. What was actually slow, and how did you confirm it?
2. **Approach** — Your strategy for virtualization and the high-frequency update loop. Why did you choose this over alternatives?
3. **Trade-offs** — What you optimized for vs. against. What did you deliberately leave out?
4. **Next steps** — What you'd do with more time.

Keep it focused and well-reasoned. A short, thoughtful writeup beats a feature-stuffed one.

## Notes for Implementation

- The current app **works correctly** but is slow — don't break correctness while optimizing
- Profiling is your friend — use React DevTools to confirm changes actually help
- Memoization alone won't solve this (tokens reference change every tick) — likely need virtualization
- Virtualization library (react-window) vs. hand-rolled: pick one and justify in DESIGN.md
- Keep type safety throughout — no `any` types
