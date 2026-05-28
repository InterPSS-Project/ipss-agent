"""Project and Python-root path discovery for ipss-agent."""

from pathlib import Path


def py_root() -> Path:
    """Return ``src/main/py`` (this directory)."""
    return Path(__file__).resolve().parent


def project_root() -> Path:
    """Return the repository root (directory containing ``wspace/`` and ``config/``)."""
    for p in Path(__file__).resolve().parents:
        if (p / "wspace").is_dir() and (p / "config").is_dir():
            return p
    raise RuntimeError("Could not find ipss-agent project root")


def ensure_py_root_on_sys_path() -> Path:
    """Insert ``src/main/py`` on ``sys.path`` if missing; return that path."""
    import sys

    root = py_root()
    root_s = str(root)
    if root_s not in sys.path:
        sys.path.insert(0, root_s)
    return root


def bootstrap_py_root(caller_file: str | Path) -> Path:
    """Add ``src/main/py`` to ``sys.path`` for a script under or below that tree."""
    import sys

    for p in Path(caller_file).resolve().parents:
        if (p / "paths.py").is_file() and (p / "config.py").is_file():
            if str(p) not in sys.path:
                sys.path.insert(0, str(p))
            return p
    raise RuntimeError("Could not find ipss-agent Python root (src/main/py)")
