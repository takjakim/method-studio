"""
Descriptive Statistics Script
==============================
Expects the following variables in the execution namespace (injected by the engine):

  variables : list[str]
      Column names to analyze
  data : dict
      Columnar data dictionary with column names as keys and arrays as values

Produces a 'result' dict with the following structure:

  {
    "variables": ["x", "y", ...],
    "stats": {
      "x": {
        "n": int,
        "missing": int,
        "mean": float,
        "median": float,
        "std": float,
        "variance": float,
        "se_mean": float,
        "min": float,
        "max": float,
        "range": float,
        "q1": float,
        "q3": float,
        "iqr": float,
        "skewness": float,
        "kurtosis": float,
      },
      ...
    }
  }
"""

import numpy as np
from scipy import stats as scipy_stats


def _coerce(val) -> np.ndarray:
    """Convert JSON value to numpy array (keeping NaN for missing detection)."""
    if isinstance(val, np.ndarray):
        return val.astype(float)
    if isinstance(val, (list, tuple)):
        return np.array(val, dtype=float)
    return np.array([val], dtype=float)


def _get_column(col_name: str, data_dict: dict) -> np.ndarray:
    """Get column data from the data dictionary."""
    if col_name not in data_dict:
        raise ValueError(f"Column '{col_name}' not found in data")
    return _coerce(data_dict[col_name])


def _describe_column(arr: np.ndarray) -> dict:
    """Compute descriptive statistics for a numeric array."""
    n_total = len(arr)
    mask = ~np.isnan(arr)
    clean = arr[mask]
    n_valid = len(clean)
    n_missing = n_total - n_valid

    if n_valid == 0:
        return {
            "n": 0,
            "missing": int(n_missing),
            "mean": None,
            "median": None,
            "std": None,
            "variance": None,
            "se_mean": None,
            "min": None,
            "max": None,
            "range": None,
            "q1": None,
            "q3": None,
            "iqr": None,
            "skewness": None,
            "kurtosis": None,
        }

    mean = float(np.mean(clean))
    median = float(np.median(clean))
    std = float(np.std(clean, ddof=1)) if n_valid > 1 else 0.0
    variance = float(np.var(clean, ddof=1)) if n_valid > 1 else 0.0
    se_mean = std / np.sqrt(n_valid) if n_valid > 0 else 0.0
    vmin = float(np.min(clean))
    vmax = float(np.max(clean))

    q1, q3 = float(np.percentile(clean, 25)), float(np.percentile(clean, 75))
    iqr = q3 - q1

    skewness = float(scipy_stats.skew(clean, bias=False)) if n_valid >= 3 else None
    kurtosis = float(scipy_stats.kurtosis(clean, bias=False)) if n_valid >= 4 else None

    return {
        "n": int(n_valid),
        "missing": int(n_missing),
        "mean": round(mean, 6),
        "median": round(median, 6),
        "std": round(std, 6),
        "variance": round(variance, 6),
        "se_mean": round(se_mean, 6),
        "min": round(vmin, 6),
        "max": round(vmax, 6),
        "range": round(vmax - vmin, 6),
        "q1": round(q1, 6),
        "q3": round(q3, 6),
        "iqr": round(iqr, 6),
        "skewness": round(skewness, 6) if skewness is not None else None,
        "kurtosis": round(kurtosis, 6) if kurtosis is not None else None,
    }


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# Get data dictionary (injected by wrapper)
_data = data if "data" in dir() else {}  # noqa: F821

# Get variable names from the 'variables' slot (injected by wrapper)
try:
    _var_names = variables  # noqa: F821
except NameError:
    raise ValueError("Variable 'variables' is required - specify column names to analyze")

# Ensure it's a list
if isinstance(_var_names, str):
    _var_names = [_var_names]
elif not isinstance(_var_names, (list, tuple)):
    _var_names = list(_var_names)

if len(_var_names) == 0:
    raise ValueError("At least one variable must be specified")

# ---------------------------------------------------------------------------
# Process each variable
# ---------------------------------------------------------------------------

stats_out = {}
for var_name in _var_names:
    arr = _get_column(var_name, _data)
    stats_out[var_name] = _describe_column(arr)

result = {
    "variables": list(_var_names),
    "stats": stats_out,
}
