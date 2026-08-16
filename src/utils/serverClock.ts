/**
 * Client-side estimation of the server's clock, used to render the shared
 * room timer with minimal drift between players — even when a player's local
 * clock is wrong or the network is slow.
 *
 * The server stamps its own clock on every `pong` (a reply to the app-level
 * heartbeat ping) and on every broadcast that carries timer/room state. Each
 * ping/pong round trip yields one offset sample:
 *
 *   offset ≈ serverTime - sentAt - RTT/2
 *
 * Following the classic NTP approach, the sample with the smallest RTT is the
 * most accurate, and it is blended with the previous estimate (0.7/0.3) so a
 * single outlier cannot jerk the display. One-way samples (serverTime stamped
 * on broadcast messages) have unknown RTT split, so they only seed the
 * estimate before the first round trip completes.
 *
 * Precision target: the timer displays whole seconds, so keeping the error
 * well under 0.5 s is enough; the estimator typically lands within ~50 ms
 * after the first round trip and re-converges on every heartbeat.
 */

const MAX_SAMPLES = 16;
/** Samples with a larger RTT are discarded (jitter spikes, stalls). */
const MAX_RTT_MS = 3000;
/** Assumed one-way latency used for one-way samples before any ping/pong. */
const DEFAULT_RTT_MS = 100;

interface Sample {
  offset: number;
  rtt: number;
  /** True for ping/pong round trips — more trustworthy than one-way samples. */
  twoWay: boolean;
}

let offsetMs = 0;
let lastRttMs = DEFAULT_RTT_MS;
let samples: Sample[] = [];

/** Record a ping/pong round trip: sentAt = client send time, serverTime =
 *  the server's clock when it replied, recvAt = client receive time. */
export function recordClockSample(
  sentAt: number,
  serverTime: number,
  recvAt: number,
): void {
  const rtt = recvAt - sentAt;
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > MAX_RTT_MS) return;
  samples.push({ offset: serverTime - sentAt - rtt / 2, rtt, twoWay: true });
  prune();
  const best = bestSample();
  if (best) blend(best.offset);
  lastRttMs = best?.rtt ?? lastRttMs;
}

/** Record a one-way server timestamp (e.g. on `state` / `timer_state`). The
 *  RTT split is unknown, so this is noisier — it only seeds the estimate
 *  before any ping/pong round trip has completed. */
export function recordOneWaySample(serverTime: number, recvAt: number): void {
  if (!Number.isFinite(serverTime)) return;
  const rtt = lastRttMs;
  samples.push({
    offset: serverTime - recvAt + rtt / 2,
    // Penalize the unknown split so two-way samples always win once they
    // exist (the penalty only matters while it is the only candidate).
    rtt: rtt * 2 + 500,
    twoWay: false,
  });
  prune();
  if (offsetMs === 0) {
    const best = bestSample();
    if (best) blend(best.offset);
  }
}

/** Estimated server clock right now (ms since epoch). */
export function estimatedServerNow(): number {
  return Date.now() + offsetMs;
}

/** Drop all estimation state (new connection / new room). */
export function resetClockEstimate(): void {
  offsetMs = 0;
  lastRttMs = DEFAULT_RTT_MS;
  samples = [];
}

function prune(): void {
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function bestSample(): Sample | null {
  if (samples.length === 0) return null;
  let best = samples[0]!;
  for (const s of samples) {
    if (s.rtt < best.rtt) best = s;
  }
  return best;
}

/** Blend a new estimate into the running one; the first sample wins fully. */
function blend(newOffset: number): void {
  if (offsetMs === 0) {
    offsetMs = newOffset;
    return;
  }
  offsetMs = offsetMs * 0.7 + newOffset * 0.3;
}
