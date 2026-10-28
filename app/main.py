from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

SESSION_TTL = timedelta(hours=6)
TAG_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")
APP_TEMP_ROOT = Path(tempfile.gettempdir()) / "remove-file-metadata"
UPLOAD_TEMP_ROOT = APP_TEMP_ROOT / "uploads"


class FileSummary(BaseModel):
    id: str
    name: str
    content_type: Optional[str]
    size_bytes: int
    metadata: dict[str, Any]
    original_metadata: dict[str, Any] = Field(default_factory=dict)


class InspectResponse(BaseModel):
    files: list[FileSummary]


class MetadataResponse(BaseModel):
    file: FileSummary


class TagRemoveRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)


class TagUpdateRequest(BaseModel):
    updates: dict[str, str] = Field(default_factory=dict)


class BatchFileRequest(BaseModel):
    file_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    updates: dict[str, str] = Field(default_factory=dict)
    preset: Optional[str] = None


class ActionResponse(BaseModel):
    message: str
    warnings: list[str] = Field(default_factory=list)
    file: FileSummary


class BatchActionResponse(BaseModel):
    message: str
    warnings: list[str] = Field(default_factory=list)
    files: list[FileSummary] = Field(default_factory=list)


PRIVACY_PRESETS: dict[str, list[str]] = {
    "location": [
        "GPSLatitude", "GPSLongitude", "GPSAltitude", "GPSPosition",
        "GPSDateStamp", "GPSTimeStamp", "GPSImgDirection", "GPSDestBearing",
    ],
    "personal": [
        "Artist", "Author", "Creator", "By-line", "By-lineTitle",
        "OwnerName", "Copyright", "Comment", "Description",
    ],
    "device": [
        "Make", "Model", "SerialNumber", "CameraSerialNumber",
        "LensModel", "LensSerialNumber", "Software", "HostComputer",
    ],
    "timestamps": [
        "DateTimeOriginal", "CreateDate", "ModifyDate", "FileModifyDate",
        "FileCreateDate", "FileAccessDate", "MetadataDate",
    ],
}


@dataclass
class StoredFile:
    id: str
    original_name: str
    content_type: Optional[str]
    size_bytes: int
    created_at: datetime
    source_path: Path
    working_path: Path


class SessionStore:
    def __init__(self) -> None:
        self.root = UPLOAD_TEMP_ROOT
        self.root.mkdir(parents=True, exist_ok=True)
        self._files: dict[str, StoredFile] = {}

    def clear_all(self) -> None:
        self._files.clear()
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True, exist_ok=True)

    def cleanup_legacy_layout(self) -> None:
        # Older builds stored upload sessions directly under APP_TEMP_ROOT.
        if not APP_TEMP_ROOT.exists():
            return

        for child in APP_TEMP_ROOT.iterdir():
            if not child.is_dir():
                continue
            if child.name in {"uploads", "exiftool-runtime"}:
                continue
            if re.fullmatch(r"[0-9a-f]{32}", child.name):
                shutil.rmtree(child, ignore_errors=True)

    def cleanup(self) -> None:
        now = datetime.now(timezone.utc)
        expired_ids: list[str] = []

        for file_id, item in self._files.items():
            if now - item.created_at > SESSION_TTL:
                expired_ids.append(file_id)

        for file_id in expired_ids:
            item = self._files.pop(file_id)
            shutil.rmtree(item.source_path.parent, ignore_errors=True)

    async def add_upload(self, upload: UploadFile) -> StoredFile:
        file_id = uuid.uuid4().hex
        folder = self.root / file_id
        folder.mkdir(parents=True, exist_ok=True)

        extension = Path(upload.filename or "").suffix
        source_path = folder / f"source{extension}"
        working_path = folder / f"working{extension}"

        size_bytes = 0
        with source_path.open("wb") as out_file:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                out_file.write(chunk)

        shutil.copy2(source_path, working_path)

        item = StoredFile(
            id=file_id,
            original_name=upload.filename or f"file-{file_id}",
            content_type=upload.content_type,
            size_bytes=size_bytes,
            created_at=datetime.now(timezone.utc),
            source_path=source_path,
            working_path=working_path,
        )
        self._files[file_id] = item
        return item

    def get(self, file_id: str) -> StoredFile:
        item = self._files.get(file_id)
        if item is None:
            raise HTTPException(status_code=404, detail="File session not found or expired.")
        return item


