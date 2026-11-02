/** Same 30-second boundary as existing metadata requests. This is a UI
 * confirmation window, never a server job deadline, failure or cancellation. */
export const CONVERSATION_CONFIRMATION_MS = 30_000;
export type ReportConfirmation = {
  deadline: number;
  pending: boolean;
  unconfirmed: boolean;
};

/** Phase, request and revision updates cannot silently extend a confirmation
 * window. A late result may update reads but never resumes a paused send. */
export function observeReportContinuation(
  previous: ReportConfirmation | null,
  pending: boolean,
  readStartedAt: number,
  now: number,
): ReportConfirmation | null {
  const deadline = previous?.deadline ?? readStartedAt + CONVERSATION_CONFIRMATION_MS;
  const unconfirmed = previous?.unconfirmed === true || (previous !== null && now >= deadline);
  if (!pending && !unconfirmed) return null;
  return { deadline, pending, unconfirmed: unconfirmed || now >= deadline };
}
