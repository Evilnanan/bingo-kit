/** Machine-readable pick errors — thrown by the pick algorithms as an
 *  internal signal when the pool can't fill a board. Call sites catch
 *  `PoolPickError` and show the generic `landing.notEnoughGoals` message. */
export type PoolPickErrorCode =
  | "balanced_not_enough"
  | "pattern_unfillable"
  | "pattern_sequence";

export class PoolPickError extends Error {
  readonly code: PoolPickErrorCode;

  constructor(code: PoolPickErrorCode) {
    super(code);
    this.name = "PoolPickError";
    this.code = code;
  }
}