class ExifToolService:
    def __init__(self) -> None:
        self._perl_required_but_missing = False
        self._probe_errors: list[str] = []
        self.command = self._find_command()

    def _candidate_from_bundle(self, candidate: Path) -> bool:
        if not getattr(sys, "frozen", False):
            return False

        bundle_root = getattr(sys, "_MEIPASS", None)
        if not bundle_root:
            return False

        bundle_path = Path(bundle_root).resolve()
        candidate_path = candidate.resolve()

        try:
            return candidate_path.is_relative_to(bundle_path)
        except ValueError:
            return False

    def _prepare_executable_candidate(self, candidate: Path) -> Path:
        if not self._candidate_from_bundle(candidate):
            return candidate

        support_dir = candidate.parent / "exiftool_files"
        if not support_dir.exists() or not support_dir.is_dir():
            return candidate

        # The Windows ExifTool launcher may fail when executed directly from
        # PyInstaller's _MEI extraction directory, so copy it to a stable temp location.
        runtime_root = APP_TEMP_ROOT / "exiftool-runtime"
        stamp = f"{candidate.stat().st_size}-{candidate.stat().st_mtime_ns}"
        target_root = runtime_root / stamp
        target_exe = target_root / candidate.name
        target_support = target_root / "exiftool_files"
        ready_marker = target_root / ".ready"

        if not ready_marker.exists():
            target_root.mkdir(parents=True, exist_ok=True)

            if target_exe.exists():
                target_exe.unlink()

            if target_support.exists():
                shutil.rmtree(target_support, ignore_errors=True)

            shutil.copy2(candidate, target_exe)
            shutil.copytree(support_dir, target_support)
            ready_marker.write_text("ok", encoding="ascii")

        return target_exe

    def _command_works(self, command: list[str]) -> bool:
        try:
            completed = subprocess.run(
                [*command, "-ver"],
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            self._probe_errors.append(str(exc))
            return False

        if completed.returncode == 0:
            return True

        message = completed.stderr.strip() or completed.stdout.strip() or f"Exit code {completed.returncode}"
        self._probe_errors.append(message)
        return False

    @staticmethod
    def _local_search_roots() -> list[Path]:
        local_roots: list[Path] = []

        if getattr(sys, "frozen", False):
            bundle_root = getattr(sys, "_MEIPASS", None)
            if bundle_root:
                local_roots.extend(
                    [
                        Path(bundle_root),
                        Path(bundle_root) / "Image-ExifTool-13.53",
                        Path(bundle_root) / "Image-ExifTool-13.53" / "Image-ExifTool-13.53",
                    ]
                )

            executable_dir = Path(sys.executable).resolve().parent
            local_roots.extend(
                [
                    executable_dir,
                    executable_dir / "Image-ExifTool-13.53",
                    executable_dir / "Image-ExifTool-13.53" / "Image-ExifTool-13.53",
                ]
            )

        project_root = Path(__file__).resolve().parents[1]
        local_roots.extend(
            [
                project_root,
                project_root / "Image-ExifTool-13.53",
                project_root / "Image-ExifTool-13.53" / "Image-ExifTool-13.53",
            ]
        )

        return local_roots

    def _find_command(self) -> Optional[list[str]]:
        executable_names: tuple[str, ...]
        if os.name == "nt":
            executable_names = ("exiftool.exe", "exiftool(-k).exe")
        else:
            executable_names = ("exiftool", "exiftool.exe", "exiftool(-k).exe")

        for root in self._local_search_roots():
            for name in executable_names:
                candidate = root / name
                if candidate.exists() and candidate.is_file():
                    prepared = self._prepare_executable_candidate(candidate)
                    command = [str(prepared)]
                    if self._command_works(command):
                        return command

        path_candidates: tuple[str, ...]
        if os.name == "nt":
            path_candidates = ("exiftool.exe", "exiftool(-k).exe", "exiftool")
        else:
            path_candidates = ("exiftool", "exiftool.exe", "exiftool(-k).exe")

        for candidate in path_candidates:
            resolved = shutil.which(candidate)
            if resolved:
                command = [resolved]
                if self._command_works(command):
                    return command

        for root in self._local_search_roots():
            script_candidate = root / "exiftool"
            if not script_candidate.exists() or not script_candidate.is_file():
                continue

            perl_path = shutil.which("perl")
            if perl_path:
                command = [perl_path, str(script_candidate)]
                if self._command_works(command):
                    return command

            self._perl_required_but_missing = True
            return None

        return None

    def ensure_available(self) -> None:
        if self.command:
            return

        if self._perl_required_but_missing:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Found local ExifTool Perl source, but Perl is not available. "
                    "Install Perl, or place exiftool.exe in the project root."
                ),
            )

        raise HTTPException(
            status_code=503,
            detail=(
                "ExifTool is not available. Add exiftool to PATH, place exiftool.exe next "
                "to the executable, or bundle it during build."
                + (f" Last probe error: {self._probe_errors[0]}" if self._probe_errors else "")
            ),
        )

    def _run(self, args: list[str]) -> tuple[str, list[str]]:
        self.ensure_available()
        command = [*(self.command or []), *args]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        warnings = [line.strip() for line in completed.stderr.splitlines() if line.strip()]

        if completed.returncode > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    "ExifTool operation failed. "
                    + (warnings[0] if warnings else "Unknown ExifTool error.")
                ),
            )

        return completed.stdout, warnings

    def read_metadata(self, file_path: Path) -> dict[str, Any]:
        output, _warnings = self._run(
            [
                "-j",
                "-G1",
                "-a",
                "-s",
                str(file_path),
            ]
        )

        try:
            parsed = json.loads(output)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not parse ExifTool response: {exc}",
            ) from exc

        if not parsed:
            return {}

        metadata = dict(parsed[0])
        metadata.pop("SourceFile", None)
        return metadata

    def remove_all(self, file_path: Path) -> list[str]:
        _output, warnings = self._run(["-overwrite_original", "-all=", str(file_path)])
        return warnings

    def remove_selected(self, file_path: Path, tags: list[str]) -> list[str]:
        if not tags:
            raise HTTPException(status_code=400, detail="No tags were provided.")

        args = ["-overwrite_original"]

        for tag in tags:
            cleaned = tag.strip()
            if not cleaned:
                continue
            if cleaned == "SourceFile":
                continue
            if not TAG_PATTERN.match(cleaned):
                raise HTTPException(status_code=400, detail=f"Invalid tag name: {cleaned}")
            args.append(f"-{cleaned}=")

        if len(args) == 1:
            raise HTTPException(status_code=400, detail="No valid tags were provided.")

        args.append(str(file_path))
        _output, warnings = self._run(args)
        return warnings

    def update_tags(self, file_path: Path, updates: dict[str, str]) -> list[str]:
        if not updates:
            raise HTTPException(status_code=400, detail="No updates were provided.")

        args = ["-overwrite_original"]

        for tag, value in updates.items():
            cleaned = tag.strip()
            if cleaned == "SourceFile":
                continue
            if not TAG_PATTERN.match(cleaned):
                raise HTTPException(status_code=400, detail=f"Invalid tag name: {cleaned}")

            normalized_value = "" if value is None else str(value)
            args.append(f"-{cleaned}={normalized_value}")

        if len(args) == 1:
            raise HTTPException(status_code=400, detail="No valid updates were provided.")

        args.append(str(file_path))
        _output, warnings = self._run(args)
        return warnings


