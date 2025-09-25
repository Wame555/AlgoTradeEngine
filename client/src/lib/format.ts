export function formatPct(value: number): string {
  const numeric = Number.isFinite(value) ? value : 0;
  return `${numeric.toFixed(2)}%`;
}

export function formatUsd(value: number): string {
  const numeric = Number.isFinite(value) ? value : 0;
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function trendClass(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-muted-foreground';
}
