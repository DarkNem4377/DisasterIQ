// frontend/src/components/ZoneTable.tsx

"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/api";

interface Props {
  analysis: AnalysisResult | null;
}

function EmptyPriorityZones() {
  return (
    <div className="rounded-xl border border-blue-500/35 bg-diq-panel/55 shadow-2xl shadow-black/20">
      <div className="border-b border-diq-line/60 bg-slate-950/30 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-label text-xs uppercase tracking-[0.18em] text-slate-200">
            Priority Zones
          </h3>

          <span className="rounded border border-diq-line/50 bg-slate-950/60 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
            Standby
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="overflow-hidden rounded-xl border border-diq-line/50 bg-slate-950/35">
          <div className="grid grid-cols-[56px_1fr_95px] border-b border-diq-line/50 bg-slate-950/55 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <span>Zone</span>
            <span>Damaged Buildings</span>
            <span className="text-right">Priority</span>
          </div>

          <div className="divide-y divide-diq-line/40">
            {[1, 2, 3, 4].map((rank) => (
              <div
                key={rank}
                className="grid grid-cols-[56px_1fr_95px] items-center gap-3 px-3 py-3"
              >
                <div className="h-7 w-7 rounded-lg bg-diq-line/25" />

                <div>
                  <div className="h-3 w-20 rounded bg-diq-line/25" />
                  <div className="mt-2 h-2 w-32 rounded bg-diq-line/15" />
                </div>

                <div className="ml-auto h-6 w-16 rounded-md bg-diq-line/20" />
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          Ranked response zones will appear here after DisasterIQ analyzes the
          before/after imagery.
        </p>
      </div>
    </div>
  );
}

type PriorityLevel = "high" | "medium" | "low";

/*
  Bucket a zone's real 0-100 priority_score (from the backend scoring service)
  into a response tier. A destroyed/major-dominant zone lands in High, a zone
  with lighter damage in Medium, and a low- or no-damage zone in Low.
*/
function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 50) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function getPriorityMeta(level: PriorityLevel) {
  if (level === "high") {
    return {
      label: "High",
      badge: "border-red-500/50 bg-red-500 text-slate-950 shadow-red-950/30",
      rankBox: "bg-red-500 text-white",
      zoneText: "text-red-300",
      row: "bg-red-950/20 hover:bg-red-950/30",
      line: "bg-red-500/60",
    };
  }

  if (level === "medium") {
    return {
      label: "Medium",
      badge:
        "border-yellow-500/50 bg-yellow-400 text-slate-950 shadow-yellow-950/30",
      rankBox: "bg-yellow-400 text-slate-950",
      zoneText: "text-yellow-200",
      row: "bg-yellow-950/10 hover:bg-yellow-950/20",
      line: "bg-yellow-400/60",
    };
  }

  return {
    label: "Low",
    badge:
      "border-green-500/50 bg-green-500 text-slate-950 shadow-green-950/30",
    rankBox: "bg-green-500 text-white",
    zoneText: "text-slate-100",
    row: "bg-slate-950/25 hover:bg-slate-900/40",
    line: "bg-green-500/50",
  };
}

const COLLAPSED_COUNT = 6;

export default function ZoneTable({ analysis }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (!analysis) {
    return <EmptyPriorityZones />;
  }

  const rankedZones = [...analysis.zones].sort((a, b) => a.rank - b.rank);
  const hasMore = rankedZones.length > COLLAPSED_COUNT;
  const displayZones =
    showAll || !hasMore ? rankedZones : rankedZones.slice(0, COLLAPSED_COUNT);

  return (
    <div className="rounded-xl border border-blue-500/35 bg-diq-panel/55 shadow-2xl shadow-black/20">
      <div className="border-b border-diq-line/60 bg-slate-950/30 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-label text-xs uppercase tracking-[0.18em] text-slate-200">
            Priority Zones
          </h3>

          <span className="rounded border border-diq-orange/40 bg-diq-orange/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-diq-orange">
            {rankedZones.length} zones
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="overflow-hidden rounded-xl border border-diq-line/50 bg-slate-950/35">
          <div className="grid grid-cols-[60px_1fr_92px] border-b border-diq-line/50 bg-slate-950/55 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <span>Zone</span>
            <span>Damaged Buildings</span>
            <span className="text-right">Priority</span>
          </div>

          <div
            className={`divide-y divide-diq-line/40 ${
              showAll && hasMore ? "max-h-[360px] overflow-y-auto" : ""
            }`}
          >
            {displayZones.map((zone) => {
              const meta = getPriorityMeta(getPriorityLevel(zone.priority_score));
              const destroyed = zone.building_counts.destroyed;
              const major = zone.building_counts.major;
              const damagedBuildings = destroyed + major;

              return (
                <article
                  key={zone.rank}
                  className={`grid grid-cols-[60px_1fr_92px] items-center gap-3 px-3 py-3 transition ${meta.row}`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black shadow-lg shadow-black/20 ${meta.rankBox}`}
                    >
                      {zone.rank}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <h4
                        className={`truncate text-sm font-black ${meta.zoneText}`}
                      >
                        Zone {zone.rank}
                      </h4>

                      <span className="text-lg font-black leading-none text-white">
                        {damagedBuildings}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className="truncate text-[11px] text-slate-400">
                        {destroyed} destroyed, {major} major
                      </p>

                      <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${meta.line}`}
                          style={{
                            width: `${Math.min(100, Math.max(0, zone.priority_score))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <span
                      className={`rounded-md border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-lg ${meta.badge}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-4 w-full rounded-lg border border-blue-500/30 bg-blue-950/20 px-3 py-2 text-sm font-semibold text-blue-300 transition hover:border-blue-400/60 hover:bg-blue-950/35"
          >
            {showAll
              ? "Show top zones ↑"
              : `View all ${rankedZones.length} zones →`}
          </button>
        )}

        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Priority reflects each zone&apos;s 0-100 severity score; building
          counts are estimated via connected-component analysis of the damage
          mask, not verified per-building IDs.
        </p>
      </div>
    </div>
  );
}