store = SessionStore()
exiftool = ExifToolService()

app = FastAPI(title="Local Metadata Inspector", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def cleanup_temp_on_startup() -> None:
    store.clear_all()
    store.cleanup_legacy_layout()


@app.on_event("shutdown")
def cleanup_temp_on_shutdown() -> None:
    store.clear_all()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "exiftool_available": exiftool.command is not None,
    }


@app.post("/api/inspect", response_model=InspectResponse)
async def inspect_files(files: list[UploadFile] = File(...)) -> InspectResponse:
    store.cleanup()
    exiftool.ensure_available()

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    summaries: list[FileSummary] = []

    for upload in files:
        item = await store.add_upload(upload)
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return InspectResponse(files=summaries)


@app.get("/api/files/{file_id}/metadata", response_model=MetadataResponse)
def get_file_metadata(file_id: str) -> MetadataResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    metadata = exiftool.read_metadata(item.working_path)
    original_metadata = exiftool.read_metadata(item.source_path)
    return MetadataResponse(
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
            original_metadata=original_metadata,
        )
    )


@app.post("/api/files/{file_id}/remove_all", response_model=ActionResponse)
def remove_all_metadata(file_id: str) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.remove_all(item.working_path)
    metadata = exiftool.read_metadata(item.working_path)
    original_metadata = exiftool.read_metadata(item.source_path)

    return ActionResponse(
        message="All writable metadata removed.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
            original_metadata=original_metadata,
        ),
    )


