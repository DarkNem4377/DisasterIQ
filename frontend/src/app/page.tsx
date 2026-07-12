// frontend/src/app/page.tsx

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import BriefPanel from "@/components/BriefPanel";
import DamageCanvas from "@/components/DamageCanvas";
import ZoneTable from "@/components/ZoneTable";
import ZoneMap from "@/components/ZoneMap";
import {
  analyzeDemoPair,
  analyzeUpload,
  connectToBackend,
  ConnectionCancelledError,
  demoImageUrl,
  fetchBrief,
  fetchReportPdf,
  type AnalysisResult,
  type DemoPair,
  type HealthResponse,
} from "@/lib/api";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const DAMAGE_LEGEND = [
  { label: "No Damage", swatch: "bg-green-400" },
  { label: "Minor Damage", swatch: "bg-yellow-400" },
  { label: "Major Damage", swatch: "bg-orange-500" },
  { label: "Destroyed", swatch: "bg-red-500" },
] as const;

function getFriendlyError(error: unknown) {
  // AbortSignal.timeout rejects with a TimeoutError DOMException, whose message
  // ("signal timed out") means nothing to a coordinator staring at the screen.
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The analysis server took too long to respond. Large image pairs can take a couple of minutes — wait a moment, then try again.";
  }

  const message = error instanceof Error ? error.message : String(error);

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("networkerror")
  ) {
    return "Could not reach the analysis server. It may still be waking up — this can take up to a minute on first use.";
  }

  return message;
}

function FilePicker({
  label,
  file,
  onSelect,
}: {
  label: string;
  file: File | null;
  onSelect: (f: File | null) => void;
}) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block font-label text-[9px] uppercase tracking-[0.18em] text-slate-500"
      >
        {label}
      </label>

      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-diq-line/70 bg-slate-950/50 px-2.5 py-2 text-xs transition hover:border-diq-orange/70 hover:bg-slate-900/70"
      >
        <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100">
          Browse
        </span>

        <span
          className={`min-w-0 truncate ${
            file ? "text-slate-100" : "text-slate-500"
          }`}
        >
          {file ? file.name : "No file selected"}
        </span>
      </label>

      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

const MAX_CLIENT_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_CLIENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
]);

function validateUploadFile(file: File): string | null {
  if (file.size > MAX_CLIENT_UPLOAD_BYTES) {
    return "Each image must be 15 MB or smaller.";
  }
  if (file.type && !ALLOWED_CLIENT_TYPES.has(file.type)) {
    return "Use PNG, JPEG, WebP, or TIFF images.";
  }
  return null;
}

function UploadDropBox({
  preFile,
  postFile,
  onPreSelect,
  onPostSelect,
}: {
  preFile: File | null;
  postFile: File | null;
  onPreSelect: (f: File | null) => void;
  onPostSelect: (f: File | null) => void;
}) {
  const assignDropped = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 2);
    list.forEach((file, index) => {
      const err = validateUploadFile(file);
      if (err) {
        window.alert(err);
        return;
      }
      if (index === 0) onPreSelect(file);
      if (index === 1) onPostSelect(file);
    });
  };

  return (
    <div
      className="rounded-2xl border border-dashed border-blue-500/35 bg-slate-950/30 p-3"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        assignDropped(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-col items-center justify-center text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-diq-line/70 bg-slate-950/70 text-xl text-slate-400">
          ⇧
        </div>

        <p className="mt-3 max-w-[190px] text-sm font-semibold leading-5 text-slate-200">
          Drag & drop before/after images here
        </p>

        <p className="mt-1 text-[11px] text-slate-500">or select files below</p>

        <div className="my-3 h-px w-full bg-diq-line/40" />
      </div>

      <div className="space-y-2.5">
        <FilePicker
          label="Before image"
          file={preFile}
          onSelect={(f) => {
            if (f) {
              const err = validateUploadFile(f);
              if (err) {
                window.alert(err);
                return;
              }
            }
            onPreSelect(f);
          }}
        />

        <FilePicker
          label="After image"
          file={postFile}
          onSelect={(f) => {
            if (f) {
              const err = validateUploadFile(f);
              if (err) {
                window.alert(err);
                return;
              }
            }
            onPostSelect(f);
          }}
        />
      </div>

      <p className="mt-3 text-center text-[10px] text-slate-500">
        PNG, JPG, WebP, TIFF up to 15MB each
      </p>
    </div>
  );
}

