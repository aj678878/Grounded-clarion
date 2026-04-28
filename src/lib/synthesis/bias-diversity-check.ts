import type { BiasLean, DiscoveredSource } from './schema';

const LEFT_CLUSTER = new Set<BiasLean>(['left', 'lean-left', 'center-left']);
const RIGHT_CLUSTER = new Set<BiasLean>(['right', 'lean-right', 'center-right']);

function classifyCluster(lean: BiasLean): 'left' | 'right' | 'center' | 'unknown' {
  if (LEFT_CLUSTER.has(lean)) return 'left';
  if (RIGHT_CLUSTER.has(lean)) return 'right';
  if (lean === 'center') return 'center';
  return 'unknown';
}

function dominantDirectionalCluster(
  sources: DiscoveredSource[]
): 'left' | 'right' | null {
  const counts = { left: 0, right: 0 };
  for (const source of sources) {
    const cluster = classifyCluster(source.bias_lean);
    if (cluster === 'left') counts.left += 1;
    if (cluster === 'right') counts.right += 1;
  }

  const threshold = Math.max(4, sources.length - 1);
  if (counts.left >= threshold) return 'left';
  if (counts.right >= threshold) return 'right';
  return null;
}

function isOpposingOrCenter(candidate: DiscoveredSource, cluster: 'left' | 'right'): boolean {
  const candidateCluster = classifyCluster(candidate.bias_lean);
  if (candidateCluster === 'center') return true;
  return cluster === 'left' ? candidateCluster === 'right' : candidateCluster === 'left';
}

function findReplacementIndex(selected: DiscoveredSource[], cluster: 'left' | 'right'): number {
  for (let i = selected.length - 1; i >= 0; i--) {
    if (classifyCluster(selected[i].bias_lean) === cluster) {
      return i;
    }
  }
  return -1;
}

export function applyBiasDiversityCheck(input: {
  selected: DiscoveredSource[];
  candidates: DiscoveredSource[];
}): {
  selected: DiscoveredSource[];
  warning: boolean;
  swapped: boolean;
} {
  const dominant = dominantDirectionalCluster(input.selected);
  if (!dominant) {
    return { selected: input.selected, warning: false, swapped: false };
  }

  const replacement = input.candidates.find(
    (candidate) =>
      !input.selected.some((selected) => selected.url === candidate.url) &&
      isOpposingOrCenter(candidate, dominant)
  );

  if (!replacement) {
    return { selected: input.selected, warning: true, swapped: false };
  }

  const swapIndex = findReplacementIndex(input.selected, dominant);
  if (swapIndex === -1) {
    return { selected: input.selected, warning: true, swapped: false };
  }

  const next = [...input.selected];
  next[swapIndex] = {
    ...replacement,
    source_id: next[swapIndex].source_id,
  };

  return { selected: next, warning: false, swapped: true };
}
