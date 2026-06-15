"use client";

import { useEffect, useRef } from "react";
import { createCache, createMirror, rebuild } from "rrweb-snapshot";

interface HeatmapBackdropProps {
  events: any[];
  // Coordinate space the heat canvas uses (page content dimensions).
  baseWidth: number;
  baseHeight: number;
}

const RRWEB_FULL_SNAPSHOT = 2;

// Renders the captured page as a static, non-interactive backdrop by rebuilding the rrweb
// full-snapshot DOM directly into a sandboxed iframe (the Clarity approach). No rrweb-player,
// so there is no internal scaling/controller to fight: the iframe fills the heat coordinate
// box (baseWidth × baseHeight) 1:1, so the heat canvas overlay lines up exactly. Best-effort —
// any failure leaves a blank stage and the heat canvas still renders on top.
export function HeatmapBackdrop({ events, baseWidth, baseHeight }: HeatmapBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      }
    } catch {
      // Backdrop is an enhancement; ignore failures and keep the heat canvas usable.
    }

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [events, baseWidth, baseHeight]);

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
