# Local monitoring recovery — October 30, 2026

The service was last verified at 07:28 UTC before the Mac stopped creating normal
command processes. Monitoring attempts from 08:31 through 15:42 UTC failed with
`Resource temporarily unavailable (os error 35)`. Repeating the same command did
not diagnose or repair the failure. Investigation started after the user asked
why it was not being fixed.

## Cause and scoped cleanup

A minimal `/bin/sh`, `login: false`, `tty: true` execution succeeded even while
normal unified exec and the Node runtime failed. Process inspection found an
orphaned Argent 0.26.0 tool-server (PID 94581, started October 28) repeatedly
launching simulator inventory checks every ten seconds. Its background watcher
had neither a timeout nor a guard against overlapping polls.

The Xcode `simctl` shell wrapper expected CoreSimulator 1174.21, while the installed
framework reported 1174.9.2. Each inventory command invoked `xcodebuild
-runFirstLaunch` and waited. At initial inspection there were 2,638 processes,
including 1,012 checks and 1,012 first-launch children. The count reached 1,014
pairs before the spawning parent was suspended. Full command lines and parent
relationships were verified before signaling. Only that parent and the exact
1,014 simulator-check / first-launch pairs were terminated. No broad process-name
kill, unrelated build termination, reboot, or source/cache removal was used.
The original process manifest remains local in `/tmp/fuel-argent-process-incident.json`;
only aggregate evidence is committed.

All identified incident processes exited. Total process count fell to 633, then
648 with normal services restored. Normal commands and database checks worked
again. After cleanup, CoreSimulator reported 1174.21; no system file was modified
by this repair. The precise installer progression is not established by these
snapshots. A fresh bounded `xcrun simctl list devices --json` succeeded with four
runtimes and six devices. The restored Argent server returned HTTP 200 from its
local tools endpoint; repeated observations showed zero stuck inventory or
first-launch processes.

## Persistent prevention

The version-scoped package patch is applied by the existing postinstall hook.
It copies `scripts/argent/simulator-poll.cjs` beside the installed Argent bundle.
Production installs omitting the development dependency skip this patch.

- Inventory probes have an eight-second deadline and a bounded output buffer.
- On timeout, terminate the probe's own process group, then force cleanup after
  500 ms, including children whose shell wrapper has exited.
- Concurrent watcher ticks share one pending poll.
- A failed background poll disables subsequent automatic polls for that server
  lifetime and emits a diagnostic. Resolve simulator prerequisites and restart
  Argent to retry; it cannot repeatedly launch Xcode setup in the background.
- Successful polls continue normally. No Apple executables or version checks are
  bypassed, and no package upgrade was performed.

The patch is idempotent and fails visibly if a future Argent bundle no longer
matches. `npm run test:argent` passed all five tests, including a real subprocess
with a TERM-resistant descendant, excessive output, missing executable,
concurrent ticks, failure latching and successful subsequent polls. The restored
server used the patched bundle. The application suite initially had one
`fuelCacheReset` null-quote failure; the isolated seven-test file and full 165-test
suite both passed on rerun without source changes. Both results are retained;
the intermittent application-test failure is not claimed as fixed here.

## Collection during the monitoring gap

Read-only live queries verified all eight slots from 08:00 through 15:00 UTC
complete, with 72–74 requests and 141,660–145,660 lookups per hour, below the
92-request / 161,660-lookup limits. The retained eight-day window has 192 complete
hour slots, zero absent expired rows, zero partial hours and zero overdue running
hours. Older deliberately pruned metadata is not treated as missing collection.

The latest 15:00 sweep completed 72/72 batches at 15:17 UTC, covering the fixed
141,660-station inventory across the three assigned regions. The complete Trends
cache published at 15:18 UTC, with no missing trend batches or operational repair
backlog. All relevant schedules are active. Retention worker responses are
successful, no eligible raw objects or overdue complete/partial metadata remain,
and accounted archive usage is 748,844,194 / 900,000,000 bytes. The city campaign
remains complete. The old national ends_at is the preserved research boundary.

`archive-readback.json` verifies SHA-256, byte size, exact station IDs, schema and
regional provenance for one immutable successful archive per fixed region from
the complete 15:00 sweep. It is a three-batch sample, not verification of every
object or of pump prices. No provider collection was invoked, no price payloads
were rewritten, no collection controls/billing were changed, and the phone app
was not opened.

For future local exec exhaustion, try a minimal shell with PTY, inspect full
process ancestry, and stop only a proven runaway tree. Repeated failed health
checks alone are not a repair or evidence of a cloud service outage.
