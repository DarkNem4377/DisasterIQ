from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

import anyio
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image, UnidentifiedImageError

from app.config import settings
from app.schemas import AnalysisResult, BriefRequest, BriefResponse, DemoPair, ReportRequest
from app.security import rate_limit, require_access_token
from app.services.cleanup import cleanup_old_jobs
from app.services.georef import NO_GEO_MESSAGE, fit_geo_transform
from app.services.inference import (
    list_demo_pairs,
    resolve_demo_image,
    resolve_demo_pair,
    run_inference,
)
from app.services.narrator import generate_brief
from app.services.report import generate_report_pdf
from app.services.scoring import score_mask

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9_-]+")

# Keep uploads small enough for free-tier CPU hosts; clients should pre-check.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000  # ~6327x6327
ALLOWED_IMAGE_TYPES = frozenset(
    {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/tiff"}
)

app = FastAPI(
    title="Disaster Damage Triage API",
    description="Satellite building damage assessment — Team DarkNem",
    version="0.1.0",
    docs_url=None if settings.disable_openapi_docs else "/docs",
    redoc_url=None if settings.disable_openapi_docs else "/redoc",
)

_cors_kwargs: dict = {
    "allow_origins": settings.cors_origins,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
# Broad host regexes (e.g. *.vercel.app) are opt-in via CORS_ORIGIN_REGEX.
if settings.cors_origin_regex.strip():
    _cors_kwargs["allow_origin_regex"] = settings.cors_origin_regex.strip()

app.add_middleware(CORSMiddleware, **_cors_kwargs)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "inference_mode": settings.inference_mode,
        "demo_pairs": len(list_demo_pairs()),
    }


@app.get("/demo/pairs", response_model=list[DemoPair])
def demo_pairs() -> list[DemoPair]:
    return [DemoPair(**p) for p in list_demo_pairs()]


@app.get("/demo/images/{filename}")
def demo_image(filename: str) -> FileResponse:
    try:
        path = resolve_demo_image(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Image not found: {filename}")

    return FileResponse(path)


def _validate_upload(upload: UploadFile) -> None:
    """Reject obviously bad uploads before a single byte reaches disk."""
    if not upload.content_type or upload.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {upload.content_type or 'missing Content-Type'}",
        )
    if upload.size is not None and upload.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit",
        )


def _save_upload(upload: UploadFile, dest: Path, job_dir: Path) -> None:
    """Stream an upload to disk, enforcing the size cap as we go.

    The declared Content-Length is advisory, so the cap is re-checked per chunk
    and the whole job directory is discarded on any failure — a rejected upload
    must never leave a partial file behind.
    """
    written = 0
    try:
        with dest.open("wb") as f:
            while chunk := upload.file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB "
                            "upload limit"
                        ),
                    )
                f.write(chunk)
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    try:
        with Image.open(dest) as img:
            img.verify()
        with Image.open(dest) as img:
            width, height = img.size
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Image resolution too large ({width}x{height}); "
                        f"max {MAX_IMAGE_PIXELS:,} pixels"
                    ),
                )
    except HTTPException:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image") from exc


def _run_analysis_pipeline(
    pre_path: Path,
    post_path: Path,
    out_dir: Path,
    demo_pair_id: str | None,
) -> AnalysisResult:
    """Inference, scoring and geo enrichment — all blocking, all CPU-bound.

    Kept synchronous and run on a worker thread so a single analysis cannot
    stall the event loop for every other request.
    """
    mask_path, mode, confidence_path = run_inference(pre_path, post_path, out_dir)

    result = score_mask(
        mask_path,
        grid_rows=settings.grid_rows,
        grid_cols=settings.grid_cols,
        confidence_path=confidence_path,
    )

    result.inference_mode = mode
    result.pair_id = demo_pair_id or pre_path.stem.replace("_pre_disaster", "")

    transform = fit_geo_transform(demo_pair_id) if demo_pair_id else None

    if transform:
        result.geo_available = True
        for zone in result.zones:
            x0, y0, width, height = zone.bbox
            lat, lng = transform.pixel_to_latlng(x0 + width / 2, y0 + height / 2)
            zone.centroid_lat = round(lat, 6)
            zone.centroid_lng = round(lng, 6)
    else:
        result.geo_available = False
        result.geo_message = NO_GEO_MESSAGE

    return result


@app.post(
    "/analyze",
    response_model=AnalysisResult,
    dependencies=[Depends(rate_limit), Depends(require_access_token)],
)
async def analyze(
    pre_image: UploadFile | None = File(None),
    post_image: UploadFile | None = File(None),
    demo_pair_id: str | None = Form(None),
) -> AnalysisResult:
    cleanup_old_jobs(settings.upload_dir, settings.output_dir)

    job_id = uuid.uuid4().hex
    out_dir = settings.output_dir / job_id

    if demo_pair_id:
        try:
            pair = resolve_demo_pair(demo_pair_id)
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"Demo pair not found: {demo_pair_id}",
            )

        pre_path = Path(pair["pre_path"])
        post_path = Path(pair["post_path"])

    else:
        if pre_image is None or post_image is None:
            raise HTTPException(
                status_code=400,
                detail="Provide pre_image and post_image uploads, or demo_pair_id",
            )

        _validate_upload(pre_image)
        _validate_upload(post_image)

        job_dir = settings.upload_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        # Fixed names avoid basename collisions between pre/post uploads.
        pre_path = job_dir / "pre.png"
        post_path = job_dir / "post.png"

        _save_upload(pre_image, pre_path, job_dir)
        _save_upload(post_image, post_path, job_dir)

    try:
        return await anyio.to_thread.run_sync(
            _run_analysis_pipeline, pre_path, post_path, out_dir, demo_pair_id
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post(
    "/brief",
    response_model=BriefResponse,
    dependencies=[Depends(rate_limit), Depends(require_access_token)],
)
async def brief(body: BriefRequest) -> BriefResponse:
    return await generate_brief(body.analysis.model_dump(), body.context)


@app.post(
    "/report/pdf",
    dependencies=[Depends(rate_limit), Depends(require_access_token)],
)
async def report_pdf(body: ReportRequest) -> Response:
    pdf_bytes = await anyio.to_thread.run_sync(
        generate_report_pdf, body.analysis, body.brief
    )

    raw_name = body.analysis.pair_id or "upload"
    safe_name = _SAFE_FILENAME_RE.sub("_", raw_name).strip("_") or "upload"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="disasteriq-report-{safe_name}.pdf"'
        },
    )


@app.post(
    "/analyze-and-brief",
    dependencies=[Depends(rate_limit), Depends(require_access_token)],
)
async def analyze_and_brief(
    pre_image: UploadFile | None = File(None),
    post_image: UploadFile | None = File(None),
    demo_pair_id: str | None = Form(None),
    context: str | None = Form(None),
) -> dict:
    analysis = await analyze(
        pre_image=pre_image,
        post_image=post_image,
        demo_pair_id=demo_pair_id,
    )

    brief_resp = await generate_brief(analysis.model_dump(), context)

    return {"analysis": analysis, "brief": brief_resp}
