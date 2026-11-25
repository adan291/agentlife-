/** Token bucket: `rate` tokens per second, burst of `rate`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly clock: () => number;
  // No parameter properties: node's type stripping does not support them.
  constructor(rate: number, clock: () => number) {
    this.rate = rate;
    this.clock = clock;
    this.tokens = rate;
    this.last = clock();
  }
  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** At most `limit` events in any `windowMs`: the sliding window behind the rate of bug reports. */
export class SlidingWindow {
  private readonly times: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  constructor(limit: number, windowMs: number, clock: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }
  take(): boolean {
    const now = this.clock();
    while (this.times.length > 0 && now - this.times[0]! >= this.windowMs) this.times.shift();
    if (this.times.length >= this.limit) return false;
    this.times.push(now);
    return true;
  }
}
