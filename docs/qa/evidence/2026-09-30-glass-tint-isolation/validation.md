# Native glass tint isolation — September 30, 2026

The old native layout pooled unrelated neutral prices with the highlighted price
in 427 of 1,646 recorded frames. Their requested tint was still nil. This proves
a shared compositor path, not the cause of the phone's extra green pixels.

The change separates highlighted and neutral families into reusable native
container pools. A neutral pill leaving a highlighted composite reapplies its
material once. Ordinary frames do not recreate glass effects. Intended cluster
members still share a container and morph together.

Validation on the iPhone 13 mini simulator, iOS 26.5:

- Native Glass Lab integration suite: all 16 tests passed, unchanged motion limits.
- Swift grouping model regression passed, including 1,000 distant islands using
  two native groups and preserving domain identity when the winning station changes.
- Rapid native probe: 50 cycles / 100 camera requests; 2,217 recorded frames,
  121 splits and 170 merges. No unrelated neutral family shared the highlighted
  native container. Maximum three native containers, one repair per pill, and
  three tint writes per pill in this fixture. Zero tint writes in the settled
  final half-second.
- The main transition probe passed with 1,644 frames, 113 transitions, 25 native
  connection frames during committed merges, and a longest handoff of 232ms.
- Connected +1 travel remained 17.03pt with 149 intermediate frames. All six
  overview returns remained stable. Both contact regression arrangements passed.
- Simulator Debug and signed device Release builds succeeded.
- Release installed in the background on the connected iPhone 18 Pro Max,
  iOS 27.0. The phone app was not foregrounded or visually inspected.

[Probe summaries](probe-summary.json) record actual UIKit container membership
and material-write counts. These are not CPU/GPU benchmarks.

The [recorded changed-winner frame](changed-winner.png) shows the former $3.10
winner neutral and the new $2.99 winner green. The recording was inspected across
repeated zooms; persistent extra green prices were not observed on this simulator.
The recording begins a few seconds into the rapid probe and also contains the
following contact fixture; it does not cover every initial camera request.
It is local and Git-ignored:
[zoom recording](/Users/anthonyh/Desktop/Fuel%20Up/.argent/recordings/screen-recording-0EE3DFFD-087C-483C-A651-C55C59A719A3-1790784970016.mp4).
The React card is not driven by the synthetic native probe prices. The unrelated
development notification toast is visible in the recording.

The required legacy Home probe was also run unchanged during this task and
timed out after 129.2s waiting for token `probe-test-1790784127781`. Home's
`ENABLE_CLUSTER_MERGE_TRANSITIONS` is false. That separate gate is not passing;
this change neither disables it nor relaxes its checks. The earlier 138 normal
unit tests passed; no JavaScript product logic changed afterward.

Remaining validation: reproduce and inspect rendered tint on the physical phone's
iOS 27.0. The iOS 26.5 simulator passing does not prove the reported phone-specific
appearance is resolved.
