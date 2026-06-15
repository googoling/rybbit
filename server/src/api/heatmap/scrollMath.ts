export interface ScrollHistogramRow {
  depth: number; // 5% band lower bound
  sessions: number; // sessions whose deepest scroll fell in this band
}

export interface ScrollComputation {
  buckets: { depth: number; reach: number }[]; // cumulative % reaching each band
  totalSessions: number;
  averageScrollDepth: number;
}

// Turn a per-session deepest-scroll histogram into cumulative reach buckets.
// reach(depth) = % of sessions whose deepest scroll was >= depth.
export function computeScrollBuckets(hist: ScrollHistogramRow[], step = 5): ScrollComputation {
  const totalSessions = hist.reduce((sum, b) => sum + Number(b.sessions), 0);
  const weighted = hist.reduce((sum, b) => sum + Number(b.depth) * Number(b.sessions), 0);
  const averageScrollDepth = totalSessions > 0 ? Math.round(weighted / totalSessions) : 0;

  const buckets: { depth: number; reach: number }[] = [];
  for (let depth = 0; depth <= 100; depth += step) {
    const reached = hist.reduce((sum, b) => (Number(b.depth) >= depth ? sum + Number(b.sessions) : sum), 0);
    const reach = totalSessions > 0 ? Math.round((reached / totalSessions) * 100) : 0;
    buckets.push({ depth, reach });
  }

  return { buckets, totalSessions, averageScrollDepth };
}
