# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the PageNode backend sidecar binary.

Handles native extensions:
  - chromadb  (onnxruntime + sqlite3 shared libs)
  - onnxruntime
  - kuzu      (compiled graph DB binary)
  - PyMuPDF   (fitz C extension)

llama-cpp-python is intentionally excluded — complex CUDA/CPU native build.
Users should use Ollama for local LLM inference.
"""
from PyInstaller.utils.hooks import collect_all

block_cipher = None

# Collect everything for packages with native extensions or dynamic data files
chromadb_datas, chromadb_binaries, chromadb_hiddenimports = collect_all("chromadb")
onnxruntime_datas, onnxruntime_binaries, onnxruntime_hiddenimports = collect_all("onnxruntime")
kuzu_datas, kuzu_binaries, kuzu_hiddenimports = collect_all("kuzu")

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=chromadb_binaries + onnxruntime_binaries + kuzu_binaries,
    datas=chromadb_datas + onnxruntime_datas + kuzu_datas,
    hiddenimports=(
        chromadb_hiddenimports
        + onnxruntime_hiddenimports
        + kuzu_hiddenimports
        + [
            # uvicorn dynamic imports
            "uvicorn.logging",
            "uvicorn.loops",
            "uvicorn.loops.auto",
            "uvicorn.protocols",
            "uvicorn.protocols.http",
            "uvicorn.protocols.http.auto",
            "uvicorn.protocols.websockets",
            "uvicorn.protocols.websockets.auto",
            "uvicorn.lifespan",
            "uvicorn.lifespan.on",
            # pydantic / fastapi
            "aiosqlite",
            "pydantic_settings",
            "multipart",
            "python_multipart",
            # huggingface
            "huggingface_hub",
            "tqdm",
        ]
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "llama_cpp",    # excluded: complex native build
        "tkinter",      # not needed
        "matplotlib",   # not needed
        "numpy.testing",
        "PIL",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="pagenode-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # upx can break native extensions
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,       # REQUIRED: stdout must be visible so Tauri can parse PORT=XXXX
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    onefile=True,       # single binary, no dist/ folder
)
