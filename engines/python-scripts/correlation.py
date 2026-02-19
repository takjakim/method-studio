"""
Correlation Analysis Script
============================
Expects the following variables in the execution namespace (injected by the engine):

  data      : dict
      Columnar data dictionary with column names as keys and arrays as values.
      Also contains 'variables', 'options', and other injected keys.
  variables : list[str]
      Names of the numeric variables to correlate (at least 2 required).
  options   : dict  (optional)
      method            : "pearson" | "spearman" | "kendall"  (default "pearson")
      twoTailed         : bool  (default True)
      flagSignificant   : bool  (default True)
      alpha             : float (default 0.05)
      confidenceIntervals: bool (default False)
      pairwiseN         : bool  (default True)

Produces a 'result' dict with the following structure:

  {
    "method": "pearson",
    "two_tailed": True,
    "alpha": 0.05,
    "variables": ["x", "y", ...],
    "n_variables": int,
    "correlation_matrix": {
      "x": {"x": 1.0, "y": 0.72, ...},
      ...
    },
    "pvalue_matrix": {
      "x": {"x": None, "y": 0.003, ...},
      ...
    },
    "n_matrix": {
      "x": {"x": 120, "y": 115, ...},
      ...
    },
    "ci_matrix": {
      "x": {"x": None, "y": {"lower": 0.41, "upper": 0.88}, ...},
      ...
    },
    "significant_pairs": [
      {
        "var1": "x",
        "var2": "y",
        "r": 0.72,
        "p": 0.003,
        "ci_lower": 0.41,
        "ci_upper": 0.88,
        "n": 115,
        "significant": True
      },
      ...
    ]
  }
"""

import math
import numpy as np
from scipy import stats as scipy_stats

# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# Get data dictionary (injected by wrapper — contains all column arrays plus
# 'variables', 'options', and other metadata keys)
_data = data if "data" in dir() else {}  # noqa: F821

# Get options dict (injected under the 'options' key)
_options = options if "options" in dir() else {}  # noqa: F821
if not isinstance(_options, dict):
    _options = {}

# Read option values (spec uses camelCase option ids)
_method           = str(_options.get("method", "pearson"))
_two_tailed       = bool(_options.get("twoTailed", True))
_flag_significant = bool(_options.get("flagSignificant", True))
_alpha            = float(_options.get("alpha", 0.05))

# Get variable names from the 'variables' slot (injected by wrapper)
try:
    _var_names = variables  # noqa: F821
except NameError:
    raise ValueError("Variable 'variables' is required - specify column names to correlate")

# Ensure it's a plain list of strings
if isinstance(_var_names, str):
    _var_names = [_var_names]
elif not isinstance(_var_names, (list, tuple)):
    _var_names = list(_var_names)

if len(_var_names) == 0:
    raise ValueError("At least one variable must be specified")

VALID_METHODS = {"pearson", "spearman", "kendall"}
if _method not in VALID_METHODS:
    raise ValueError(f"method must be one of {VALID_METHODS}, got '{_method}'")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_column(col_name: str) -> np.ndarray:
    """Fetch a column from the data dict and return as a float array."""
    if col_name not in _data:
        raise ValueError(f"Column '{col_name}' not found in data")
    val = _data[col_name]
    if isinstance(val, np.ndarray):
        return val.astype(float)
    return np.array(val, dtype=float)


def _pearson_ci(r: float, n: int, alpha: float, two_tailed: bool):
    """
    Fisher z-transformation confidence interval for Pearson r.
    Returns (lower, upper) or (None, None) if n < 4.
    """
    if n < 4 or r is None or math.isnan(r):
        return None, None
    if abs(r) >= 1.0:
        return r, r
    z = math.atanh(r)
    se = 1.0 / math.sqrt(n - 3)
    if two_tailed:
        z_crit = scipy_stats.norm.ppf(1 - alpha / 2)
    else:
        z_crit = scipy_stats.norm.ppf(1 - alpha)
    lower = math.tanh(z - z_crit * se)
    upper = math.tanh(z + z_crit * se)
    return round(lower, 4), round(upper, 4)


