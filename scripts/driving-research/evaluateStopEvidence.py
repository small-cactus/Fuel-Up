"""Replay labeled stop windows, with aggregate-only output.

Usage: python3 evaluateStopEvidence.py PRIVATE_SNAPSHOT.json REPORT.json
Snapshot: events with decoded payload and participantId; stations with id/lat/lon.
Static current station coordinates and original station associations are used:
this evaluates prompt suppression, NOT station discovery or end-to-end recall.
"""
import collections
import argparse
import datetime
import hashlib
import json
import statistics
from pathlib import Path

from backtestAnticipation import available, distance, valid_fix
from stopEvidence import POLICIES, StopEvidence

CUTOFF = datetime.datetime(2026, 10, 14, tzinfo=datetime.timezone.utc).timestamp()
LABELS = ("fueled", "not_fueling", "not_a_stop")


def prepare(snapshot):
    people = collections.defaultdict(list)
    visits = collections.defaultdict(list)
    for e in snapshot["events"]:
        people[e["participantId"]].append(e)
        if "visitId" in e["payload"]:
            visits[e["participantId"], e["payload"]["visitId"]].append(e)
    stations = {str(s["id"]): (s["latitude"], s["longitude"]) for s in snapshot["stations"]}
    for es in people.values():
        es.sort(key=lambda e: (available(e), e["id"]))
    targets = []
    excluded = collections.Counter()
    for (person, vid), es in visits.items():
        es.sort(key=lambda e: (available(e), e["id"]))
        labels = [e for e in es if e["kind"] == "visit_label"]
        if not labels:
            excluded["unlabeled_visits"] += 1
            continue
        label = labels[-1]["payload"]["label"]
        if label not in LABELS:
            excluded["nondefinitive_label"] += 1
            continue
        observations = [e for e in es if e["kind"] == "visit_observation"]
        ends = [e for e in es if e["kind"] in ("visit_departure", "visit_gap")]
        if not observations or not ends:
            excluded["missing_observation_or_terminal"] += 1
            continue
        first = observations[0]
        p = first["payload"]
        if str(p["stationId"]) not in stations:
            excluded["missing_station"] += 1
            continue
        start = p["startedAt"]
        end = min(available(ends[0]), start + 1800)
        window = [e for e in people[person] if start <= available(e) <= end + 30]
        targets.append({
            "person": person, "label": label, "start": start, "end": end,
            "label_events": labels,
            "station": stations[str(p["stationId"])], "events": window,
            "observation_known": available(first),
            "partition": "earlier" if start < CUTOFF else "later",
            "actual_prompt": any(e["kind"] == "visit_prompt" and e["payload"].get("status") == "scheduled" for e in es),
            "terminal_dwell": max(e["payload"].get("lastInsideAt", start) - start for e in ends),
            "window_truncated": available(ends[0]) > start + 1800,
            "pedometer_before_180": any(e["kind"] == "visit_pedometer" and available(e) <= start + 180 for e in es),
        })
    return targets, dict(excluded)


def replay(target):
    # Mirror the native v2 detector with the original associated station, no
    # synthetic insertion of the observation's unrecorded first GPS fix.
    active = None
    last_timestamp = 0
    evidence = StopEvidence()
    alerts = {}
    accepted_fixes = 0
    for e in target["events"]:
        now = available(e)
        evidence.ingest(e)
        if e["kind"] != "location" or not valid_fix(e):
            continue
        p = e["payload"]
        t = p["timestamp"]
        if t < target["start"] or t <= last_timestamp:
            continue
        last_timestamp = t
        accepted_fixes += 1
        if active is not None and t - active["last"] > 180:
            break
        d = distance((p["latitude"], p["longitude"]), target["station"])
        inside = d + p["accuracy"] <= 110 and 0 <= p["speed"] < 2.5
        if active is not None:
            if inside:
                active["last"] = t
                active["samples"] += 1
            elif d - p["accuracy"] > 180:
                break
        elif inside:
            active = {"start": t, "last": t, "samples": 1}
        if (active is None or not inside or active["samples"] < 3
                or active["last"] - active["start"] < 180
                or now < target["observation_known"] or now > target["end"]):
            continue
        for name, decision in evidence.decisions(now, active["start"], target["station"]).items():
            if decision and name not in alerts:
                alerts[name] = now - target["start"]
    return {"alerts": alerts, "accepted_fixes": accepted_fixes}


def summarize(targets):
    out = {}
    for name in POLICIES:
        buckets = {}
        delays = []
        for label in LABELS:
            ts = [t for t in targets if t["label"] == label]
            prompted = [t for t in ts if name in t["replay"]["alerts"]]
            buckets[label] = {"total": len(ts), "prompted": len(prompted),
                              "silent": len(ts) - len(prompted)}
            if label != "not_a_stop":
                delays.extend(t["replay"]["alerts"][name] - t["replay"]["alerts"]["v2"] for t in prompted)
        out[name] = {"labels": buckets, "additional_delay_seconds": {
            "median": round(statistics.median(delays), 1) if delays else None,
            "max": round(max(delays), 1) if delays else None,
        }}
    return out


