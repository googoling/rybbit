"use client";

import { useEffect, useRef } from "react";
import { createCache, createMirror, rebuild } from "rrweb-snapshot";

interface HeatmapBackdropProps {
  events: any[];
  baseWidth: number;
  baseHeight: number;
  onHeightChange?: (h: number) => void;
  onDocReady?: (doc: Document) => void;
}

const RRWEB_FULL_SNAPSHOT = 2;

export function HeatmapBackdrop({ events, baseWidth, baseHeight, onHeightChange, onDocReady }: HeatmapBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measuredRef = useRef(false);

  useEffect(() => {
    measuredRef.current = false;
    const container = containerRef.current;
    if (!container || !events?.length || baseWidth <= 0 || baseHeight <= 0) return;

    const full = events.find(e => e.type === RRWEB_FULL_SNAPSHOT);
    if (!full?.data?.node) return;

    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.cssText = `position:absolute;top:0;left:0;width:${baseWidth}px;height:${baseHeight}px;border:0;background:#fff;pointer-events:none;`;
    container.appendChild(iframe);

    try {
      const doc = iframe.contentDocument;
      if (doc) {
        rebuild(full.data.node, { doc, cache: createCache(), mirror: createMirror(), hackCss: true });

        requestAnimationFrame(() => {
          if (measuredRef.current) return;
          measuredRef.current = true;
          try {
            // Shrink to 1px so min-height:100vh collapses to 1px, revealing true content height.
            iframe.style.height = "1px";
            const rendered = doc.documentElement?.scrollHeight ?? 0;
            // Cap at 3× stored height to prevent broken-CSS pages from exploding.
            const finalHeight = Math.min(Math.max(baseHeight, rendered), Math.max(baseHeight * 3, 3000));
            iframe.style.height = `${finalHeight}px`;
            if (finalHeight > baseHeight + 50 && onHeightChange) {
              onHeightChange(finalHeight);
            }
            onDocReady?.(doc);
          } catch {}
        });
      }
    } catch {
      // Backdrop is an enhancement; ignore failures and keep the heat canvas usable.
    }

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [events, baseWidth]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: baseWidth,
        height: baseHeight,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    />
  );
}
