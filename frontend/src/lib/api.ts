export interface DamageCounts {
  none: number;
  minor: number;
  major: number;
  destroyed: number;
}

export interface BuildingCounts {
  none: number;
  minor: number;
  major: number;
  destroyed: number;
}

export interface Zone {
  rank: number;
  bbox: number[];
  damage_counts: DamageCounts;
  building_counts: BuildingCounts;
  priority_score: number;
  /** Mean predicted-class probability over the zone's building pixels.
   *  Only the `pytorch` inference mode produces probabilities; null otherwise. */
  confidence?: number | null;
  centroid_lat?: number | null;
  centroid_lng?: number | null;
}

export interface AnalysisSummary {
  total_building_pixels: number;
  total_buildings: number;
  destroyed_pct: number;
  major_pct: number;
  minor_pct: number;
}

export interface AnalysisResult {
  zones: Zone[];
  summary: AnalysisSummary;
  mask_base64?: string | null;
  pair_id?: string | null;
  inference_mode: string;
  geo_available: boolean;
  /** "wgs84" = real map coords; "image" = pixel-space zone map. */
  geo_mode?: "wgs84" | "image";
  /** Pixel size of the damage mask / source image [width, height]. */
  image_size?: [number, number] | null;
  geo_message?: string | null;
}

export interface DemoPair {
  id: string;
  disaster_type: string;
  pre_image: string;
  post_image: string;
}

export interface BriefResponse {
  brief: string;
  source: string;
}

export interface HealthResponse {
  status: string;
  inference_mode: string;
  demo_pairs: number;
}

/*
  Important:
  Your backend is FastAPI on port 8000.
  Your frontend is Next.js on port 3000.

  If image URLs accidentally point to localhost:3000, the images fail.
  So every API/demo image request must go to the backend base URL.
*/
const RAW_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000";

export const API_BASE = RAW_API_BASE.replace(/\/$/, "");

/*
  Without a timeout a wedged backend leaves the UI spinning forever. Analyze is
  the slow one: `docker` inference runs the TF baseline and takes ~2 min/pair.
*/
const TIMEOUT_ANALYZE_MS = 300_000;
const TIMEOUT_BRIEF_MS = 90_000;
const TIMEOUT_DEFAULT_MS = 30_000;

async function readError(res: Response, fallback: string): Promise<string> {
  // Never surface raw backend bodies (paths, stack fragments) in the UI.
  const statusHints: Record<number, string> = {
    400: "The request was rejected. Check that both images are valid PNG/JPEG under 15 MB.",
    401: "This analysis server requires an API key. Contact the operator if you need access.",
    404: "The requested demo pair or image was not found.",
    413: "The upload is too large for this server.",
    429: "Too many requests. Wait a moment and try again.",
    503: "The analysis service is temporarily unavailable. Try again shortly.",
  };
  if (statusHints[res.status]) {
    return statusHints[res.status];
  }
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text) as { detail?: unknown };
      if (typeof json.detail === "string" && json.detail.length < 200) {
        // Allow short, intentional FastAPI detail strings only.
        return json.detail;
      }
    } catch {
      /* not JSON */
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_DEFAULT_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Backend unavailable"));
  }

  return res.json();
}

export async function fetchDemoPairs(): Promise<DemoPair[]> {
  const res = await fetch(`${API_BASE}/demo/pairs`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_DEFAULT_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to load demo pairs"));
  }

  return res.json();
}

/*
  The deployed backend sits on a free tier that sleeps when idle, and a cold
  start takes longer than any single request timeout. One failed probe therefore
  means "still waking", not "offline" — so keep probing until the budget runs
  out, and only then call it offline.

  The budget is wall-clock, not a retry count: a sleeping host leaves requests
  hanging until they time out, while a host that is simply down refuses them
  instantly. A fixed number of retries would spend minutes in the first case and
  a couple of seconds in the second — far too little to outlast a boot.
*/
const CONNECT_BUDGET_MS = 75_000;
const RETRY_MIN_MS = 1_500;
const RETRY_MAX_MS = 5_000;

export async function connectToBackend(options?: {
  signal?: AbortSignal;
  budgetMs?: number;
}): Promise<{ health: HealthResponse; pairs: DemoPair[] }> {
  const { signal, budgetMs = CONNECT_BUDGET_MS } = options ?? {};
  const deadline = Date.now() + budgetMs;

  let lastError: unknown = new Error("Backend unavailable");
  let backoff = RETRY_MIN_MS;

  for (;;) {
    try {
      // Health alone defines online/offline. Demo pairs are best-effort so a
      // pairs failure cannot force FRONTEND ONLY while analyze still works.
      const health = await fetchHealth();
      let pairs: DemoPair[] = [];
      try {
        pairs = await fetchDemoPairs();
      } catch {
        pairs = [];
      }
      return { health, pairs };
    } catch (err) {
      lastError = err;
    }

    if (signal?.aborted) throw new Error("Connection cancelled");
    if (Date.now() + backoff >= deadline) throw lastError;

    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 1.5, RETRY_MAX_MS);
  }
}

export async function analyzeDemoPair(pairId: string): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("demo_pair_id", pairId);

  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_ANALYZE_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to analyze demo pair"));
  }

  return res.json();
}

export async function analyzeUpload(
  pre: File,
  post: File,
): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("pre_image", pre);
  form.append("post_image", post);

  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_ANALYZE_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to analyze uploaded images"));
  }

  return res.json();
}

export async function fetchBrief(
  analysis: AnalysisResult,
  context?: string,
): Promise<BriefResponse> {
  const res = await fetch(`${API_BASE}/brief`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ analysis, context }),
    signal: AbortSignal.timeout(TIMEOUT_BRIEF_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to generate brief"));
  }

  return res.json();
}

export async function fetchReportPdf(
  analysis: AnalysisResult,
  brief: string,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/report/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ analysis, brief }),
    signal: AbortSignal.timeout(TIMEOUT_DEFAULT_MS),
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to generate PDF report"));
  }

  return res.blob();
}

export function demoImageUrl(filenameOrPath: string): string {
  if (!filenameOrPath) return "";

  const value = filenameOrPath.trim();

  /*
    Absolute URLs are only accepted when they already point at this API.
    Reject arbitrary http(s) hosts to avoid open redirects from a poisoned
    /demo/pairs payload.
  */
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      const base = new URL(API_BASE);
      if (url.origin === base.origin) {
        return value;
      }
    } catch {
      /* fall through */
    }
    return "";
  }

  /*
    Case 2:
    Backend returned:
    /demo/images/demo_pre_disaster.png
  */
  if (value.startsWith("/demo/images/")) {
    return `${API_BASE}${value}`;
  }

  /*
    Case 3:
    Backend returned another root-relative path.
    This still needs to go to FastAPI, not Next.js.
  */
  if (value.startsWith("/")) {
    return `${API_BASE}${value}`;
  }

  /*
    Case 4:
    Backend returned only:
    demo_pre_disaster.png
  */
  return `${API_BASE}/demo/images/${encodeURIComponent(value)}`;
}