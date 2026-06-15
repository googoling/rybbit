import { describe, expect, it } from "vitest";
import { computeScrollBuckets } from "./scrollMath.js";

describe("computeScrollBuckets", () => {
  it("returns zeroed buckets for no data", () => {
    const result = computeScrollBuckets([]);
    expect(result.totalSessions).toBe(0);
    expect(result.averageScrollDepth).toBe(0);
    expect(result.buckets).toHaveLength(21); // 0..100 step 5
    expect(result.buckets.every(b => b.reach === 0)).toBe(true);
    expect(result.buckets[0].depth).toBe(0);
    expect(result.buckets[20].depth).toBe(100);
  });

  it("reports 100% reach at every band when all sessions hit the bottom", () => {
    const result = computeScrollBuckets([{ depth: 100, sessions: 10 }]);
    expect(result.totalSessions).toBe(10);
    expect(result.averageScrollDepth).toBe(100);
    expect(result.buckets.every(b => b.reach === 100)).toBe(true);
  });

  it("computes cumulative (monotonically non-increasing) reach", () => {
    // 50 stop at 25%, 30 reach 50%, 20 reach 100%
    const result = computeScrollBuckets([
      { depth: 25, sessions: 50 },
      { depth: 50, sessions: 30 },
      { depth: 100, sessions: 20 },
    ]);
    expect(result.totalSessions).toBe(100);
    // weighted avg = (25*50 + 50*30 + 100*20)/100 = (1250+1500+2000)/100 = 47.5 → 48
    expect(result.averageScrollDepth).toBe(48);

    const reachAt = (depth: number) => result.buckets.find(b => b.depth === depth)!.reach;
    expect(reachAt(0)).toBe(100); // everyone reached at least 0
    expect(reachAt(25)).toBe(100); // all three groups >= 25
    expect(reachAt(50)).toBe(50); // 30 + 20
    expect(reachAt(100)).toBe(20); // only the deepest group

    // reach must never increase as depth increases
    for (let i = 1; i < result.buckets.length; i++) {
      expect(result.buckets[i].reach).toBeLessThanOrEqual(result.buckets[i - 1].reach);
    }
  });
});
