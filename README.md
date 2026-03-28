# Local Metadata Inspector

A local-first web app to inspect and modify metadata in images, videos, and PDFs.

It supports:

- Viewing metadata tags from uploaded files
- Searching metadata by tag or value
- Removing all writable metadata in one click
- Removing only selected tags
- Updating selected tag values
- Downloading the processed file

## 1. Prerequisites

- Python 3.10+
- [ExifTool](https://exiftool.org/) available on `PATH`

### Windows ExifTool setup

1. Download ExifTool for Windows from [exiftool.org](https://exiftool.org/).
2. Extract it and rename `exiftool(-k).exe` to `exiftool.exe`.
3. Put the executable in a folder that is on your system `PATH`.
4. Verify from terminal:

```powershell
exiftool -ver
```

## 2. Install dependencies

```powershell
pip install -r requirements.txt
```

## 3. Run locally

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open:

- <http://127.0.0.1:8000>

## 4. Typical flow

1. Add files.
2. Click **Inspect Files**.
3. Select a file from the left panel.
4. Search tags in the search box.
5. Use one of the actions:
   - **Remove All Metadata**
   - **Remove Selected Tags**
   - **Save Edited Values**
6. Click **Download Current File**.

## Notes

- The app stores uploaded files in a temporary folder during the current session.
- Sessions automatically expire after 6 hours.
- Some format-specific tags are read-only and may not be writable; ExifTool warnings are shown in the status bar.

## 5. Build One Executable (Windows)

From the project root, run:

```powershell
.\build_exe.ps1
```

The generated file is:

- `dist\MetadataInspector.exe`

Build behavior:

- If `exiftool` is available on your machine during build, it is bundled into the executable.
- If `exiftool` is not found, the executable still builds, but ExifTool must exist on `PATH` when you run it.

## 6. Run The Executable

Double-click:

- `dist\MetadataInspector.exe`

It starts the local server and opens your browser automatically.
