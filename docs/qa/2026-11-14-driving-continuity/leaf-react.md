# Profiling Analysis — 76.8s session
**React Compiler:** ✗  **Hot commits:** 4 of 36 total

> **Duration columns:** `self` = this component's own render work only (exclusive).
> `w/children` = self + the entire subtree it owns (inclusive).
> Do not sum the `w/children` column — a parent's inclusive time already contains its
> children's time. Use `self` for summing; use `w/children` to understand container cost.

---
## Slow React Batches

### Commit #0 — 17.9ms 🟡 (t=8.3s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `TrendsScreen(./(tabs)/trends.js)` re-rendered — context changed

Render cascade:
- `TrendsScreen(./(tabs)/trends.js)` — 3.98ms self, 7.35ms w/children — context changed
- `HomeScreen` — 2.85ms self, 9.44ms w/children — context changed
- `View` ×24 — 0.71ms self, 21.69ms w/children — props: onLayout, style, children
- `Text` ×8 — 0.42ms self, 0.76ms w/children — props: style
- `ScrollView` ×4 — 0.3ms self, 6.25ms w/children — props: data, style, getItemLayout
- `Image` ×3 — 0.24ms self, 0.36ms w/children — props: style
- `TrendScopeControl` — 0.18ms self, 1.13ms w/children — parent re-render
- `StationCardCarousel` [forwardRef] — 0.18ms self, 1.43ms w/children — props: stations, onSelect, onShowAll
- `StationPriceCard` ×3 — 0.15ms self, 0.16ms w/children — props: station
- `VirtualizedList` — 0.15ms self, 0.91ms w/children — props: data, style, getItemLayout
- `CellRenderer` ×3 — 0.14ms self, 0.53ms w/children — props: item, ref, renderItem
- `LinearGradient` — 0.13ms self, 0.21ms w/children — props: start, end
- `AppStateProvider` — 0.1ms self, 17.9ms w/children — state: useState
- `TextView` ×3 — 0.09ms self, 0.16ms w/children — props: modifiers, onGlobalEvent
- `TopCanopy` ×2 — 0.08ms self, 0.27ms w/children — parent re-render
- _... and 27 more_
- _Shown: 9.7ms self / 17.9ms commit (54%) — 27 more components not shown. Use `profiler-commit-query mode=by_index commit_index=0` to see all._

**CPU during this commit:**
- `[Native] mapPrototypeSet` self=13.18ms total=13.18ms ([native]:0)
- `addObjectDiffToProperties` self=4.72ms total=4.72ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20446)

### Commit #1 — 4.83ms 🔵 (t=8.3s, margin)

