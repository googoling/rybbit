"use client";

interface ElementRow {
  selector: string;
  text: string;
  value: number;
  suffix?: string;
}

interface HeatmapElementListProps {
  title: string;
  rows: ElementRow[];
  emptyLabel: string;
}

// Ranked list of elements (most-clicked, or top rage/dead targets).
export function HeatmapElementList({ title, rows, emptyLabel }: HeatmapElementListProps) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="px-3 py-2 border-b border-neutral-150 dark:border-neutral-850 text-sm font-medium text-neutral-700 dark:text-neutral-200">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">{emptyLabel}</div>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-850">
          {rows.map((row, index) => (
            <li key={`${row.selector}-${index}`} className="px-3 py-2 flex items-center gap-2">
              <span className="text-xs text-neutral-400 w-5 shrink-0">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-neutral-800 dark:text-neutral-100 truncate">
                  {row.text || row.selector}
                </div>
                <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate font-mono">{row.selector}</div>
              </div>
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200 shrink-0">
                {row.value.toLocaleString()}
                {row.suffix ?? ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
