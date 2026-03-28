$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Installing build dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pyinstaller

$pyInstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "MetadataInspector",
    "--add-data", "app\static;app\static"
)

$exifToolCommand = Get-Command exiftool.exe -ErrorAction SilentlyContinue
if (-not $exifToolCommand) {
    $exifToolCommand = Get-Command exiftool -ErrorAction SilentlyContinue
}

if ($exifToolCommand) {
    Write-Host "Bundling ExifTool from: $($exifToolCommand.Source)"
    $pyInstallerArgs += @("--add-binary", "$($exifToolCommand.Source);.")
}
else {
    Write-Warning "ExifTool was not found. The executable will require ExifTool on PATH at runtime."
}

$pyInstallerArgs += "run_local_app.py"

Write-Host "Building one-file executable..."
python @pyInstallerArgs

Write-Host "Build complete."
Write-Host "Executable: $PSScriptRoot\dist\MetadataInspector.exe"
