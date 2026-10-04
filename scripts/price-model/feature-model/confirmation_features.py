"""Use the unchanged first experiment feature functions for a later development slice."""
import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'prospective'))
import features

p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--from-hour',type=float,required=True);a=p.parse_args()
assert 72<=a.from_hour<120
# Only the example selection boundary changes. Historical context is still available,
# and feature formulas remain exactly those used for the training examples.
features.TRAIN_END=a.from_hour
features.split_for=lambda at,target_at: 1 if a.from_hour<=at<target_at<120 else -1
features.build(a.root)