function EmptyImageState() {
  return (
    <div className="flex h-full min-h-[720px] items-center justify-center bg-slate-950/35">
      <div className="px-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-diq-line/70 bg-slate-950/70 text-xl text-slate-500">
          ◇
        </div>

        <p className="mt-4 font-label text-xs uppercase tracking-[0.22em] text-slate-500">
          Awaiting Imagery
        </p>

        <p className="mt-2 text-sm text-slate-600">
          Load a demo pair or upload before/after images.
        </p>
      </div>
    </div>
  );
}

function DamageStatCard({
  label,
  value,
  percent,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  percent: string;
  tone: "green" | "yellow" | "orange" | "red";
  icon: string;
}) {
  const styles = {
    green: {
      border: "border-green-500/70",
      bg: "bg-green-950/25",
      text: "text-green-300",
    },
    yellow: {
      border: "border-yellow-500/70",
      bg: "bg-yellow-950/15",
      text: "text-yellow-300",
    },
    orange: {
      border: "border-orange-500/70",
      bg: "bg-orange-950/20",
      text: "text-orange-300",
    },
    red: {
      border: "border-red-500/70",
      bg: "bg-red-950/25",
      text: "text-red-300",
    },
  }[tone];

  return (
    <div
      className={`rounded-xl border ${styles.border} ${styles.bg} p-3.5 shadow-lg shadow-black/20`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-black ${styles.text}`}>{label}</p>

          <p className={`mt-2 text-3xl font-black leading-none ${styles.text}`}>
            {value}
          </p>

          <p className="mt-2 text-xs font-semibold text-slate-400">{percent}</p>
        </div>

        <span className={`text-2xl ${styles.text}`}>{icon}</span>
      </div>
    </div>
  );
}

function PipelineStatus({
  loading,
  analysis,
  seconds,
}: {
  loading: boolean;
  analysis: AnalysisResult | null;
  seconds: number | null;
}) {
  const steps = [
    "Uploading Images",
    "Preprocessing",
    "Aligning Images",
    "Extracting Buildings",
    "Running AI Model",
    "Generating Report",
  ];

  // The backend runs as a single call, so steps advance as a group: pending
  // until a run starts, processing during it, complete once results arrive.
  const state: "waiting" | "processing" | "done" = loading
    ? "processing"
    : analysis
      ? "done"
      : "waiting";
  const active = state !== "waiting";

  return (
    <div className="rounded-2xl border border-diq-line/60 bg-slate-950/30 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-300">
          2
        </span>

        <p className="font-label text-xs uppercase tracking-[0.18em] text-slate-300">
          Processing Pipeline
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <div key={step} className="relative flex items-start gap-3">
            {index !== steps.length - 1 && (
              <span
                className={`absolute left-[11px] top-6 h-5 w-px ${
                  state === "done"
                    ? "bg-green-400/80"
                    : state === "processing"
                      ? "bg-diq-orange/70"
                      : "bg-diq-line/70"
                }`}
              />
            )}

            <span
              className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                state === "done"
                  ? "border-green-400 bg-green-950/60 text-green-300"
                  : state === "processing"
                    ? "border-diq-orange bg-orange-950/40 text-diq-orange"
                    : "border-diq-line bg-slate-950 text-slate-500"
              }`}
            >
              {state === "done" ? "✓" : index + 1}
            </span>

            <div>
              <p
                className={`text-sm font-semibold ${
                  active ? "text-slate-100" : "text-slate-500"
                }`}
              >
                {step}
              </p>

              <p
                className={`text-xs ${
                  state === "done"
                    ? "text-green-400"
                    : state === "processing"
                      ? "text-diq-orange"
                      : "text-slate-600"
                }`}
              >
                {state === "done"
                  ? "Completed"
                  : state === "processing"
                    ? "Processing…"
                    : "Waiting"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {state === "done" && (
        <div className="mt-5 rounded-xl border border-green-500/30 bg-green-950/20 px-4 py-4 text-center">
          <p className="text-sm font-bold text-green-300">
            ✓ Analysis Complete
          </p>
          {seconds != null && (
            <p className="mt-1 text-xs text-slate-400">
              {seconds.toFixed(1)} seconds
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BackendConnectingNotice() {
  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-950/15 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blue-400" />

        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-200">
            Waking backend
          </p>
          <p className="mt-1 text-[11px] leading-5 text-blue-100/60">
            The server sleeps when idle. First load can take up to a minute —
            demo pairs will appear automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

function BackendOfflineNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-black text-amber-300">
          !
        </span>

        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-200">
            Backend unreachable
          </p>
          <p className="mt-1 text-[11px] leading-5 text-amber-100/60">
            Could not reach the analysis server. It may still be starting up.
          </p>

          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-[11px] font-bold text-amber-100 transition hover:border-amber-400/70 hover:bg-amber-900/30"
          >
            ↻ Retry connection
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/35 bg-red-950/30 px-3 py-3">
      <p className="text-sm font-bold text-red-200">Action blocked</p>
      <p className="mt-1 text-xs leading-5 text-red-200/70">{message}</p>
    </div>
  );
}

function FloatingLegend() {
  return (
    <div className="absolute right-4 top-4 z-20 rounded-xl border border-diq-line/70 bg-slate-950/90 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-white">
        Damage Legend
      </p>

      <div className="space-y-2.5">
        {DAMAGE_LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded ${item.swatch}`} />
            <span className="text-xs font-medium text-slate-200">
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-slate-500">
        Damage classes from model output
      </p>
    </div>
  );
}

function MapControls({
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex flex-col overflow-hidden rounded-lg border border-diq-line/70 bg-slate-950/85 shadow-xl shadow-black/30">
      <button
        type="button"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className="flex h-9 w-9 items-center justify-center border-b border-diq-line/60 text-lg font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Zoom in"
      >
        +
      </button>

      <button
        type="button"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className="flex h-9 w-9 items-center justify-center text-lg font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  );
}

function FullscreenButton({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current);
    };

    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [targetRef]);

  const toggleFullscreen = () => {
    const el = targetRef.current;
    if (!el) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      className="absolute bottom-4 right-16 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-diq-line/70 bg-slate-950/85 text-sm text-white shadow-xl shadow-black/30 transition hover:bg-slate-800"
      aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
    >
      {isFullscreen ? "⤡" : "⛶"}
    </button>
  );
}

export default function HomePage() {
  const [pairs, setPairs] = useState<DemoPair[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>("");
  const [preFile, setPreFile] = useState<File | null>(null);
  const [postFile, setPostFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [postUrl, setPostUrl] = useState<string>("");
  const [preUrl, setPreUrl] = useState<string>("");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefSource, setBriefSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [analysisSeconds, setAnalysisSeconds] = useState<number | null>(null);
  /** After a successful API call, ignore failed quiet probes until this time. */
  const onlineUntilRef = useRef(0);

  const markOnline = useCallback(() => {
    onlineUntilRef.current = Date.now() + 120_000;
    setBackendOffline(false);
  }, []);

  const beforePanelRef = useRef<HTMLDivElement>(null);
  const afterPanelRef = useRef<HTMLDivElement>(null);
  const [afterZoom, setAfterZoom] = useState(1);

  const zoomIn = useCallback(
    () => setAfterZoom((z) => Math.min(Math.round((z + 0.25) * 100) / 100, MAX_ZOOM)),
    [],
  );
  const zoomOut = useCallback(
    () => setAfterZoom((z) => Math.max(Math.round((z - 0.25) * 100) / 100, MIN_ZOOM)),
    [],
  );

  useEffect(() => {
    setAfterZoom(MIN_ZOOM);
  }, [postUrl]);

  // Object URLs created from uploaded Files stay alive until explicitly revoked.
  // Track the pre/post blob independently so an uploaded image can be previewed
  // (and zoomed/expanded) the moment it is selected, then released when it is
  // replaced — whether by another upload or a demo pair's plain HTTP URLs.
  const preBlobRef = useRef<string | null>(null);
  const postBlobRef = useRef<string | null>(null);

  const setPreImage = useCallback((url: string, isBlob: boolean) => {
    if (preBlobRef.current) URL.revokeObjectURL(preBlobRef.current);
    preBlobRef.current = isBlob ? url : null;
    setPreUrl(url);
  }, []);

  const setPostImage = useCallback((url: string, isBlob: boolean) => {
    if (postBlobRef.current) URL.revokeObjectURL(postBlobRef.current);
    postBlobRef.current = isBlob ? url : null;
    setPostUrl(url);
  }, []);

  const setImageUrls = useCallback(
    (pre: string, post: string, isBlob: boolean) => {
      setPreImage(pre, isBlob);
      setPostImage(post, isBlob);
    },
    [setPreImage, setPostImage],
  );

  useEffect(() => {
    return () => {
      if (preBlobRef.current) URL.revokeObjectURL(preBlobRef.current);
      if (postBlobRef.current) URL.revokeObjectURL(postBlobRef.current);
    };
  }, []);

  /** True while a background poll is running; user-driven retries ignore it. */
  const quietProbeInFlightRef = useRef(false);

  const connect = useCallback(
    (options?: { signal?: AbortSignal; budgetMs?: number; quiet?: boolean }) => {
      const { signal, budgetMs, quiet } = options ?? {};

      /*
        A probe can run for its whole budget, which outlasts the poll interval
        below. Without this guard the polls pile up: several probe loops end up
        retrying at once against a host that is still booting, which is exactly
        when it can least afford the extra load. Only the polls are suppressed —
        an explicit "Retry connection" must always fire.
      */
      if (quiet) {
        if (quietProbeInFlightRef.current) return Promise.resolve();
        quietProbeInFlightRef.current = true;
      }

      // A quiet probe is the background poll below: it must not flip the UI
      // back to "Waking backend" on every tick once we already said offline.
      if (!quiet) setConnecting(true);

      return connectToBackend({ signal, budgetMs })
        .then(({ health: h, pairs: p }) => {
          if (signal?.aborted) return;
          setHealth(h);
          setPairs(p);
          markOnline();
          if (p.length > 0) setSelectedPair((cur) => cur || p[0].id);
        })
        .catch((err) => {
          if (signal?.aborted) return;
          if (err instanceof ConnectionCancelledError) return;
          if (err instanceof Error && err.message === "Connection cancelled") return;
          // Sticky online: a single quiet probe must not flip FRONTEND ONLY
          // right after analyze/brief succeeded.
          if (quiet && Date.now() < onlineUntilRef.current) return;
          setHealth(null);
          setPairs([]);
          setSelectedPair("");
          setBackendOffline(true);
        })
        .finally(() => {
          if (quiet) quietProbeInFlightRef.current = false;
          else if (!signal?.aborted) setConnecting(false);
        });
    },
    [markOnline]
  );

  useEffect(() => {
    const controller = new AbortController();
    // Budget comes from api.ts: it must outlast a free-tier cold start.
    void connect({ signal: controller.signal });
    return () => controller.abort();
  }, [connect]);

  /*
    Once the budget is spent we show "offline", but a backend can still come up
    later (a slow boot, a restarted dev server). Keep probing quietly so the
    dashboard heals itself instead of demanding a refresh.
  */
  useEffect(() => {
    if (!backendOffline || connecting) return;

    const controller = new AbortController();
    const id = setInterval(() => {
      void connect({
        signal: controller.signal,
        // Must exceed the per-attempt timeout (25s) so cold starts can retry.
        budgetMs: 60_000,
        quiet: true,
      });
    }, 10_000);

    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [backendOffline, connecting, connect]);

  const loadDemoPair = useCallback(() => {
    setError(null);
    setAnalysis(null);
    setBrief(null);
    setBriefSource(null);
    setBriefLoading(false);

    if (backendOffline) {
      setError(
        "The analysis server is not reachable yet. It may still be waking up — try again in a moment."
      );
      return;
    }

    if (!selectedPair) {
      setError("Select a demo pair first.");
      return;
    }

    const pair = pairs.find((p) => p.id === selectedPair);

    if (!pair) {
      setError(`Selected demo pair was not found: ${selectedPair}`);
      return;
    }

    setPreFile(null);
    setPostFile(null);
    setImageUrls(demoImageUrl(pair.pre_image), demoImageUrl(pair.post_image), false);
  }, [backendOffline, selectedPair, pairs, setImageUrls]);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBrief(null);
    setBriefSource(null);
    setAnalysisSeconds(null);

    try {
      let result: AnalysisResult;

      const startedAt = performance.now();

      if (preFile && postFile) {
        // preUrl/postUrl were already set to preview blobs on file selection.
        result = await analyzeUpload(preFile, postFile);
      } else if (selectedPair) {
        result = await analyzeDemoPair(selectedPair);
        const pair = pairs.find((p) => p.id === selectedPair);

        if (pair) {
          setImageUrls(demoImageUrl(pair.pre_image), demoImageUrl(pair.post_image), false);
        }
      } else if (backendOffline) {
        throw new Error(
          "The analysis server is not reachable yet. It may still be waking up — try again in a moment."
        );
      } else {
        throw new Error("Select a demo pair or upload before/after images.");
      }

      setAnalysisSeconds((performance.now() - startedAt) / 1000);
      setAnalysis(result);
      markOnline();
      setBriefLoading(true);

      // Refresh health/pairs in the background after a successful analyze.
      void connect({ budgetMs: 45_000, quiet: true });

      const context =
        "Pakistan disaster response context: prioritize flood and earthquake damage zones for triage.";

      const briefResp = await fetchBrief(result, context);
      setBrief(briefResp.brief);
      setBriefSource(briefResp.source);
      markOnline();
    } catch (e) {
      setError(getFriendlyError(e));
    } finally {
      setLoading(false);
      setBriefLoading(false);
    }
  }, [preFile, postFile, selectedPair, pairs, backendOffline, setImageUrls, connect, markOnline]);

  const handleDownloadReport = useCallback(async () => {
    if (!analysis || !brief) return;

    setReportLoading(true);
    setError(null);

    try {
      const blob = await fetchReportPdf(analysis, brief);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `disasteriq-report-${analysis.pair_id ?? "upload"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      markOnline();
    } catch (e) {
      setError(getFriendlyError(e));
    } finally {
      setReportLoading(false);
    }
  }, [analysis, brief, markOnline]);

  const totals = useMemo(() => {
    if (!analysis) {
      return {
        noDamage: 0,
        minor: 0,
        major: 0,
        destroyed: 0,
        total: 0,
        hasData: false,
      };
    }

    const zones = analysis.zones ?? [];

    const noDamage = zones.reduce((sum, z) => sum + z.building_counts.none, 0);

    const minor = zones.reduce((sum, z) => sum + z.building_counts.minor, 0);

    const major = zones.reduce((sum, z) => sum + z.building_counts.major, 0);

    const destroyed = zones.reduce(
      (sum, z) => sum + z.building_counts.destroyed,
      0
    );

    return {
      noDamage,
      minor,
      major,
      destroyed,
      total: noDamage + minor + major + destroyed,
      hasData: true,
    };
  }, [analysis]);

  const percent = useCallback(
    (value: number) => {
      if (!totals.hasData || totals.total === 0) return "—";
      return `${((value / totals.total) * 100).toFixed(1)}%`;
    },
    [totals]
  );

  const canAnalyze = Boolean((preFile && postFile) || selectedPair);

  return (
    <main className="min-h-screen bg-diq-bg text-slate-100 diq-grid-bg">
      <div className="mx-auto max-w-[1920px] px-4 py-4">
        <header className="mb-4 border-b border-diq-line/60 pb-4">
          <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex shrink-0 items-center gap-4">
              <img
                src="/disasteriq-icon.png"
                alt="DisasterIQ logo"
                width={84}
                height={84}
                className="shrink-0 rounded-2xl bg-white shadow-lg shadow-black/20"
              />

              <div>
                <div className="flex items-baseline gap-1">
                  <h1 className="text-5xl font-black tracking-tight text-white md:text-6xl">
                    Disaster
                  </h1>
                  <h1 className="text-5xl font-black tracking-tight text-diq-orange md:text-6xl">
                    IQ
                  </h1>
                </div>

                <p className="mt-1.5 whitespace-nowrap text-[13px] font-black uppercase tracking-[0.18em] text-slate-300">
                  See damage.{" "}
                  <span className="text-diq-orange">Prioritize relief.</span>{" "}
                  <span className="text-red-400">Save lives.</span>
                </p>
              </div>
            </div>

            <div className="grid flex-1 gap-8 sm:grid-cols-2 2xl:max-w-[760px]">
              <div className="border-l border-diq-line/60 px-6 py-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Dataset
                </p>

                <p className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-lg font-semibold text-white">
                  <span className="rounded bg-green-500 px-1.5 py-0.5 text-[11px] text-white">
                    C
                  </span>
                  Global Disaster Imagery
                </p>
              </div>

              <div className="border-l border-diq-line/60 px-6 py-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Status
                </p>

                <span
                  className={`mt-1.5 inline-flex rounded border px-3 py-1 text-sm font-black uppercase tracking-[0.12em] ${
                    loading
                      ? "border-diq-orange/70 bg-diq-orange/10 text-diq-orange"
                      : connecting
                        ? "border-blue-500/70 bg-blue-950/40 text-blue-300"
                        : backendOffline
                          ? "border-amber-500/70 bg-amber-950/40 text-amber-300"
                          : "border-green-500/70 bg-green-950/40 text-green-300"
                  }`}
                >
                  {loading
                    ? "Analyzing"
                    : connecting
                      ? "Connecting…"
                      : backendOffline
                        ? "Frontend Only"
                        : "Ready"}
                </span>

                {health && !backendOffline && (
                  <p className="mt-1.5 whitespace-nowrap text-xs text-slate-500">
                    {health.inference_mode} · {health.demo_pairs}{" "}
                    {health.demo_pairs === 1 ? "pair" : "pairs"}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              className={`hidden shrink-0 items-center gap-2.5 rounded-lg border px-5 py-2.5 text-base font-semibold shadow-lg shadow-black/20 transition 2xl:flex ${
                backendOffline && !connecting
                  ? "border-amber-500/30 bg-amber-950/20 text-amber-200"
                  : "border-blue-500/30 bg-blue-950/30 text-blue-100 hover:border-blue-400/50"
              }`}
            >
              <span
                className={`h-3 w-3 rounded-full ${
                  connecting
                    ? "animate-pulse bg-blue-400"
                    : backendOffline
                      ? "bg-amber-400"
                      : "bg-green-400"
                }`}
              />
              {connecting
                ? "Waking Backend…"
                : backendOffline
                  ? "Backend Offline"
                  : "System Health"}
              <span className="text-slate-500">⌄</span>
            </button>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
          <aside className="overflow-hidden rounded-xl border border-diq-line/70 bg-diq-panel/55 shadow-2xl shadow-black/20">
            <div className="border-b border-diq-line/60 bg-slate-950/30 px-4 py-3">
              <h2 className="font-label text-xs uppercase tracking-[0.18em] text-slate-200">
                Mission Control
              </h2>
            </div>

            <div className="space-y-3.5 p-4">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-300">
                    1
                  </span>

                  <p className="font-label text-xs uppercase tracking-[0.18em] text-slate-300">
                    Upload Imagery
                  </p>
                </div>

                <UploadDropBox
                  preFile={preFile}
                  postFile={postFile}
                  onPreSelect={(file) => {
                    setPreFile(file);
                    setPreImage(file ? URL.createObjectURL(file) : "", Boolean(file));
                    if (file) {
                      setSelectedPair("");
                      setAnalysis(null);
                      setBrief(null);
                      setBriefSource(null);
                    }
                  }}
                  onPostSelect={(file) => {
                    setPostFile(file);
                    setPostImage(file ? URL.createObjectURL(file) : "", Boolean(file));
                    if (file) {
                      setSelectedPair("");
                      setAnalysis(null);
                      setBrief(null);
                      setBriefSource(null);
                    }
                  }}
                />
              </div>

              <div className="space-y-3">
                <label htmlFor="demo-pair" className="sr-only">
                  Demo satellite image pair
                </label>
                <select
                  id="demo-pair"
                  aria-label="Demo satellite image pair"
                  value={selectedPair}
                  onChange={(e) => {
                    setSelectedPair(e.target.value);
                    setPreFile(null);
                    setPostFile(null);
                    setPreImage("", false);
                    setPostImage("", false);
                    setAnalysis(null);
                    setBrief(null);
                    setBriefSource(null);
                  }}
                  disabled={pairs.length === 0}
                  className="w-full rounded-xl border border-diq-line/70 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 transition hover:border-diq-line disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  {pairs.length === 0 && (
                    <option value="">
                      {connecting
                        ? "Waking backend — demo pairs loading…"
                        : "Backend offline — demo pairs unavailable"}
                    </option>
                  )}

                  {pairs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.disaster_type}: {p.id}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={loadDemoPair}
                  disabled={loading || !selectedPair}
                  className="w-full rounded-xl border border-blue-500/35 bg-blue-950/30 px-4 py-3 text-sm font-bold text-slate-100 transition hover:border-blue-400/70 hover:bg-blue-900/30 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  ▣ Load Demo Pair
                </button>

                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={loading || !canAnalyze}
                  className="w-full rounded-xl bg-diq-orange px-4 py-3 text-sm font-black text-white shadow-lg shadow-orange-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {loading ? "Analyzing Damage…" : "⌘ Analyze Damage"}
                </button>
              </div>

              {connecting && <BackendConnectingNotice />}

              {backendOffline && !connecting && (
                <BackendOfflineNotice onRetry={() => void connect()} />
              )}

              {error && <ErrorNotice message={error} />}

              <PipelineStatus
                loading={loading}
                analysis={analysis}
                seconds={analysisSeconds}
              />
            </div>
          </aside>

          <section className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-blue-500/35 bg-diq-panel/45 shadow-2xl shadow-black/20">
              <div className="grid min-h-[720px] gap-0 lg:grid-cols-2">
                <div
                  ref={beforePanelRef}
                  className="relative overflow-hidden border-b border-diq-line/60 bg-slate-950 lg:border-b-0 lg:border-r"
                >
                  <div className="absolute left-4 top-4 z-20 rounded bg-blue-950/90 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white shadow-lg shadow-black/30">
                    Before Disaster
                  </div>

                  {preUrl ? (
                    <img
                      src={preUrl}
                      alt="Before disaster satellite imagery"
                      className="h-full min-h-[720px] w-full object-cover"
                    />
                  ) : (
                    <EmptyImageState />
                  )}

                  <div className="absolute bottom-4 left-4 z-20 rounded bg-slate-950/80 px-3 py-1.5 text-[11px] text-slate-300">
                    © Mapbox © OpenStreetMap
                  </div>

                  <FullscreenButton targetRef={beforePanelRef} />
                </div>

                <div
                  ref={afterPanelRef}
                  className="relative overflow-hidden bg-slate-950"
                >
                  <div className="absolute left-4 top-4 z-20 max-w-[52%] rounded bg-blue-950/90 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white shadow-lg shadow-black/30">
                    AI Damage Overlay After
                  </div>

                  {postUrl ? (
                    <div
                      className="h-full w-full origin-center transition-transform duration-200 ease-out"
                      style={{ transform: `scale(${afterZoom})` }}
                    >
                      <DamageCanvas postImageUrl={postUrl} analysis={analysis} />
                    </div>
                  ) : (
                    <EmptyImageState />
                  )}

                  <FloatingLegend />
                  <MapControls
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    canZoomIn={afterZoom < MAX_ZOOM}
                    canZoomOut={afterZoom > MIN_ZOOM}
                  />
                  <FullscreenButton targetRef={afterPanelRef} />
                </div>
              </div>
            </div>

            <ZoneMap analysis={analysis} postImageUrl={postUrl || undefined} />

            <BriefPanel
              brief={brief}
              source={briefSource}
              loading={briefLoading}
              onDownloadReport={handleDownloadReport}
              reportLoading={reportLoading}
            />
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-blue-500/35 bg-diq-panel/55 p-4 shadow-2xl shadow-black/20">
              <h2 className="font-label text-xs uppercase tracking-[0.18em] text-slate-200">
                Damage Summary
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <DamageStatCard
                  label="No Damage"
                  value={totals.hasData ? totals.noDamage : "—"}
                  percent={percent(totals.noDamage)}
                  tone="green"
                  icon="♢"
                />

                <DamageStatCard
                  label="Minor Damage"
                  value={totals.hasData ? totals.minor : "—"}
                  percent={percent(totals.minor)}
                  tone="yellow"
                  icon="⚠"
                />

                <DamageStatCard
                  label="Major Damage"
                  value={totals.hasData ? totals.major : "—"}
                  percent={percent(totals.major)}
                  tone="orange"
                  icon="⌂"
                />

                <DamageStatCard
                  label="Destroyed"
                  value={totals.hasData ? totals.destroyed : "—"}
                  percent={percent(totals.destroyed)}
                  tone="red"
                  icon="⌘"
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-diq-line/60 bg-slate-950/35 p-4 text-center">
                  <p className="text-xs text-slate-400">Total Buildings</p>
                  <p className="mt-1 text-3xl font-black text-white">
                    {totals.hasData ? totals.total : "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-diq-line/60 bg-slate-950/35 p-4 text-center">
                  <p className="text-xs text-slate-400">Processing Time</p>
                  <p className="mt-1 text-3xl font-black text-white">
                    {analysisSeconds != null ? analysisSeconds.toFixed(1) : "—"}
                    <span className="ml-1 text-base text-slate-400">sec</span>
                  </p>
                </div>
              </div>
            </div>

            <ZoneTable analysis={analysis} />
          </aside>
        </section>

        <footer className="mt-4 flex flex-col items-center justify-between gap-2 pb-2 text-xs text-slate-500 md:flex-row">
          <span />
          <p>
            DisasterIQ v1.0 <span className="px-3">↕</span> Built with{" "}
            <span className="text-red-400">♥</span> using AMD Technology
          </p>
          <p className="font-semibold text-diq-orange">Team DarkNem 🌐</p>
        </footer>
      </div>
    </main>
  );
}