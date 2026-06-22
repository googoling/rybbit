"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useExtracted } from "next-intl";
import { useGetHeatmapPages } from "@/api/analytics/hooks/heatmap/useHeatmap";
import { NothingFound } from "@/components/NothingFound";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatter } from "@/lib/utils";
import { useHeatmapStore } from "./heatmapStore";

function HeatmapPageCardSkeleton() {
  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800 p-3">
      <Skeleton className="h-3 w-40 mb-2" />
      <Skeleton className="h-5 w-20 rounded" />
    </div>
  );
}

export function HeatmapPageList() {
  const t = useExtracted();
  const { hostname, pathname, device, setPage } = useHeatmapStore();
  const { data: pages, isLoading } = useGetHeatmapPages(device || undefined);
  const [search, setSearch] = useState("");

  // Keep the persisted page if it still exists for this site; otherwise default
  // to the most-visited page. Lets a refresh stay on the user's chosen URL.
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const stillValid = pathname && pages.some(p => p.hostname === hostname && p.pathname === pathname);
    if (!stillValid) {
      setPage(pages[0].hostname, pages[0].pathname);
    }
  }, [hostname, pathname, pages, setPage]);

  const filtered = useMemo(() => {
    const list = pages ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => `${p.hostname}${p.pathname}`.toLowerCase().includes(q));
  }, [pages, search]);

  return (
    <div className="flex flex-col gap-2 self-start md:sticky md:top-4">
      <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center gap-2 px-2">
        <Search className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
        <Input
          type="text"
          value={search}
          inputSize="sm"
          onChange={e => setSearch(e.target.value)}
          placeholder={t("Search pages…")}
          className="border-0 bg-transparent px-0 focus-visible:ring-0"
        />
      </div>
      <div className="rounded-lg border border-neutral-100 dark:border-neutral-800 flex flex-col">
        <ScrollArea className="h-[calc(100vh-150px)] rounded-lg">
          <div className="overflow-x-hidden">
            {isLoading ? (
              Array.from({ length: 15 }).map((_, index) => <HeatmapPageCardSkeleton key={`loading-${index}`} />)
            ) : filtered.length === 0 ? (
              <NothingFound
                icon={<FileText className="w-10 h-10" />}
                title={t("No pages with heatmap data")}
                description={t("Try a different date range or filter")}
              />
            ) : (
              filtered.map(p => {
                const selected = p.hostname === hostname && p.pathname === pathname;
                return (
                  <div
                    key={`${p.hostname}||${p.pathname}`}
                    onClick={() => setPage(p.hostname, p.pathname)}
                    title={`https://${p.hostname}${p.pathname}`}
                    className={cn(
                      "border-b border-neutral-100 dark:border-neutral-800 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer",
                      selected && "bg-neutral-100 dark:bg-neutral-800/80"
                    )}
                  >
                    <div className="text-xs font-mono text-neutral-900 dark:text-neutral-200 truncate mb-2">
                      {p.hostname}
                      {p.pathname}
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                    >
                      {formatter(p.sessions)} {t("sessions")}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
