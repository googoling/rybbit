"use client";

import { HeatmapPoint } from "@/api/analytics/endpoints/heatmap";

interface Props {
  points: HeatmapPoint[];
  totalSamples: number;
  pageHeight: number;
}

const ZONES = 20; // 5% bands, matching Clarity

export function AttentionDataTable({ points, totalSamples, pageHeight }: Props) {
  if (!points.length || !pageHeight) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-xs text-neutral-500 dark:text-neutral-400">
        No attention data yet.
      </div>
    );
  }

  const bandH = pageHeight / ZONES;
  const bands = Array.from({ length: ZONES }, (_, i) => {
    const lo = i * bandH;
    const hi = (i + 1) * bandH;
    const samples = points
      .filter(p => p.y_absolute >= lo && p.y_absolute < hi)
      .reduce((acc, p) => acc + p.count, 0);
    const startPct = Math.round(i * (100 / ZONES));
    const endPct = Math.round((i + 1) * (100 / ZONES));
    return { startPct, endPct, samples };
  });

  const maxSamples = Math.max(...bands.map(b => b.samples), 1);

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Attention data</span>
      </div>
      <div className="overflow-y-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-10">
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400">
              <th className="px-3 py-2 text-left font-medium">% scrolled</th>
              <th className="px-3 py-2 text-right font-medium">Samples</th>
              <th className="px-3 py-2 text-right font-medium">% of attention</th>
            </tr>
          </thead>
          <tbody>
            {bands.map(b => {
              const pct = totalSamples > 0 ? ((b.samples / totalSamples) * 100).toFixed(2) : "0.00";
              const barW = Math.round((b.samples / maxSamples) * 100);
              return (
                <tr
                  key={b.startPct}
                  className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                >
                  <td className="px-3 py-1.5 text-neutral-700 dark:text-neutral-300 font-mono">
                    {b.startPct} – {b.endPct}%
                  </td>
                  <td className="px-3 py-1.5 text-right text-neutral-600 dark:text-neutral-400">
                    {b.samples.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-14 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <span className="text-neutral-700 dark:text-neutral-300 w-10 text-right">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
