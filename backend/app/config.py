from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _REPO_ROOT / ".env"

INFERENCE_MODES = frozenset({"stub", "docker", "pytorch"})


def _resolve_against_repo_root(value: Path) -> Path:
    """Anchor relative paths to the repo root rather than the process cwd.

    The backend is normally started with cwd=backend/, so a relative path from
    .env such as ``data/demo`` would otherwise resolve to ``backend/data/demo``.
    """
    path = Path(value)
    if path.is_absolute():
        return path
    return (_REPO_ROOT / path).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    fireworks_api_key: str = ""
    fireworks_model: str = "accounts/fireworks/models/gpt-oss-120b"
    demo_data_dir: Path = _REPO_ROOT / "data" / "demo"
    test_data_dir: Path = _REPO_ROOT / "data" / "test"
    inference_mode: str = "stub"  # stub | docker | pytorch
    xview2_docker_image: str = "darknem-xview2-inference"
    pytorch_checkpoint_path: Path = _REPO_ROOT / "ml" / "checkpoints" / "damage_best.ckpt"
    pytorch_inference_dir: Path = _REPO_ROOT / "ml" / "pytorch-inference"
    pytorch_repo_dir: Path = _REPO_ROOT / "ml" / "pytorch-xview2"
    upload_dir: Path = Path(__file__).resolve().parents[1] / "uploads"
    output_dir: Path = Path(__file__).resolve().parents[1] / "outputs"
    grid_rows: int = Field(default=4, gt=0)
    grid_cols: int = Field(default=4, gt=0)
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    # Opt-in regex for preview hosts. Leave empty in production and list exact
    # origins in cors_origins instead of allowing every *.vercel.app site.
    cors_origin_regex: str = ""

    # Endpoint protection. Both are opt-in so the demo works out of the box.
    # access_token: if set, the expensive endpoints require a matching X-API-Key
    #   header (useful only when the backend is called server-side or via a
    #   proxy — a browser-facing token would be exposed to clients).
    # rate_limit_requests per rate_limit_window_seconds, per client IP. Set the
    #   request count to 0 to disable rate limiting.
    access_token: str = ""
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60
    # When true, /docs and /redoc are disabled (recommended for public deploys).
    disable_openapi_docs: bool = False

    @model_validator(mode="after")
    def _resolve_relative_paths(self) -> "Settings":
        self.demo_data_dir = _resolve_against_repo_root(self.demo_data_dir)
        self.test_data_dir = _resolve_against_repo_root(self.test_data_dir)
        self.pytorch_checkpoint_path = _resolve_against_repo_root(self.pytorch_checkpoint_path)
        self.pytorch_inference_dir = _resolve_against_repo_root(self.pytorch_inference_dir)
        self.pytorch_repo_dir = _resolve_against_repo_root(self.pytorch_repo_dir)
        return self

    @model_validator(mode="after")
    def _normalize_inference_mode(self) -> "Settings":
        mode = self.inference_mode.lower()
        if mode not in INFERENCE_MODES:
            raise ValueError(
                f"Invalid INFERENCE_MODE {self.inference_mode!r}. "
                f"Must be one of {sorted(INFERENCE_MODES)}."
            )
        self.inference_mode = mode
        return self


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.output_dir.mkdir(parents=True, exist_ok=True)
