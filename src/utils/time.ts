/** Display source seconds without floating-point noise; keep millisecond precision. */
export function secondsLabel(seconds: number): string {
  return Number(seconds.toFixed(3)).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}