- `HomeScreen` — 2.76ms self, 4.83ms w/children — hooks: useContext
- `View` ×12 — 0.22ms self, 4.23ms w/children — props: onLayout, style, children
- `StationPriceCard` ×3 — 0.15ms self, 0.16ms w/children — props: station
- `CellRenderer` ×3 — 0.14ms self, 0.53ms w/children — props: item, ref, renderItem
- `VirtualizedList` — 0.14ms self, 0.9ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 1.43ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.12ms self, 1.32ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.06ms self, 0.1ms w/children — props: style
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.39ms w/children — props: children
- `FlatList` — 0.05ms self, 0.94ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.47ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.07ms w/children — (mount)
- `TopCanopy` — 0.03ms self, 0.08ms w/children — parent re-render
- _... and 9 more_
- _Shown: 4ms self / 4.83ms commit (83%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=1` to see all._

### Commit #16 — 18.61ms 🟡 (t=41.5s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 2.78ms self, 10.54ms w/children — context changed
- `View` ×48 — 0.92ms self, 42.34ms w/children — props: onLayout, style, children
- `TrendsScreen(./(tabs)/trends.js)` — 0.31ms self, 5.88ms w/children — context changed
- `Text` ×11 — 0.23ms self, 0.56ms w/children — props: modifiers
- `ScrollView` ×4 — 0.18ms self, 13.94ms w/children — props: data, style, getItemLayout
- `NativeStationCard` [React.memo] — 0.18ms self, 1.1ms w/children — props: presentation
- `StationCardCarousel` [forwardRef] — 0.17ms self, 2.56ms w/children — props: stations, onSelect, onShowAll
- `StationPriceCard` ×3 — 0.16ms self, 1.27ms w/children — props: station
- `Image` ×4 — 0.14ms self, 0.22ms w/children — parent re-render
- `TextView` ×10 — 0.14ms self, 0.32ms w/children — props: modifiers, onGlobalEvent
- `CellRenderer` ×3 — 0.13ms self, 1.64ms w/children — props: item, ref, renderItem
- `TrendLeaderboardSkeleton` — 0.13ms self, 2.75ms w/children — (mount)
- `VirtualizedList` — 0.12ms self, 2.01ms w/children — props: data, style, getItemLayout
- `HStack` ×7 — 0.1ms self, 1.92ms w/children — props: children
- `HStackView` ×7 — 0.1ms self, 1.82ms w/children — props: children
- _... and 34 more_
- _Shown: 5.8ms self / 18.61ms commit (31%) — 34 more components not shown. Use `profiler-commit-query mode=by_index commit_index=16` to see all._

**CPU during this commit:**
- `[Native] stringPrototypeToLocaleLowerCase` self=15.01ms total=15.01ms ([native]:0)
- `propagateParentContextChanges` self=2.74ms total=2.74ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:20969)
- `[Host Function] completeRoot` self=0.86ms total=0.86ms ([host]:0)

### Commit #17 — 22.68ms 🟡 (t=41.6s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — hooks: useContext

Render cascade:
- `HomeScreen` — 2.98ms self, 5.08ms w/children — hooks: useContext
- `Text` ×45 — 1.09ms self, 7.06ms w/children — props: style
- `TrendsScreen(./(tabs)/trends.js)` — 0.94ms self, 22.68ms w/children — hooks: useMemo, useEffect, useRef
- `TextView` ×40 — 0.85ms self, 5.12ms w/children — props: modifiers, onGlobalEvent
- `HStackView` ×32 — 0.75ms self, 26.49ms w/children — props: modifiers, onGlobalEvent, children
- `TrendLeaderboard` [React.memo] — 0.68ms self, 14.79ms w/children — (mount)
- `View` ×26 — 0.61ms self, 92.75ms w/children — props: onLayout, style, children
- `HStack` ×32 — 0.59ms self, 27.08ms w/children — props: modifiers, children
- `Image` ×17 — 0.38ms self, 1.7ms w/children — props: style
- `VStackView` ×16 — 0.36ms self, 37.86ms w/children — (mount)
- `ObservedPriceChart` [React.memo] — 0.32ms self, 3.11ms w/children — (mount)
- `ImageView` ×14 — 0.3ms self, 1.24ms w/children — (mount)
- `VStack` ×16 — 0.29ms self, 38.15ms w/children — (mount)
- `LinearGradient` ×3 — 0.28ms self, 1.75ms w/children — props: start, end
- `ScrollView` ×4 — 0.22ms self, 41.73ms w/children — props: data, style, getItemLayout
- _... and 39 more_
- _Shown: 10.6ms self / 22.68ms commit (47%) — 39 more components not shown. Use `profiler-commit-query mode=by_index commit_index=17` to see all._

**CPU during this commit:**
- `measure` self=12.93ms total=12.93ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:40068)
- `commitPassiveMountOnFiber` self=9.75ms total=9.75ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:25121)

### Commit #18 — 2ms 🔵 (t=41.6s, margin)

- `TrendsScreen(./(tabs)/trends.js)` — 0.54ms self, 2ms w/children — hooks: useRef
- `View` ×24 — 0.42ms self, 9.27ms w/children — props: onLayout, style, children
- `HomeScreen` — 0.2ms self, 1.76ms w/children — hooks: useCallback, useEffect
- `Text` ×8 — 0.19ms self, 0.36ms w/children — props: style
- `ScrollView` ×4 — 0.18ms self, 3.47ms w/children — props: style, getItemLayout, renderItem
- `StationPriceCard` ×3 — 0.16ms self, 0.16ms w/children — parent re-render
- `VirtualizedList` — 0.15ms self, 0.89ms w/children — props: style, getItemLayout, onScrollBeginDrag
- `CellRenderer` ×3 — 0.13ms self, 0.52ms w/children — props: ref, renderItem
- `Image` ×3 — 0.11ms self, 0.17ms w/children — props: style
- `StationCardCarousel` [forwardRef] — 0.09ms self, 1.27ms w/children — parent re-render
- `TrendScopeControl` — 0.07ms self, 0.47ms w/children — parent re-render
- `LinearGradient` — 0.05ms self, 0.08ms w/children — props: start, end
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.39ms w/children — props: children
- `GlassActionButton` — 0.04ms self, 0.15ms w/children — parent re-render
- `TopCanopy` ×2 — 0.04ms self, 0.15ms w/children — parent re-render
- _... and 24 more_
- _Shown: 2.4ms self / 2ms commit (121%) — 24 more components not shown. Use `profiler-commit-query mode=by_index commit_index=18` to see all._

### Commit #33 — 17.21ms 🟡 (t=74.7s)
> 🟡 May be acceptable in production (dev mode is ~3× slower)

**Root cause:** `HomeScreen` re-rendered — context changed

Render cascade:
- `HomeScreen` — 4.35ms self, 14.38ms w/children — context changed
- `TrendsScreen(./(tabs)/trends.js)` — 0.71ms self, 2.19ms w/children — context changed
- `Text` ×29 — 0.61ms self, 1.56ms w/children — props: modifiers
- `NativeStationCard` [React.memo] ×3 — 0.43ms self, 3.29ms w/children — props: presentation
- `View` ×24 — 0.43ms self, 27.97ms w/children — props: onLayout, style, children
- `TextView` ×24 — 0.35ms self, 0.86ms w/children — props: modifiers, onGlobalEvent
- `HStack` ×19 — 0.28ms self, 5.72ms w/children — props: children
- `HStackView` ×19 — 0.28ms self, 5.44ms w/children — props: children
- `StationCardCarousel` [forwardRef] — 0.24ms self, 4.84ms w/children — props: stations, onSelect, onShowAll
- `ScrollView` ×4 — 0.19ms self, 10.34ms w/children — props: data, style, getItemLayout
- `Image` ×6 — 0.18ms self, 0.25ms w/children — parent re-render
- `StationPriceCard` ×3 — 0.17ms self, 3.46ms w/children — props: station
- `CellRenderer` ×3 — 0.16ms self, 3.9ms w/children — props: item, ref, renderItem
- `Button` ×8 — 0.13ms self, 0.35ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `VirtualizedList` — 0.13ms self, 4.27ms w/children — props: data, style, getItemLayout
- _... and 31 more_
- _Shown: 8.6ms self / 17.21ms commit (50%) — 31 more components not shown. Use `profiler-commit-query mode=by_index commit_index=33` to see all._

**CPU during this commit:**
- `?anon_0_` self=17.21ms total=17.21ms (/&platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.anthonyh.fuelup&transform.routerRoot=app&transform.engine=hermes&transform.bytecode=1&unstable_transformProfile=hermes-stable:183938)

### Commit #34 — 4.89ms 🔵 (t=74.7s, margin)

- `HomeScreen` — 2.76ms self, 4.89ms w/children — hooks: useCallback, useEffect, useContext
- `View` ×12 — 0.22ms self, 4.31ms w/children — props: onLayout, style, children
- `CellRenderer` ×3 — 0.16ms self, 0.54ms w/children — props: item, ref, renderItem
- `StationPriceCard` ×3 — 0.15ms self, 0.15ms w/children — props: station
- `VirtualizedList` — 0.14ms self, 0.91ms w/children — props: data, style, getItemLayout
- `ScrollView` ×2 — 0.12ms self, 1.44ms w/children — props: data, style, getItemLayout
- `StationCardCarousel` [forwardRef] — 0.12ms self, 1.35ms w/children — props: stations, onSelect, onShowAll
- `Image` — 0.06ms self, 0.09ms w/children — props: style
- `VirtualizedListCellContextProvider` ×3 — 0.05ms self, 0.38ms w/children — props: children
- `GlassActionButton` — 0.05ms self, 0.16ms w/children — props: onPress
- `FlatList` — 0.04ms self, 0.96ms w/children — props: data, style, keyExtractor
- `Button` ×2 — 0.04ms self, 0.1ms w/children — props: modifiers, onGlobalEvent, onButtonPress
- `FuelUpMapKitRouting` — 0.03ms self, 0.52ms w/children — props: origin, stations, onStationSelect
- `VirtualizedListContextProvider` — 0.03ms self, 0.77ms w/children — props: value, children
- `VirtualizedListContext.Provider` ×4 — 0.03ms self, 1.07ms w/children — (mount)
- _... and 9 more_
- _Shown: 4ms self / 4.89ms commit (82%) — 9 more components not shown. Use `profiler-commit-query mode=by_index commit_index=34` to see all._

---
## Top Components by Total Render Cost

| Component | Renders | Total | Avg | Max | Reason | File |
|---|---|---|---|---|---|---|
| `HomeScreen` | 7 | 18.7ms | 2.67ms | 4.35ms | hooks: useContext, useCallback, useEffect | — |
| `TrendsScreen(./(tabs)/trends.js)` | 5 | 6.5ms | 1.3ms | 3.98ms | context changed | — |
| `View` | 144 | 3ms | 0.02ms | 0.06ms | props: children, style, onLayout | — |
| `Text` | 60 | 1.6ms | 0.03ms | 0.07ms | props: modifiers, style, children | — |
| `ScrollView` | 24 | 1.3ms | 0.05ms | 0.14ms | props: children, style, getItemLayout | — |
| `StationPriceCard` | 21 | 1.1ms | 0.05ms | 0.07ms | props: station | `cluster-lab/StationPriceCard.js:8` |
| `StationCardCarousel` [forwardRef] | 7 | 1.1ms | 0.15ms | 0.24ms | props: stations, onSelect, onShowAll | — |
| `CellRenderer` | 21 | 1ms | 0.05ms | 0.06ms | props: ref, renderItem, item | — |
| `VirtualizedList` | 7 | 1ms | 0.14ms | 0.15ms | props: style, getItemLayout, onScrollBeginDrag | — |
| `Image` | 21 | 0.9ms | 0.04ms | 0.14ms | props: style | — |
| `TextView` | 43 | 0.7ms | 0.02ms | 0.03ms | props: modifiers, onGlobalEvent, text | — |
| `NativeStationCard` [React.memo] | 4 | 0.6ms | 0.15ms | 0.18ms | props: presentation | `native/NativeStationCard.js:10` |
| `TrendScopeControl` | 5 | 0.5ms | 0.1ms | 0.18ms | parent re-render | — |
| `HStack` | 29 | 0.5ms | 0.02ms | 0.04ms | props: children, modifiers | — |
| `HStackView` | 29 | 0.4ms | 0.01ms | 0.03ms | props: children, modifiers, onGlobalEvent | — |
| `Button` | 22 | 0.4ms | 0.02ms | 0.03ms | props: modifiers, onGlobalEvent, onButtonPress | — |
| `LinearGradient` | 5 | 0.4ms | 0.07ms | 0.13ms | props: start, end | — |
| `HostView` | 16 | 0.4ms | 0.02ms | 0.05ms | props: children, onLayoutContent, style | — |
| `TopCanopy` | 12 | 0.3ms | 0.03ms | 0.06ms | parent re-render | `components/TopCanopy.js:12` |
| `GlassActionButton` | 7 | 0.3ms | 0.05ms | 0.06ms | props: onPress | — |

---
## Suggested Improvements

### `HomeScreen`

**Unstable hook deps:** `useContext`, `useCallback`, `useEffect`. Check dependency arrays in `useEffect`/`useMemo` — a dependency may be recreated on every render.

### `TrendsScreen(./(tabs)/trends.js)`

**Context re-renders** — source not resolved, suggestion is pattern-based. Check the Provider component for an unmemoized value object.

### `View`

**Stabilize props:** `children`, `style`, `onLayout`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `Text`

**Stabilize props:** `modifiers`, `style`, `children`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.

### `ScrollView`

**Stabilize props:** `children`, `style`, `getItemLayout`. Likely inline objects/functions at the callsite — extract to constants or wrap with `useMemo`/`useCallback`.


> 📝 Dev mode renders are ~3× slower than production. Divide ms values by ~3 for a rough production estimate.

---
## Next Steps

Ask the user which path to take:

1. **Investigate further** — use query tools to drill into specific findings before making changes:
   - `profiler-commit-query` mode=`by_index` commit_index=17 — full breakdown of the slowest commit
   - `profiler-cpu-query` mode=`component_cpu` component_name=`HomeScreen` — CPU activity during this component's renders
   - `profiler-cpu-query` mode=`call_tree` — trace callers/callees of hot functions
2. **Implement fixes** — apply changes to the top offenders identified above, then re-profile the same scenario to measure improvement.
3. **Done for now** — save the report for reference.
