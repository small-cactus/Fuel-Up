#!/opt/homebrew/bin/python3
import argparse
import json
from collections import defaultdict

import torch
import torch.nn as nn
import torch.optim as optim


HISTORY_LEVELS = ["none", "light", "rich"]


def clamp(value, low, high):
    return max(low, min(high, value))


def get_device():
    if torch.backends.mps.is_available():
      return torch.device("mps")
    return torch.device("cpu")


class PairwiseMLP(nn.Module):
    def __init__(self, input_size, hidden_sizes=(128, 64)):
        super().__init__()
        layers = []
        prev = input_size
        for size in hidden_sizes:
            layers.append(nn.Linear(prev, size))
            layers.append(nn.ReLU())
            prev = size
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


def build_pairwise_feature(preferred, other):
    diff = [float(a) - float(b) for a, b in zip(preferred, other)]
    return preferred + other + diff


def train_history_models(examples, device, epochs=18, batch_size=512, lr=1e-3):
    models = {}
    feature_size = len(examples[0]["features"]) if examples else 0
    for history_level in HISTORY_LEVELS:
        bucket = [example for example in examples if example["historyLevel"] == history_level]
        if not bucket:
            models[history_level] = None
            continue
        features = torch.tensor([example["features"] for example in bucket], dtype=torch.float32, device=device)
        labels = torch.tensor([example["label"] for example in bucket], dtype=torch.float32, device=device)
        model = PairwiseMLP(feature_size).to(device)
        optimizer = optim.Adam(model.parameters(), lr=lr)
        criterion = nn.BCEWithLogitsLoss()
        for _ in range(epochs):
            permutation = torch.randperm(features.size(0), device=device)
            for start in range(0, features.size(0), batch_size):
                index = permutation[start:start + batch_size]
                batch_features = features[index]
                batch_labels = labels[index]
                optimizer.zero_grad()
                logits = model(batch_features)
                loss = criterion(logits, batch_labels)
                loss.backward()
                optimizer.step()
        models[history_level] = model
    return models


def candidate_score(model, candidates, candidate_index, device):
    if model is None:
        return 0.0
    if len(candidates) <= 1:
        return 1.0
    preferred = candidates[candidate_index]["features"]
    pairwise_rows = []
    for other_index, other in enumerate(candidates):
        if other_index == candidate_index:
            continue
        pairwise_rows.append(build_pairwise_feature(preferred, other["features"]))
    tensor = torch.tensor(pairwise_rows, dtype=torch.float32, device=device)
    with torch.no_grad():
        probs = torch.sigmoid(model(tensor))
    return float(probs.mean().item())


def summarize_routes(route_results):
    hidden_routes = [route for route in route_results if route["expectsTrigger"]]
    no_fuel_routes = [route for route in route_results if not route["expectsTrigger"]]
    tp = sum(1 for route in hidden_routes if route["firstTriggerCorrect"])
    fp = sum(1 for route in no_fuel_routes if route["triggered"])
    fn = len(hidden_routes) - tp
    tn = len(no_fuel_routes) - fp
    wrong_station = sum(1 for route in hidden_routes if route["triggered"] and not route["firstTriggerCorrect"])
    correct_count = sum(1 for route in route_results if route["correct"])
    trigger_distances = [route["triggerDistance"] for route in hidden_routes if route["firstTriggerCorrect"] and route["triggerDistance"] is not None]
    precision = (tp / (tp + fp)) if (tp + fp) else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) else 0.0
    fpr = (fp / (fp + tn)) if (fp + tn) else 0.0
    return {
        "accuracy": round((correct_count / len(route_results)) * 100) if route_results else 0,
        "precision": round(precision * 100),
        "recall": round(recall * 100),
        "falsePositiveRate": round(fpr * 100),
        "silentRateWhenNoFuel": round((tn / (fp + tn)) * 100) if (fp + tn) else 0,
        "wrongStationRate": round((wrong_station / (tp + fn)) * 100) if (tp + fn) else 0,
        "avgCorrectTriggerDistanceMeters": round(sum(trigger_distances) / len(trigger_distances)) if trigger_distances else 0,
        "precisionFirstScore": round((((tp * 1) + (tn * 1) - (fp * 2) - (fn * 1)) / len(route_results)) * 100) if route_results else 0,
        "hiddenIntentCount": tp + fn,
        "noFuelCount": fp + tn,
        "historyBuckets": None,
    }


