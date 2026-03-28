from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

SESSION_TTL = timedelta(hours=6)
TAG_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")


class FileSummary(BaseModel):
    id: str
    name: str
    content_type: str | None
    size_bytes: int
    metadata: dict[str, Any]


class InspectResponse(BaseModel):
    files: list[FileSummary]


class MetadataResponse(BaseModel):
    file: FileSummary


class TagRemoveRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)


class TagUpdateRequest(BaseModel):
    updates: dict[str, str] = Field(default_factory=dict)


class ActionResponse(BaseModel):
    message: str
    warnings: list[str] = Field(default_factory=list)
    file: FileSummary


@dataclass
class StoredFile:
    id: str
    original_name: str
    content_type: str | None
    size_bytes: int
    created_at: datetime
    source_path: Path
    working_path: Path


class SessionStore:
    def __init__(self) -> None:
        self.root = Path(tempfile.gettempdir()) / "remove-file-metadata"
        self.root.mkdir(parents=True, exist_ok=True)
        self._files: dict[str, StoredFile] = {}

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
        self.binary = self._find_binary()

    @staticmethod
    def _find_binary() -> str | None:
        for candidate in ("exiftool", "exiftool.exe"):
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
        return None

    def ensure_available(self) -> None:
        if self.binary:
            return
        raise HTTPException(
            status_code=503,
            detail=(
                "ExifTool is not available on PATH. Install ExifTool and ensure `exiftool` "
                "is executable from your terminal."
            ),
        )

    def _run(self, args: list[str]) -> tuple[str, list[str]]:
        self.ensure_available()
        completed = subprocess.run(
            args,
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
                self.binary or "exiftool",
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
        _output, warnings = self._run(
            [self.binary or "exiftool", "-overwrite_original", "-all=", str(file_path)]
        )
        return warnings

    def remove_selected(self, file_path: Path, tags: list[str]) -> list[str]:
        if not tags:
            raise HTTPException(status_code=400, detail="No tags were provided.")

        args = [self.binary or "exiftool", "-overwrite_original"]

        for tag in tags:
            cleaned = tag.strip()
            if not cleaned:
                continue
            if cleaned == "SourceFile":
                continue
            if not TAG_PATTERN.match(cleaned):
                raise HTTPException(status_code=400, detail=f"Invalid tag name: {cleaned}")
            args.append(f"-{cleaned}=")

        if len(args) == 2:
            raise HTTPException(status_code=400, detail="No valid tags were provided.")

        args.append(str(file_path))
        _output, warnings = self._run(args)
        return warnings

    def update_tags(self, file_path: Path, updates: dict[str, str]) -> list[str]:
        if not updates:
            raise HTTPException(status_code=400, detail="No updates were provided.")

        args = [self.binary or "exiftool", "-overwrite_original"]

        for tag, value in updates.items():
            cleaned = tag.strip()
            if cleaned == "SourceFile":
                continue
            if not TAG_PATTERN.match(cleaned):
                raise HTTPException(status_code=400, detail=f"Invalid tag name: {cleaned}")

            normalized_value = "" if value is None else str(value)
            args.append(f"-{cleaned}={normalized_value}")

        if len(args) == 2:
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


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "exiftool_available": exiftool.binary is not None,
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
        summaries.append(
            FileSummary(
                id=item.id,
                name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                metadata=metadata,
            )
        )

    return InspectResponse(files=summaries)


@app.get("/api/files/{file_id}/metadata", response_model=MetadataResponse)
def get_file_metadata(file_id: str) -> MetadataResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    metadata = exiftool.read_metadata(item.working_path)
    return MetadataResponse(
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
        )
    )


@app.post("/api/files/{file_id}/remove_all", response_model=ActionResponse)
def remove_all_metadata(file_id: str) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.remove_all(item.working_path)
    metadata = exiftool.read_metadata(item.working_path)

    return ActionResponse(
        message="All writable metadata removed.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
        ),
    )


@app.post("/api/files/{file_id}/remove_selected", response_model=ActionResponse)
def remove_selected_metadata(file_id: str, request: TagRemoveRequest) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.remove_selected(item.working_path, request.tags)
    metadata = exiftool.read_metadata(item.working_path)

    return ActionResponse(
        message="Selected tags removed.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
        ),
    )


@app.post("/api/files/{file_id}/update_tags", response_model=ActionResponse)
def update_selected_tags(file_id: str, request: TagUpdateRequest) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    warnings = exiftool.update_tags(item.working_path, request.updates)
    metadata = exiftool.read_metadata(item.working_path)

    return ActionResponse(
        message="Selected tag values updated.",
        warnings=warnings,
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
        ),
    )


@app.post("/api/files/{file_id}/reset", response_model=ActionResponse)
def reset_file(file_id: str) -> ActionResponse:
    store.cleanup()
    exiftool.ensure_available()

    item = store.get(file_id)
    shutil.copy2(item.source_path, item.working_path)
    metadata = exiftool.read_metadata(item.working_path)

    return ActionResponse(
        message="File reset to original uploaded state.",
        warnings=[],
        file=FileSummary(
            id=item.id,
            name=item.original_name,
            content_type=item.content_type,
            size_bytes=item.size_bytes,
            metadata=metadata,
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