def past_correction_matches(targets):
    """Exploratory diagnostic, not a notification policy or station blacklist.

    Can an earlier, already received correction explain a later prompt at the
    same place? Use only first-three-minute centers and same-person history.
    The distance screen deliberately omits uncertainty, making this an optimistic
    upper bound on opportunities for a stricter place-memory implementation.
    """
    centers = []
    for t in targets:
        fs = [e["payload"] for e in t["events"]
              if e["kind"] == "location" and valid_fix(e)
              and available(e) <= t["start"] + 180
              and 0 <= e["payload"]["speed"] < 2.5]
        if len(fs) >= 3:
            centers.append((t, (statistics.median(p["latitude"] for p in fs),
                                statistics.median(p["longitude"] for p in fs))))
    result = {str(radius): {label: 0 for label in LABELS} for radius in (20, 30, 50)}
    for t, point in centers:
        delay = t["replay"]["alerts"].get("v2")
        if delay is None:
            continue
        now = t["start"] + delay
        for radius in (20, 30, 50):
            prior_labels = []
            for previous, previous_point in centers:
                if (previous["person"] != t["person"]
                        or previous["start"] + 180 >= t["start"]
                        or previous["end"] >= t["start"]
                        or distance(point, previous_point) > radius):
                    continue
                known = [e for e in previous["label_events"] if available(e) < now]
                if known:
                    prior_labels.append(max(known, key=available))
            if prior_labels and max(prior_labels, key=available)["payload"]["label"] == "not_a_stop":
                result[str(radius)][t["label"]] += 1
    return result


def evaluate(snapshot):
    targets, excluded = prepare(snapshot)
    for t in targets:
        t["replay"] = replay(t)
    groups = {name: [t for t in targets if t["partition"] == name]
              for name in ("earlier", "later")}
    return {
        "exportedAt": snapshot.get("exportedAt"),
        "descriptive_period_cutoff_utc": "2026-10-14T00:00:00Z",
        "excluded": excluded,
        "labeled_visits": len(targets),
        "participants_with_labels": len({t["person"] for t in targets}),
        "window_truncations": sum(t["window_truncated"] for t in targets),
        "pedometer_available_by_three_minutes": sum(t["pedometer_before_180"] for t in targets),
        "no_saved_accepted_fixes": sum(t["replay"]["accepted_fixes"] == 0 for t in targets),
        "actual_scheduled_prompts": dict(collections.Counter(t["label"] for t in targets if t["actual_prompt"])),
        "past_correction_matches_by_radius_m": past_correction_matches(targets),
        "all": summarize(targets),
        "partitions": {name: {"visits": len(ts), "people": len({t["person"] for t in ts}), "policies": summarize(ts)}
                       for name, ts in groups.items()},
        "participant_groups": [
            {"group": i + 1, "visits": len(ts), "policies": summarize(ts)}
            for i, ts in enumerate(
                sorted(([t for t in targets if t["person"] == p] for p in {t["person"] for t in targets}),
                       key=lambda ts: (-len(ts), min(t["start"] for t in ts))))],
        "limitations": [
            "Small, self-selected participant labels; unconfirmed visits are not negatives.",
            "Replays downsampled saved fixes at original station associations and current station coordinates.",
            "No full callback stream, full catalog-selection replay, or unseen-stop recall claim.",
            "Exploratory development comparison; geometry gates were added after inspecting first-stage outcomes. Neither period is an untouched holdout.",
            "Motion history is available only at receipt; post-departure pedometer evidence cannot justify earlier prompts.",
            "Confirmed non-fuel stops are positives for stop detection.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--native-windows", type=Path,
                        help="PRIVATE output for the Swift baseline cross-check; contains locations")
    args = parser.parse_args()
    source, output = args.source, args.output
    raw = source.read_bytes()
    snapshot = json.loads(raw)
    report = evaluate(snapshot)
    report["input_sha256"] = hashlib.sha256(raw).hexdigest()
    output.write_text(json.dumps(report, indent=2) + "\n")
    if args.native_windows:
        targets, _ = prepare(snapshot)
        windows = [{
            "station": {"id": "associated", "name": "Station",
                        "latitude": t["station"][0], "longitude": t["station"][1]},
            "start": t["start"], "end": t["end"],
            "observationKnown": t["observation_known"],
            "samples": [{"available": available(e), "fix": e["payload"]} for e in t["events"]
                        if e["kind"] == "location" and valid_fix(e)],
            "expectedDelay": replay(t)["alerts"].get("v2"),
        } for t in targets]
        args.native_windows.touch(mode=0o600)
        args.native_windows.chmod(0o600)
        args.native_windows.write_text(json.dumps(windows))
    print(json.dumps({"labeled_visits": report["labeled_visits"], "all": report["all"]}, indent=2))
