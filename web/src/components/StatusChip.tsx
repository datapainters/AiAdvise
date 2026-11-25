import type { Topic } from '../api';

const LABELS: Record<Topic['status'], string> = {
  proposed: 'Proposed',
  scheduled: 'Scheduled',
  discussed: 'Discussed',
  dropped: 'Dropped',
};

export function StatusChip({ status }: { status: Topic['status'] }) {
  return <span className={`chip chip-${status}`}>{LABELS[status]}</span>;
}
