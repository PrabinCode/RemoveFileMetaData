# Local Metadata Inspector

A local-first web app to inspect and modify metadata in images, videos, PDFs, and common document files.

It supports:

- Viewing metadata tags from uploaded files
- Searching metadata by tag or value
- Removing all writable metadata in one click
- Removing only selected tags
- Updating selected tag values
- Adding new metadata tags and values, then saving them with **Save Changes**
- Applying batch actions across multiple files at once
- Resetting files back to their original uploaded state
- Comparing current metadata against the original file state
- Showing detailed added, removed, and changed metadata values
- Applying privacy presets for location, personal, device, and timestamp data
- Downloading all selected processed files as a ZIP archive
- Showing file-type and metadata capability indicators
- Providing an in-app metadata tag guide with example values and tag meanings
- Loading the complete installed ExifTool tag reference independently of uploaded files
- Bundling the tag reference in the project with client-side pagination and search
- Downloading the processed file
- Handling common image, video, document, and PDF formats through ExifTool

## 1. Prerequisites

- Python 3.9+
- ExifTool command-line engine

### ExifTool options (choose one)

1. Place `exiftool.exe` in the project root.
2. Keep the Windows ExifTool package in `Image-ExifTool-13.53` with `exiftool.exe` (or `exiftool(-k).exe`) inside.
3. Put `exiftool` on your system `PATH`.

### Windows ExifTool setup

1. Download ExifTool for Windows from [exiftool.org](https://exiftool.org/).
2. Extract it and rename `exiftool(-k).exe` to `exiftool.exe`.
3. Either place it in this project root or put it on your system `PATH`.
4. Verify from terminal:

```powershell
exiftool -ver
```

## 2. Install dependencies

```powershell
pip install -r requirements.txt
```

### Why these dependencies exist

1. `fastapi` powers the local API.
2. `uvicorn` runs the local server.
3. `python-multipart` handles file uploads.
4. `exiftool` is the metadata engine for images, videos, and PDFs.

Without ExifTool, this app cannot reliably inspect and edit metadata across all these file types.

If you only added `Image-ExifTool-13.53` source code (the `exiftool` Perl script), Perl is also required at runtime.
If you want zero Perl dependency, use the Windows executable package that includes `exiftool.exe`.

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

To add a tag, enter its name and value in the **New tag name** and **New tag
value** fields, then click **Add Tag**. The tag is shown immediately as an
added pending change and remains available if you select another file. Click
**Save Changes** to write it to the working file. Click **Download** afterward
to download the saved working copy. If you leave the page or reload it before
saving, pending changes are lost.

New tag names must be recognized by ExifTool and supported by the file format.
The application does not define a project-specific custom namespace. Use a
standard tag or a namespace defined by the relevant metadata specification.

Click the **!** icon beside the title to open the metadata tag guide. It lists
the complete tag database from the installed ExifTool, including tag names,
descriptions, metadata groups, value types, contextual example values, and
writable status. Specialized or read-only tags are labeled as format-specific
instead of being given a misleading generic value. Use the search, group filter, and **Writable only** filter to find
tags without selecting a file. Availability and write support still depend on
the file format and ExifTool.

The complete tag reference is stored in
[`app/static/tag-reference.json`](./app/static/tag-reference.json), generated
from the local ExifTool database. The application does not call an external
tag-reference service or rebuild the reference at runtime. The guide loads
this bundled file once, then performs searching, filtering, and 50-result
pagination locally in the browser.

For multiple files, select the file checkboxes and use the batch actions. The
privacy preset menu removes common sensitive metadata groups without requiring
you to know individual ExifTool tag names. Use **Download ZIP** to download all
selected working copies together.

## Notes

- The app stores uploaded files in a temporary folder during the current session.
- Uploaded temp files are deleted automatically when the app starts and when it shuts down normally.
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

- The build script first looks for local `exiftool.exe` in your project folders and bundles it.
- If no local binary is found, it falls back to `PATH`.
- If only the source package script is found, you must install Perl or provide `exiftool.exe`.

## 6. Run The Executable

Double-click:

- `dist\MetadataInspector.exe`

It starts the local server and opens your browser automatically.
