"""Synthetic safety checks; no private research data required."""
import unittest

from evaluateStopEvidence import past_correction_matches, prepare, replay, summarize
from stopEvidence import StopEvidence


def event(kind, t, **payload):
    return {"id": str(t), "kind": kind, "recordedAt": t,
            "participantId": "synthetic", "payload": payload}


def fix(t, meters=10, accuracy=5, speed=0, **extra):
    return event("location", t, timestamp=t, receivedAt=t, latitude=0,
                 longitude=meters / 111195, accuracy=accuracy, speed=speed,
                 simulated=False, **extra)


class StopEvidenceTests(unittest.TestCase):
    def test_core_needs_time_coverage_and_freshness(self):
        s = StopEvidence()
        s.ingest(fix(100))
        self.assertFalse(s.decisions(100, 0, (0, 0))["core_65"])
        s.ingest(fix(115))
        s.ingest(fix(130))
        self.assertTrue(s.decisions(130, 0, (0, 0))["core_65"])
        self.assertFalse(s.decisions(161, 0, (0, 0))["core_65"])

    def test_core_includes_uncertainty(self):
        s = StopEvidence()
        for t in (100, 115, 130):
            s.ingest(fix(t, meters=60, accuracy=10))
        self.assertFalse(s.decisions(130, 0, (0, 0))["core_65"])
        self.assertTrue(s.decisions(130, 0, (0, 0))["core_80"])

    def test_late_fix_and_motion_history_cannot_backdate(self):
        s = StopEvidence()
        for t in (100, 115, 130):
            f = fix(t)
            f["recordedAt"] = 200
            s.ingest(f)
        s.ingest(event("diagnostic", 200, source="apple_motion_history",
                       activities=[{"timestamp": 120, "walking": True, "confidence": 2}]))
        self.assertFalse(s.decisions(130, 0, (0, 0))["core_65"])
        self.assertFalse(s.decisions(130, 0, (0, 0))["walking"])
        self.assertTrue(s.decisions(200, 0, (0, 0))["walking"])

    def test_mixed_motion_and_missing_motion_are_not_support(self):
        s = StopEvidence()
        self.assertFalse(s.signals(200, 0, (0, 0))["motion_support"])
        s.ingest(event("motion", 200, timestamp=200, walking=True,
                       stationary=True, automotive=True, confidence=2))
        self.assertFalse(s.signals(200, 0, (0, 0))["motion_support"])

    def test_movement_invalid_fix_and_gap_break_continuity(self):
        for middle in (fix(150, speed=4), fix(150, accuracy=100)):
            s = StopEvidence()
            for t in range(100, 201, 10):
                s.ingest(middle if t == 150 else fix(t))
            self.assertFalse(s.decisions(200, 0, (0, 0))["continuous_90"])
        s = StopEvidence()
        for t in (100, 110, 190, 200):
            s.ingest(fix(t))
        self.assertFalse(s.decisions(200, 0, (0, 0))["continuous_90"])

    def test_duplicate_fixes_do_not_supply_coverage(self):
        s = StopEvidence()
        for _ in range(10):
            s.ingest(fix(100))
        self.assertFalse(s.decisions(100, 0, (0, 0))["core_65"])

    def test_future_fix_pedometer_and_label_do_not_enable_gate(self):
        s = StopEvidence()
        for t in (200, 215, 230):
            s.ingest(fix(t))
        s.ingest(event("visit_pedometer", 100, steps=100))
        s.ingest(event("visit_label", 100, label="fueled"))
        self.assertFalse(s.decisions(130, 0, (0, 0))["core_65"])
        self.assertFalse(s.decisions(130, 0, (0, 0))["walking"])

    def test_three_minute_boundary_and_terminal_cutoff(self):
        target = {"start": 100, "end": 400, "station": (0, 0),
                  "observation_known": 100,
                  "events": [fix(t) for t in range(100, 401, 10)]}
        self.assertEqual(replay(target)["alerts"]["core_65"], 180)
        target["end"] = 279
        self.assertEqual(replay(target)["alerts"], {})

    def test_nonfuel_is_positive_and_participant_visits_are_namespaced(self):
        events = []
        for person, label in (("a", "fueled"), ("b", "not_fueling"), ("c", "not_a_stop")):
            es = [
                event("visit_observation", 100, visitId="same", startedAt=100, stationId="s"),
                event("visit_departure", 400, visitId="same", lastInsideAt=390),
                event("visit_label", 500, visitId="same", label=label),
            ]
            for e in es:
                e["participantId"] = person
            events.extend(es)
        targets, _ = prepare({"events": events, "stations": [
            {"id": "s", "latitude": 0, "longitude": 0}]})
        self.assertEqual(len(targets), 3)
        for t in targets:
            t["replay"] = {"alerts": {"v2": 180, "core_65": 180}}
        result = summarize(targets)["core_65"]
        self.assertEqual(result["labels"]["not_fueling"]["prompted"], 1)
        self.assertEqual(result["additional_delay_seconds"]["median"], 0)

    def test_place_memory_uses_only_prior_received_labels_for_same_person(self):
        old = {"start": 100, "end": 300, "person": "a", "label": "not_a_stop",
               "events": [fix(t) for t in (100, 150, 200)],
               "label_events": [event("visit_label", 900, label="not_a_stop")],
               "replay": {"alerts": {"v2": 180}}}
        new = {"start": 500, "end": 800, "person": "a", "label": "fueled",
               "events": [fix(t) for t in (500, 550, 600)], "label_events": [],
               "replay": {"alerts": {"v2": 180}}}
        self.assertEqual(past_correction_matches([old, new])["30"]["fueled"], 0)
        old["label_events"][0]["recordedAt"] = 400
        self.assertEqual(past_correction_matches([old, new])["30"]["fueled"], 1)
        new["person"] = "b"
        self.assertEqual(past_correction_matches([old, new])["30"]["fueled"], 0)


if __name__ == "__main__":
    unittest.main()
