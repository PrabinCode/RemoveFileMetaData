$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Installing build dependencies..."
python -m pip install -r requirements.txt
python -m pip install pyinstaller

$pyInstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "MetadataInspector",
    "--add-data", "app\static;app\static"
)

$localExifToolCandidates = @(
    (Join-Path $PSScriptRoot "exiftool.exe"),
    (Join-Path $PSScriptRoot "exiftool(-k).exe"),
    (Join-Path $PSScriptRoot "Image-ExifTool-13.53\exiftool.exe"),
    (Join-Path $PSScriptRoot "Image-ExifTool-13.53\exiftool(-k).exe"),
    (Join-Path $PSScriptRoot "Image-ExifTool-13.53\Image-ExifTool-13.53\exiftool.exe"),
    (Join-Path $PSScriptRoot "Image-ExifTool-13.53\Image-ExifTool-13.53\exiftool(-k).exe")
)

$exifToolBinary = $null
foreach ($candidate in $localExifToolCandidates) {
    if (Test-Path $candidate -PathType Leaf) {
        $exifToolBinary = (Resolve-Path $candidate).Path
        break
    }
}

if (-not $exifToolBinary) {
    $exifToolCommand = Get-Command exiftool.exe -ErrorAction SilentlyContinue
    if (-not $exifToolCommand) {
        $exifToolCommand = Get-Command exiftool -ErrorAction SilentlyContinue
    }
    if ($exifToolCommand) {
        $exifToolBinary = $exifToolCommand.Source
    }
}

if ($exifToolBinary) {
    Write-Host "Bundling ExifTool from: $exifToolBinary"
    $pyInstallerArgs += @("--add-binary", "$exifToolBinary;.")

    $exifToolDir = Split-Path -Parent $exifToolBinary
    $exifToolFilesDir = Join-Path $exifToolDir "exiftool_files"
    if (Test-Path $exifToolFilesDir -PathType Container) {
        Write-Host "Bundling ExifTool support folder: $exifToolFilesDir"
        $pyInstallerArgs += @("--add-data", "$exifToolFilesDir;exiftool_files")
    }
    else {
        Write-Warning "exiftool_files folder was not found next to ExifTool binary. Runtime may fail if this binary depends on it."
    }
}
else {
    $sourcePackageScript = Join-Path $PSScriptRoot "Image-ExifTool-13.53\Image-ExifTool-13.53\exiftool"
    if (Test-Path $sourcePackageScript -PathType Leaf) {
        Write-Warning "Found ExifTool Perl source package only. Add exiftool.exe, or install Perl to use the script at runtime."
    }
    else {
        Write-Warning "ExifTool binary was not found. Add exiftool.exe to project root or PATH before building."
    }
}

$pyInstallerArgs += "run_local_app.py"

Write-Host "Building one-file executable..."
python @pyInstallerArgs

Write-Host "Build complete."
Write-Host "Executable: $PSScriptRoot\dist\MetadataInspector.exe"