def evaluate(event_replays, models, gate_thresholds, station_thresholds, station_margins, device):
    grouped = defaultdict(list)
    for replay in event_replays:
        grouped[replay["routeReplayId"]].append(replay)

    route_results = []
    for route_replay_id, replays in grouped.items():
        replays = sorted(replays, key=lambda replay: replay["eventIndex"])
        history_level = replays[0]["historyLevel"]
        gate_threshold = float(gate_thresholds.get(history_level, gate_thresholds.get("default", 0.0)))
        station_threshold = float(station_thresholds.get(history_level, station_thresholds.get("default", 1.0)))
        station_margin = float(station_margins.get(history_level, station_margins.get("default", 1.0)))
        model = models.get(history_level)
        allowed = None
        for replay in replays:
            if float(replay["gateScore"]) < gate_threshold:
                continue
            candidates = replay["candidates"]
            if not candidates:
                continue
            scored = []
            for index, candidate in enumerate(candidates):
                score = candidate_score(model, candidates, index, device)
                scored.append({**candidate, "score": score})
            scored.sort(key=lambda candidate: candidate["score"], reverse=True)
            top = scored[0]
            second = scored[1] if len(scored) > 1 else None
            margin = float(top["score"]) - float(second["score"] if second else 0.0)
            if float(top["score"]) >= station_threshold and margin >= station_margin:
                allowed = {
                    "stationId": top["stationId"],
                    "triggerDistance": replay.get("triggerDistance"),
                }
                break

        expects_trigger = bool(replays[0]["expectsTrigger"])
        target_station_id = replays[0]["targetStationId"]
        triggered = allowed is not None
        first_correct = bool(triggered and expects_trigger and allowed["stationId"] == target_station_id)
        route_results.append({
            "routeReplayId": route_replay_id,
            "historyLevel": history_level,
            "expectsTrigger": expects_trigger,
            "triggered": triggered,
            "firstTriggerCorrect": first_correct,
            "correct": first_correct if expects_trigger else (not triggered),
            "triggerDistance": allowed["triggerDistance"] if allowed else None,
            "triggeredStationId": allowed["stationId"] if allowed else None,
            "targetStationId": target_station_id,
        })
    return summarize_routes(route_results)


def tune_thresholds(validation_event_replays, models, gate_thresholds, max_fpr, device):
    station_thresholds = {}
    station_margins = {}
    for history_level in HISTORY_LEVELS:
        best = None
        bucket = [replay for replay in validation_event_replays if replay["historyLevel"] == history_level]
        for threshold_step in range(10, 91, 2):
            for margin_step in range(0, 31, 2):
                thresholds = {history_level: threshold_step / 100.0, "default": 0.95}
                margins = {history_level: margin_step / 100.0, "default": 0.5}
                scorecard = evaluate(bucket, models, gate_thresholds, thresholds, margins, device)
                if scorecard["falsePositiveRate"] > max_fpr:
                    continue
                key = (
                    scorecard["recall"],
                    scorecard["precisionFirstScore"],
                    scorecard["accuracy"],
                    -scorecard["wrongStationRate"],
                    -scorecard["falsePositiveRate"],
                    threshold_step,
                    margin_step,
                )
                if best is None or key > best[0]:
                    best = (key, threshold_step / 100.0, margin_step / 100.0)
        station_thresholds[history_level] = best[1] if best else 0.95
        station_margins[history_level] = best[2] if best else 0.5
    station_thresholds["default"] = 0.95
    station_margins["default"] = 0.5
    return station_thresholds, station_margins


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    args = parser.parse_args()

    with open(args.dataset, "r") as handle:
        dataset = json.load(handle)

    device = get_device()
    models = train_history_models(
        dataset["train"]["pairwiseExamples"],
        device,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
    )
    gate_thresholds = dataset["metadata"]["gateThresholds"]
    station_thresholds, station_margins = tune_thresholds(
        dataset["validation"]["eventReplays"],
        models,
        gate_thresholds,
        dataset["metadata"]["maxFalsePositiveRate"],
        device,
    )
    validation_scorecard = evaluate(
        dataset["validation"]["eventReplays"],
        models,
        gate_thresholds,
        station_thresholds,
        station_margins,
        device,
    )
    test_scorecard = evaluate(
        dataset["test"]["eventReplays"],
        models,
        gate_thresholds,
        station_thresholds,
        station_margins,
        device,
    )
    print(json.dumps({
        "device": str(device),
        "metadata": dataset["metadata"],
        "stationThresholds": station_thresholds,
        "stationMargins": station_margins,
        "validation": validation_scorecard,
        "test": test_scorecard,
    }, indent=2))


if __name__ == "__main__":
    main()
