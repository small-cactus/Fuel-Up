export const CLUSTER_PRIMARY_PILL_WIDTH = 84;
export const CLUSTER_SECONDARY_PILL_WIDTH = 44;
export const CLUSTER_PILL_HEIGHT = 32;
export const CLUSTER_TOUCH_PILL_HEIGHT = CLUSTER_PILL_HEIGHT + 4;
export const CLUSTER_COLLAPSED_OVERLAP = 8;
export const CLUSTER_COLLAPSED_OFFSET = ((CLUSTER_PRIMARY_PILL_WIDTH + CLUSTER_SECONDARY_PILL_WIDTH) / 2) - CLUSTER_COLLAPSED_OVERLAP;

export const CLUSTER_GROUP_TOUCH_PADDING = 4;
export const CLUSTER_GROUP_HYSTERESIS_MULTIPLIER = 1.3;

export const CLUSTER_PARENT_MIN_WIDTH = 240;
export const CLUSTER_PARENT_MIN_HEIGHT = 80;

export const CLUSTER_MERGE_ANIMATION_BASE_MS = 220;
export const CLUSTER_MERGE_ANIMATION_PER_POINT_MS = 24;
export const CLUSTER_MERGE_ANIMATION_MAX_MS = 700;

export const CLUSTER_SPLIT_ANIMATION_BASE_MS = 210;
export const CLUSTER_SPLIT_ANIMATION_PER_POINT_MS = 20;
export const CLUSTER_SPLIT_ANIMATION_MAX_MS = 620;

export const CLUSTER_SPLIT_HANDOFF_POSITION_EPSILON = 0.5;
export const CLUSTER_SPLIT_HANDOFF_SIZE_EPSILON = 0.5;
export const CLUSTER_SPLIT_HANDOFF_CONTENT_EPSILON = 0.01;

export const CLUSTER_LAYER_KEYS = ['outside', 'accumulator', 'mergeMover', 'splitMover'];

export const CLUSTER_RUNTIME_PHASE = {
  LIVE: 'live',
  MERGE_PREP: 'merge_prep',
  MERGE_ACTIVE: 'merge_active',
  MERGE_COMPLETE: 'merge_complete',
  SPLIT_PREP: 'split_prep',
  SPLIT_ACTIVE: 'split_active',
  SPLIT_HANDOFF: 'split_handoff',
};

export const CLUSTER_PROBE_TRANSITION_TYPES = {
  MERGE_SEQUENCE_START: 'merge-sequence-start',
  MERGE_DUPLICATE_SPAWN: 'merge-duplicate-spawn',
  MERGE_ACCUMULATOR_INCREMENT: 'merge-accumulator-increment',
  MERGE_SEQUENCE_COMPLETE: 'merge-sequence-complete',
  SPLIT_SEQUENCE_START: 'split-sequence-start',
  SPLIT_DUPLICATE_SPAWN: 'split-duplicate-spawn',
  SPLIT_DUPLICATE_ARRIVE: 'split-duplicate-arrive',
  SPLIT_HANDOFF_COMPLETE: 'split-handoff-complete',
};