def _pairwise_corr(xi: np.ndarray, xj: np.ndarray, method: str, two_tailed: bool):
    """
    Compute correlation coefficient, p-value, and n for a pair of arrays.
    Returns (r, p, n).
    """
    mask = ~np.isnan(xi) & ~np.isnan(xj)
    n = int(mask.sum())

    if n < 3:
        return None, None, n

    a = xi[mask]
    b = xj[mask]

    if method == "pearson":
        r, p = scipy_stats.pearsonr(a, b)
    elif method == "spearman":
        r, p = scipy_stats.spearmanr(a, b)
    elif method == "kendall":
        r, p = scipy_stats.kendalltau(a, b)

    if not two_tailed:
        # Convert to one-tailed (greater) p-value
        p = p / 2 if r >= 0 else 1 - p / 2

    return round(float(r), 4), round(float(p), 4), n


# ---------------------------------------------------------------------------
# Validate variables and coerce to numeric arrays
# ---------------------------------------------------------------------------

available_vars = [v for v in _var_names if v in _data]

if len(available_vars) < 2:
    raise ValueError(
        f"At least 2 variables must be present in the dataset. "
        f"Requested: {list(_var_names)}, found: {available_vars}"
    )

# Load each column as a float array
col_arrays = {v: _get_column(v) for v in available_vars}

n_vars = len(available_vars)

# ---------------------------------------------------------------------------
# Compute pairwise correlations
# ---------------------------------------------------------------------------

# Initialise output matrices as dicts-of-dicts
corr_matrix = {v: {} for v in available_vars}
pval_matrix = {v: {} for v in available_vars}
n_mat       = {v: {} for v in available_vars}
ci_matrix   = {v: {} for v in available_vars}

significant_pairs = []

for i, vi in enumerate(available_vars):
    xi = col_arrays[vi]
    for j, vj in enumerate(available_vars):
        xj = col_arrays[vj]
        if i == j:
            valid_n = int(np.sum(~np.isnan(xi)))
            corr_matrix[vi][vj] = 1.0
            pval_matrix[vi][vj] = None
            n_mat[vi][vj]       = valid_n
            ci_matrix[vi][vj]   = None
            continue

        r, p, n_pair = _pairwise_corr(xi, xj, _method, _two_tailed)

        corr_matrix[vi][vj] = r
        pval_matrix[vi][vj] = p
        n_mat[vi][vj]       = n_pair

        # Confidence intervals (Pearson only)
        if _method == "pearson" and r is not None:
            ci_lo, ci_hi = _pearson_ci(r, n_pair, _alpha, _two_tailed)
            ci_matrix[vi][vj] = (
                {"lower": ci_lo, "upper": ci_hi}
                if ci_lo is not None else None
            )
        else:
            ci_matrix[vi][vj] = None

        # Collect significant pairs (upper triangle only)
        if (
            i < j
            and _flag_significant
            and p is not None
            and p < _alpha
        ):
            pair = {
                "var1":        vi,
                "var2":        vj,
                "r":           r,
                "p":           p,
                "n":           n_pair,
                "significant": True,
            }
            if _method == "pearson" and ci_matrix[vi][vj] is not None:
                pair["ci_lower"] = ci_matrix[vi][vj]["lower"]
                pair["ci_upper"] = ci_matrix[vi][vj]["upper"]
            significant_pairs.append(pair)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "method":             _method,
    "two_tailed":         _two_tailed,
    "alpha":              _alpha,
    "variables":          available_vars,
    "n_variables":        n_vars,
    "correlation_matrix": corr_matrix,
    "pvalue_matrix":      pval_matrix,
    "n_matrix":           n_mat,
    "ci_matrix":          ci_matrix,
    "significant_pairs":  significant_pairs,
}
