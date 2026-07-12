from pydantic import BaseModel, Field


class DamageCounts(BaseModel):
    none: int = 0
    minor: int = 0
    major: int = 0
    destroyed: int = 0


class BuildingCounts(BaseModel):
    """Distinct buildings per damage class, from connected-component labeling."""

    none: int = 0
    minor: int = 0
    major: int = 0
    destroyed: int = 0


class Zone(BaseModel):
    rank: int
    bbox: list[int] = Field(
        description="x, y, width, height in pixels", min_length=4, max_length=4
    )
    damage_counts: DamageCounts
    building_counts: BuildingCounts
    priority_score: float
    confidence: float | None = Field(
        default=None,
        description="Mean predicted-class probability over building pixels (pytorch mode only)",
    )
    centroid_lat: float | None = None
    centroid_lng: float | None = None


class AnalysisSummary(BaseModel):
    total_building_pixels: int
    total_buildings: int
    destroyed_pct: float
    major_pct: float
    minor_pct: float


class AnalysisResult(BaseModel):
    zones: list[Zone]
    summary: AnalysisSummary
    mask_path: str | None = None
    mask_base64: str | None = None
    pair_id: str | None = None
    inference_mode: str
    geo_available: bool = False
    geo_mode: str = Field(
        default="image",
        description="wgs84 for real lat/lng; image for pixel-space zone map",
    )
    image_size: list[int] | None = Field(
        default=None,
        description="Mask/image width and height in pixels [w, h]",
        min_length=2,
        max_length=2,
    )
    geo_message: str | None = None


class BriefRequest(BaseModel):
    """Require a typed analysis payload so clients cannot dump unbounded JSON."""

    analysis: AnalysisResult
    context: str | None = Field(default=None, max_length=2000)


class BriefResponse(BaseModel):
    brief: str
    source: str  # fireworks | fireworks-fallback | stub


class DemoPair(BaseModel):
    id: str
    disaster_type: str
    pre_image: str
    post_image: str


class ReportRequest(BaseModel):
    analysis: AnalysisResult
    brief: str
