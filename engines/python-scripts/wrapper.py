#!/usr/bin/env python3
"""
Method Studio Python Wrapper

Reads a JSON request from stdin, executes the provided script in an isolated
namespace, captures stdout/stderr and matplotlib figures, then writes a single
JSON response to stdout.

Wire format (stdin):
  {
    "id": "<uuid>",
    "script": "<python source>",
    "data": { ...variables injected into namespace },
    "packages": ["numpy", "pandas", ...]
  }

Wire format (stdout, last line):
  {
    "id": "<uuid>",
    "success": true|false,
    "result": <serialized result>,
    "error": "<message>",
    "traceback": "<traceback>",
    "output": "<captured stdout>",
    "plots": ["<base64 png>", ...]
  }
"""

import sys
import json
import io
import traceback
import base64
import contextlib


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def _serialize(obj, _depth=0):
    """
    Recursively serialize Python objects to JSON-compatible types.
    Handles numpy arrays, pandas DataFrames/Series, and common scalars.
    Depth limit prevents runaway recursion on circular structures.
    """
    if _depth > 20:
        return str(obj)

    # None, bool, int, float, str → pass through
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj

    # numpy scalars
    try:
        import numpy as np
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return {
                "__type": "ndarray",
                "dtype": str(obj.dtype),
                "shape": list(obj.shape),
                "data": _serialize(obj.tolist(), _depth + 1),
            }
    except ImportError:
        pass

    # pandas DataFrame
    try:
        import pandas as pd
        if isinstance(obj, pd.DataFrame):
            return {
                "__type": "DataFrame",
                "columns": list(obj.columns),
                "index": _serialize(list(obj.index), _depth + 1),
                "data": _serialize(obj.values.tolist(), _depth + 1),
            }
        if isinstance(obj, pd.Series):
            return {
                "__type": "DataFrame",
                "columns": [str(obj.name) if obj.name is not None else "value"],
                "index": _serialize(list(obj.index), _depth + 1),
                "data": [[v] for v in _serialize(obj.tolist(), _depth + 1)],
            }
    except ImportError:
        pass

    # lists / tuples
    if isinstance(obj, (list, tuple)):
        return [_serialize(v, _depth + 1) for v in obj]

    # dicts
    if isinstance(obj, dict):
        return {str(k): _serialize(v, _depth + 1) for k, v in obj.items()}

    # fallback: try str
    try:
        return str(obj)
    except Exception:
        return "<unserializable>"


# ---------------------------------------------------------------------------
# Matplotlib capture
# ---------------------------------------------------------------------------

def _capture_plots():
    """
    Return a list of base64-encoded PNG strings for all currently open
    matplotlib figures, then close them.
    """
    plots = []
    try:
        import matplotlib
        matplotlib.use("Agg")  # non-interactive backend
        import matplotlib.pyplot as plt

        for fig_num in plt.get_fignums():
            fig = plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
            buf.seek(0)
            plots.append(base64.b64encode(buf.read()).decode("utf-8"))
            plt.close(fig)
    except ImportError:
        pass
    return plots


# ---------------------------------------------------------------------------
# Script execution
# ---------------------------------------------------------------------------

def _execute(request: dict) -> dict:
    req_id = request.get("id", "")
    script = request.get("script", "")
    data = request.get("data", {})
    packages = request.get("packages", [])

    # Support delegating to a named script file via __script_path__
    script_path = data.pop("__script_path__", None)
    if script_path:
        try:
            with open(script_path, "r", encoding="utf-8") as fh:
                script = fh.read()
        except OSError as exc:
            return {
                "id": req_id,
                "success": False,
                "error": f"Cannot open script file '{script_path}': {exc}",
            }

    # Build isolated namespace pre-populated with injected data.
    # Both the raw 'data' dict and its individual keys are injected so scripts
    # can reference either `data["key"]` or the key as a bare variable.
    namespace: dict = {"__builtins__": __builtins__}
    namespace["data"] = data
    namespace.update(data)

    # Capture stdout from the script
    stdout_capture = io.StringIO()

    try:
        with contextlib.redirect_stdout(stdout_capture):
            exec(compile(script, "<method-studio-script>", "exec"), namespace)  # noqa: S102
    except Exception:
        tb = traceback.format_exc()
        return {
            "id": req_id,
            "success": False,
            "error": tb.strip().splitlines()[-1],
            "traceback": tb,
            "output": stdout_capture.getvalue(),
            "plots": [],
        }

    plots = _capture_plots()
    raw_result = namespace.get("result")

    return {
        "id": req_id,
        "success": True,
        "result": _serialize(raw_result),
        "output": stdout_capture.getvalue(),
        "plots": plots,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    # Configure matplotlib early so imports inside scripts see Agg backend
    try:
        import matplotlib
        matplotlib.use("Agg")
    except ImportError:
        pass

    raw = sys.stdin.read()
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        response = {
            "id": "",
            "success": False,
            "error": f"Invalid JSON request: {exc}",
        }
        print(json.dumps(response), flush=True)
        return

    response = _execute(request)
    print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
