# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['run_local_app.py'],
    pathex=[],
    binaries=[('C:/Users/WATER/AppData/Local/Programs/ExifTool/ExifTool.exe', '.')],
    datas=[('app/static', 'app/static'), ('C:/Users/WATER/AppData/Local/Programs/ExifTool/exiftool_files', 'exiftool_files')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='MetadataInspector',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
