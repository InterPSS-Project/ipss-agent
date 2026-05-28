"""Project root discovery for ipss-agent."""

from pathlib import Path


def project_root() -> Path:
    """Return the repository root (directory containing ``wspace/`` and ``config/``)."""
    for p in Path(__file__).resolve().parents:
        if (p / "wspace").is_dir() and (p / "config").is_dir():
            return p
    raise RuntimeError("Could not find ipss-agent project root")


def ensure_repo_on_sys_path() -> Path:
    """Insert project root on ``sys.path`` if missing; return the root path."""
    import sys

    root = project_root()
    root_s = str(root)
    if root_s not in sys.path:
        sys.path.insert(0, root_s)
    return root