@app.post("/api/files/{file_id}/remove_selected", response_model=ActionResponse)
def remove_selected_metadata(file_id: str, request: TagRemoveRequest) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.remove_selected(item.working_path, request.tags)
    metadata = exiftool.read_metadata(item.working_path)
    original_metadata = exiftool.read_metadata(item.source_path)

    return ActionResponse(
        message="Selected tags removed.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
            original_metadata=original_metadata,
        ),
    )


@app.post("/api/files/{file_id}/update_tags", response_model=ActionResponse)
def update_selected_tags(file_id: str, request: TagUpdateRequest) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.update_tags(item.working_path, request.updates)
    metadata = exiftool.read_metadata(item.working_path)
    original_metadata = exiftool.read_metadata(item.source_path)

    return ActionResponse(
        message="Selected tag values updated.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
            original_metadata=original_metadata,
        ),
    )


def _dedupe_file_ids(file_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []

    for file_id in file_ids:
        if not file_id or file_id in seen:
            continue
        seen.add(file_id)
        ordered.append(file_id)

    return ordered


@app.post("/api/files/batch/remove_all", response_model=BatchActionResponse)
def batch_remove_all_metadata(request: BatchFileRequest) -> BatchActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for batch processing.")

    summaries: list[FileSummary] = []
    warnings: list[str] = []

    for file_id in file_ids:
        item = store.get(file_id)
        warnings.extend(exiftool.remove_all(item.working_path))
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return BatchActionResponse(
        message="Metadata removed from all selected files.",
        warnings=warnings,
        files=summaries,
    )


@app.post("/api/files/batch/remove_selected", response_model=BatchActionResponse)
def batch_remove_selected_metadata(request: BatchFileRequest) -> BatchActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for batch processing.")
    if not request.tags:
        raise HTTPException(status_code=400, detail="No tags were provided.")

    summaries: list[FileSummary] = []
    warnings: list[str] = []

    for file_id in file_ids:
        item = store.get(file_id)
        warnings.extend(exiftool.remove_selected(item.working_path, request.tags))
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return BatchActionResponse(
        message="Selected tags removed from all selected files.",
        warnings=warnings,
        files=summaries,
    )


@app.post("/api/files/batch/update_tags", response_model=BatchActionResponse)
def batch_update_selected_tags(request: BatchFileRequest) -> BatchActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for batch processing.")
    if not request.updates:
        raise HTTPException(status_code=400, detail="No updates were provided.")

    summaries: list[FileSummary] = []
    warnings: list[str] = []

    for file_id in file_ids:
        item = store.get(file_id)
        warnings.extend(exiftool.update_tags(item.working_path, request.updates))
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return BatchActionResponse(
        message="Selected tag values updated in all selected files.",
        warnings=warnings,
        files=summaries,
    )


@app.post("/api/files/batch/reset", response_model=BatchActionResponse)
def batch_reset_files(request: BatchFileRequest) -> BatchActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for batch processing.")

    summaries: list[FileSummary] = []

    for file_id in file_ids:
        item = store.get(file_id)
        shutil.copy2(item.source_path, item.working_path)
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return BatchActionResponse(
        message="All selected files were reset to their original state.",
        warnings=[],
        files=summaries,
    )


@app.post("/api/files/batch/preset", response_model=BatchActionResponse)
def batch_apply_privacy_preset(request: BatchFileRequest) -> BatchActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for batch processing.")
    if request.preset == "all":
        tags = []
    elif request.preset in PRIVACY_PRESETS:
        tags = PRIVACY_PRESETS[request.preset]
    else:
        raise HTTPException(status_code=400, detail="Unknown privacy preset.")

    summaries: list[FileSummary] = []
    warnings: list[str] = []

    for file_id in file_ids:
        item = store.get(file_id)
        if request.preset == "all":
            warnings.extend(exiftool.remove_all(item.working_path))
        else:
            warnings.extend(exiftool.remove_selected(item.working_path, tags))
        metadata = exiftool.read_metadata(item.working_path)
        original_metadata = exiftool.read_metadata(item.source_path)
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
                original_metadata=original_metadata,
            )
        )

    return BatchActionResponse(
        message="Privacy preset applied to all selected files.",
        warnings=warnings,
        files=summaries,
    )


