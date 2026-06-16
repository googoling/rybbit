"use client";

import { ScrollMapBucket } from "@/api/analytics/endpoints/heatmap";

function interpolate(buckets: ScrollMapBucket[], depthPct: number): number {
  if (!buckets.length) return 0;
  let prev = buckets[0];
  for (const b of buckets) {
    if (b.depth >= depthPct) {
      if (b.depth === prev.depth) return b.reach;
      const t = (depthPct - prev.depth) / (b.depth - prev.depth);
      return Math.round(prev.reach + (b.reach - prev.reach) * t);
    }
    prev = b;
  }
  return buckets[buckets.length - 1].reach;
}

interface Props {
  buckets: ScrollMapBucket[];
  totalSessions: number;
}

const STEP = 5;
const STARTS = Array.from({ length: 100 / STEP }, (_, i) => i * STEP);

export function ScrollDataTable({ buckets, totalSessions }: Props) {
  if (!buckets.length || !totalSessions) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-xs text-neutral-500 dark:text-neutral-400">
        No scroll data yet.
      </div>
    );
  }

  const rows = STARTS.map(start => {
    const end = start + STEP;
    const visitors = interpolate(buckets, start);
    const nextVisitors = interpolate(buckets, end);
    const visitorPct = Math.round((visitors / totalSessions) * 100);
    const dropOff = visitors > 0 ? Math.round(((visitors - nextVisitors) / totalSessions) * 100) : 0;
    return { start, end, visitors, visitorPct, dropOff };
  });

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Scroll Depth</span>
      </div>
      <div className="overflow-y-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <th className="px-3 py-2 text-left font-medium">% Scrolled</th>
              <th className="px-3 py-2 text-right font-medium">Visitors</th>
              <th className="px-3 py-2 text-right font-medium">Drop off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.start}
                className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
              >
                <td className="px-3 py-1.5 text-neutral-700 dark:text-neutral-300">
                  {r.start}–{r.end}%
                </td>
                <td className="px-3 py-1.5 text-right text-neutral-700 dark:text-neutral-300">
                  {r.visitors.toLocaleString()}
                  <span className="ml-1 text-neutral-400 dark:text-neutral-500">({r.visitorPct}%)</span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className={r.dropOff > 20 ? "text-red-500" : "text-neutral-500 dark:text-neutral-400"}>
                    {r.dropOff}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
