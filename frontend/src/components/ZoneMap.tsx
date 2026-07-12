// frontend/src/components/ZoneMap.tsx

"use client";

import dynamic from "next/dynamic";
import type { AnalysisResult } from "@/lib/api";

interface Props {
  analysis: AnalysisResult | null;
  postImageUrl?: string;
}

const ZoneMapInner = dynamic(() => import("./ZoneMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[480px] items-center justify-center text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

export default function ZoneMap({ analysis, postImageUrl }: Props) {
  if (!analysis) return null;

  const hasZones = (analysis.zones?.length ?? 0) > 0;
  const wgs84 = analysis.geo_mode === "wgs84" || analysis.geo_available;
  const title = wgs84 ? "Zone Map" : "Zone Map (image coordinates)";

  return (
    <div className="overflow-hidden rounded-xl border border-blue-500/35 bg-diq-panel/45 shadow-2xl shadow-black/20">
      <div className="border-b border-diq-line/60 bg-slate-950/30 px-4 py-3">
        <h3 className="font-label text-xs uppercase tracking-[0.18em] text-slate-200">
          {title}
        </h3>
        {!wgs84 && hasZones && (
          <p className="mt-1 text-[11px] text-slate-500">
            Markers use pixel positions on the post-disaster image (no GPS metadata).
          </p>
        )}
      </div>

      {hasZones ? (
        <div className="h-[480px] w-full">
          <ZoneMapInner analysis={analysis} postImageUrl={postImageUrl} />
        </div>
      ) : (
        <div className="flex h-[120px] items-center justify-center px-6 text-center text-xs text-slate-500">
          Run analysis to plot priority zones.
        </div>
      )}
    </div>
  );
}
