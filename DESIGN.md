# Design Thought Process: Jack

All the design and analysis in this document is entirely hand-written by me (human). Some data and metrics were collected with the help of AI.

## Iteration 1: Virtualization 

The very first optimization was virtualization of the list items. As hinted in the doc, there were obvious lags and poor UX when testing the website on localhost. What I noticed was that the list wasn't rendered in real time once users start to scroll. I verified it by investigating the code and saw that all 10,000 tokens were being fetched, updated, and requested to render at all times, even those that weren't visible. Therefore, the first iteration is to turn the list into a lazy scrolling list where only the visible rows and nearby rows within certain buffer regions should be computed. If users don't see something, they do not need to know they exist. Let the work be done secretly behind the scenes.

How I diagnosed:
- Paint/layout metrics spike on every 500ms tick
- TokenRow re-renders happen for ALL rows, not just changed data

So I replaced naive map with scroll-tracking virtualization to track where the users were on the scrolling list and only render those that were visible and in the buffer zone.

**Results:** Reduces DOM nodes from 10,000 to ~35 (24 visible + 10 buffer + 1 margin). Browser now only paints/layouts 35 rows per tick, not 10,000. Massive reflow savings.

## Iteration 2: TokenRow Memoization

After the first iteration, there were still minor frozen lists whenever the list updated itself. I discovered that the issue was that all of the rows rendered on the list were still re-rendered on every parent update because of React's structure. 

How I diagnosed:
- Looking at the lists
- Stress testing by scrolling large movements on the scroll bar

So I put `TokenRow` in a `React.memo()` to only trigger additional rendering when any updates indeed happen on the specific token row. Similarly, for any operations and filters applied on the list, I also memoized them with `useMemo`, so the O(n log n) sorting only runs when the data or a control actually changes.

**Results:** unchanged rows skip rendering entirely. Only rows whose token object was replaced that tick re-render.

## Iteration 3: Lock Selected Row's Position

This is more of a UI/UX change, where I noticed that it could be unintuitive when a user selects a certain token row to view its details, but since the list was dynamically updated, the selected row also fluctuated. This created a visual pattern break where a selected row jumped around while you're trying to read its detail in the sidebar. With lots of tokens, the selected row could easily go out of sight and users couldn't find it anymore.

To improve this, I've considered many options:
1. Pin only the selected row (chosen) — freeze its index at selection, let everything else reorder around it.
2. Freeze the whole list while selected — simpler, but kills the live feed.
3. Just a stronger highlight — fixes visibility, not the jumping.

I ultimately decided on method 1 because it improves the UI in the most rational way without changing the basic design requirements. The list shouldn't freeze completely because that would break the pattern of dynamic updates on the list, frustrating the user experience, which invalidates method 2. 

So the implementation was to simply lock the row that is selected while keeping the rest of the list continuing to update themselves and ranking. I also made the highlighting bright and distinct enough so users can directly tell which row is selected.

## Iteration 3.1: Rank-Direction Indicator

One small iteration right after the design to lock a selected row was to also display a symbol that tells the relative direction in which the row moves. I realized the free floating of every row, including the selected one, gives valuable information about their ranking and movement. So I wanted to keep that information available by showing a directional tick.

Only on the selected row: 
Each update, compare the selected token's "real" index to last tick's:
- Smaller index → rank improved → green ▲
- Larger → worsened → red ▼

## Iteration 4: Pause/Lock Button

This is a new feature added. Although users might be interested in seeing all the tokens updating live, the dynamic updating could not be stopped and was forced upon the interface, which left the users no control over it. The sense of time just flows by without any user freedom to control. So in the case that the user wants to pause and examine the prices at a given time and compare across multiple tokens, users now can freeze the list at a given time.

**Trade-off:** In exchange for more user freedom, the downside is that not all users will need this (needs user interview and validation), and there is not enough customization in terms of which multiple tokens users want to focus on only. Simply freezing the whole list might cause poor UX in some scenarios.

## Iteration 5: Stress Test — Web Worker + Columnar Store (for 1M tokens)

Everything so far was reasoned and intuitive. But more tests needed to be done to meet the real requirements under load. To find the real ceiling I cranked `TOKEN_COUNT` up to 1M, and observed what would go wrong.

I collected the following data to observe the performance at different loads (with help of AI):
| Scale | Load | DOM rows | Idle avg | Idle dropped | Scroll avg | Scroll dropped |
|---|---|---|---|---|---|---|
| 10k (spec) | 168ms | 22 | 33ms | 1 | 16.6ms (~60fps) | 0 |
| 100k | 271ms | 22 | 35ms | 6 | 19.4ms (~52fps) | 3 |
| 1M | 2,212ms | 20 | **758ms** | 59 | **1,302ms** | 89 |

Observations:
- Virtualization scales — DOM rows stay ~20-22 at every scale.
- Everything downstream of the full array copy + full re-sort does not. At 1M, idle frames hit 758ms (unresponsive with zero scrolling) and scroll frames 1.3s (89 of 90 dropped — frozen). Load hits 2.2s from `generateTokens(1_000_000)` blocking the main thread on mount.

The root cause is the `prev.slice()` copy and the sorting from the filtering of the list, of which both would be O(n)/O(n log n) in all tokens, not just the visible ones.

The solution was to get the dataset and all the heavy work off the main thread entirely to improve performance at scale.

Approaches:
- **Typed arrays data storage** instead of 1M JS objects, giving each data a specific type: one `Float64Array`/`Int32Array` per numeric field, plus two `Uint8Array`s for the name indices. Far less memory used, and the sorting only deals with numbers now.
- **Web Worker** — It sorts an `Int32Array` of indices and sends back only the visible tokens and the selected one. The full dataset never crosses the thread boundary.
- Filtering is cached per query to avoid unnecessary re-rendering and re-sorting.

**Verification (Playwright, 1M):** header shows 1,000,000 / 1,000,000; only ~32 rows in the DOM; deep scroll (~row 500k) still renders; clicking a row populates the sidebar; search "solar" → 66,694 matches (≈1/15, correct); no console errors.

**Trade-off:** the worker still runs a full comparator sort of 1M indices every tick. It's off the main thread so the UI stays smooth, but the worker itself is still busy most of the time behind the scenes.

---

# Overall Trade-offs

Many optimizations were made to get a better user experience and maintain good performance under stress. The focus is on UI/UX. However, it adds complexity to the backend and program:
1. More detailed and stricter data formatting is now required. As mentioned in iteration 5, all token data are typed now, which means a stricter process for adding any future information on each token.
2. Higher cost of maintainability. If anything goes wrong on the web worker, it can be harder to diagnose as it is separate from the single main thread before.
3. Many UI/UX designs weren't justified for this assignment's purposes. It is not guaranteed that they are all needed. Need further confirmation via customer testing.

# Next Steps

1. Radix sort the numeric key in the worker — removes the last per-tick cost at 1M.
2. Delete the now-unused `useTokenStream.ts` / `generateTokens.ts` (replaced by the worker).
3. Conduct customer tests and user experience survey to gain ideas about features and deliberate choices.