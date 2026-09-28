# Glass Lab

The second native tab is a full-bleed Apple map with station price pills. It shares
the fuel service cache, but its rendering and animation are independent of Home.

`ClusterLabMapView` owns MapKit and the display link. `ClusterLabGeometry` performs
screen-space spatial hashing and contact hysteresis. `ClusterLabRenderer` owns
station identity, projection, reversible motion, and atomic handoffs.
`ClusterLabGlass` uses the installed Callstack library's public Swift glass views.
The shared native container uses Apple's `UIGlassContainerEffect`; it does not
draw an imitation or place glass in MapKit annotation snapshots.

Only visible stations and a 160-point approach margin participate. One container
extends 256 points beyond all map edges, including refraction and badge travel.
Settled groups retain a price and count view, not hidden views for each member.
The first arriving mover becomes the count view in place. Further movers are
removed in the same transaction that increments the count. Splitting materializes
the count duplicate at exactly the count's location, then reuses that view as its
final price pill. Position, dimensions, and content share the same progression.
Glass and glass ancestors always keep alpha 1; only label content crossfades.

Motion is retargeted from its current map coordinate and screen offset. Its
80–220 ms duration follows measured camera velocity and elapsed movement time.
Camera completion shortens remaining travel to 80 ms without changing the current
pose. An elapsed-time ease-out curve adds a distance-scaled rebound capped at three
points. There is no fixed points-per-frame speed limit or trailing exponential tail. MapKit's
projection is read natively during camera changes, including rotation; there is no
JS camera-event loop. The display link sleeps when settled, unfocused, detached,
or backgrounded. Reduced Motion resolves transitions immediately. Older systems
use plain rounded system-background pills.

## Verification

Build after installing pods because the map is native Swift:

```
cd ios && pod install
```

Run with a development build and Metro on the selected simulator:

```
node --test tests/clusterLabGeometry.test.cjs
FUELUP_SIMULATOR_UDID=<udid> node --test tests/clusterLabProbe.integration.test.cjs
```

The debug deep link `fuelup:///cluster-lab?clusterLabProbe=<unique-token>` runs
stepped and one-shot MapKit zooms using a deterministic six-station fixture. It
exports actual native view frames, transition events, and reset geometry to
`Documents/cluster-lab-probe.json`, then restores real stations and the camera.
Leaving the tab cancels the probe and reports cancellation as a failure.

The native gate checks completion within 300 ms (including scheduling allowance),
exact handoff alignment, container bounds, view count, and reset geometry. It
reports actual frame travel rather than restricting gesture speed. Pure Swift
checks exercise timing and rebound across travel distances and frame rates.
This is additional coverage. It does not replace or weaken the existing Home
`tests/clusterProbe.integration.test.cjs` gate or its JSON export.