@app.post("/api/files/batch/download")
def download_batch_files(request: BatchFileRequest) -> FileResponse:
    store.cleanup()
    file_ids = _dedupe_file_ids(request.file_ids)
    if not file_ids:
        raise HTTPException(status_code=400, detail="No files were selected for download.")

    archive_path = APP_TEMP_ROOT / f"metadata-cleaned-{uuid.uuid4().hex}.zip"
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            used_names: set[str] = set()
            for file_id in file_ids:
                item = store.get(file_id)
                original = Path(item.original_name)
                base_name = f"{original.stem}_metadata_cleaned{original.suffix}"
                download_name = base_name
                suffix = 2
                while download_name in used_names:
                    download_name = f"{original.stem}_metadata_cleaned_{suffix}{original.suffix}"
                    suffix += 1
                used_names.add(download_name)
                archive.write(item.working_path, arcname=download_name)
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise

    return FileResponse(
        path=archive_path,
        filename="metadata-cleaned-files.zip",
        media_type="application/zip",
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@app.post("/api/files/{file_id}/reset", response_model=ActionResponse)
def reset_file(file_id: str) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    shutil.copy2(item.source_path, item.working_path)
    metadata = exiftool.read_metadata(item.working_path)

    original_metadata = exiftool.read_metadata(item.source_path)
    return ActionResponse(
        message="File reset to original uploaded state.",
        warnings=[],
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
            original_metadata=original_metadata,
        ),
    )


@app.get("/api/files/{file_id}/download")
def download_current(file_id: str) -> FileResponse:
    store.cleanup()

    item = store.get(file_id)
    original = Path(item.original_name)
    download_name = f"{original.stem}_metadata_cleaned{original.suffix}"

    return FileResponse(
        path=item.working_path,
        filename=download_name,
        media_type="application/octet-stream",
    )


static_dir = Path(__file__).resolve().parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
