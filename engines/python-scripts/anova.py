"""
ANOVA Script
============
Performs a One-Way Analysis of Variance (ANOVA).

Expected namespace variables (injected by engine):

  dependentVariable : list[str]
      Column name of the outcome / dependent variable (length 1).

  groupingVariable : list[str]
      Column name of the grouping / factor variable (length 1).

  data : dict
      Columnar data dictionary with column names as keys and arrays as values.

  -- Shared optional (via options dict) --
  options.postHocTest     : str     "tukey" | "bonferroni" | "none" (default "tukey").
  options.effectSize      : bool    Compute eta-squared (default True).
  options.confidenceLevel : float   Confidence level e.g. 0.95 → alpha = 0.05 (default 0.95).
  options.missingValues   : str     "exclude-analysis" | "exclude-listwise"

Result structure
----------------
{
  "f_statistic": float,
  "df_between": int,
  "df_within": int,
  "p_value": float,
  "significant": bool,
  "alpha": float,
  "effect_size": {
    "eta_squared": float,
    "interpretation": "negligible"|"small"|"medium"|"large"
  },
  "group_stats": {
    "<group_label>": {"n": int, "mean": float, "std": float, "se": float},
    ...
  },
  "post_hoc_results": [
    {
      "comparison": str,
      "mean_diff": float,
      "p_adjusted": float,
      "significant": bool,
      "ci_lower": float,   # Tukey only
      "ci_upper": float,   # Tukey only
      "method": "tukey" | "bonferroni"
    },
    ...
  ] | None,
  "post_hoc_method": "tukey" | "bonferroni" | "none",
  "interpretation": str
}
"""

from __future__ import annotations

import itertools
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.multitest import multipletests


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(x) -> np.ndarray:
    """Convert list-like to a float64 array, dropping NaN."""
    arr = np.array(x, dtype=float)
    return arr[~np.isnan(arr)]


def _desc(arr: np.ndarray) -> dict:
    n = int(len(arr))
    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else 0.0
    se = std / np.sqrt(n) if n > 0 else 0.0
    return {
        "n": n,
        "mean": round(mean, 6),
        "std": round(std, 6),
        "se": round(se, 6),
    }


def _eta_sq_label(eta2: float) -> str:
    if eta2 < 0.01:
        return "negligible"
    elif eta2 < 0.06:
        return "small"
    elif eta2 < 0.14:
        return "medium"
    else:
        return "large"


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# Variable slots come as lists of column name strings
if "dependentVariable" not in dir() or len(dependentVariable) == 0:  # noqa: F821
    raise ValueError("Variable slot 'dependentVariable' is required")
if "groupingVariable" not in dir() or len(groupingVariable) == 0:  # noqa: F821
    raise ValueError("Variable slot 'groupingVariable' is required")

dep_name   = dependentVariable[0]   # noqa: F821
group_name = groupingVariable[0]    # noqa: F821

# Access column data from the data dictionary
_data = data if "data" in dir() else {}  # noqa: F821

if dep_name not in _data:
    raise ValueError(f"Column '{dep_name}' not found in data")
if group_name not in _data:
    raise ValueError(f"Grouping column '{group_name}' not found in data")

# Read options
_options = options if "options" in dir() else {}  # noqa: F821
_confidence_level = float(_options.get("confidenceLevel", 0.95)) if _options else 0.95
_alpha: float = round(1.0 - _confidence_level, 10)
_post_hoc: str = str(_options.get("postHocTest", "tukey")).lower() if _options else "tukey"

# Build a DataFrame from the raw column data for aligned NA removal
_df = pd.DataFrame({
    "y": list(_data[dep_name]),
    "g": [str(v) for v in _data[group_name]],
})
_df["y"] = pd.to_numeric(_df["y"], errors="coerce")
_df = _df.dropna(subset=["y", "g"])
_df["g"] = _df["g"].astype(str)

_dep_arr = _df["y"].to_numpy(dtype=float)
_grp_arr = _df["g"].to_numpy()

_group_labels = sorted(_df["g"].unique().tolist())
_n_groups = len(_group_labels)

if len(_dep_arr) < 3:
    raise ValueError(f"'{dep_name}' must have at least 3 non-missing values")
if _n_groups < 2:
    raise ValueError(f"'{group_name}' must have at least 2 distinct levels")

# ---------------------------------------------------------------------------
# Split into per-group arrays
# ---------------------------------------------------------------------------

_groups_data: dict[str, np.ndarray] = {
    lv: _dep_arr[_grp_arr == lv] for lv in _group_labels
}

# ---------------------------------------------------------------------------
# One-Way ANOVA via scipy (fast, minimal deps)
# ---------------------------------------------------------------------------

_f_stat, _p_val = scipy_stats.f_oneway(*_groups_data.values())
_f_stat = float(_f_stat)
_p_val = float(_p_val)

_df_between = int(_n_groups - 1)
_df_within = int(len(_dep_arr) - _n_groups)

# ---------------------------------------------------------------------------
# Eta-squared
# ---------------------------------------------------------------------------

_grand_mean = float(np.mean(_dep_arr))
_ss_between = float(sum(
    len(arr) * (float(np.mean(arr)) - _grand_mean) ** 2
    for arr in _groups_data.values()
))
_ss_total = float(np.sum((_dep_arr - _grand_mean) ** 2))
_eta2 = _ss_between / _ss_total if _ss_total > 0 else 0.0

# ---------------------------------------------------------------------------
# Per-group descriptives
# ---------------------------------------------------------------------------

_group_stats: dict[str, Any] = {lv: _desc(arr) for lv, arr in _groups_data.items()}

# ---------------------------------------------------------------------------
# Post-hoc tests (only when ANOVA is significant)
# ---------------------------------------------------------------------------

_post_hoc_results = None
_run_posthoc = (_post_hoc != "none") and (_p_val < _alpha)

if _run_posthoc:
    if _post_hoc == "tukey":
        _tukey = pairwise_tukeyhsd(_dep_arr, _grp_arr, alpha=_alpha)
        _tukey_df = pd.DataFrame(
            data=_tukey.summary().data[1:],
            columns=_tukey.summary().data[0],
        )
        _post_hoc_results = []
        for _, row in _tukey_df.iterrows():
            _post_hoc_results.append({
                "comparison": f"{row['group1']}-{row['group2']}",
                "mean_diff": round(float(row["meandiff"]), 6),
                "ci_lower": round(float(row["lower"]), 6),
                "ci_upper": round(float(row["upper"]), 6),
                "p_adjusted": round(float(row["p-adj"]), 8),
                "significant": bool(row["reject"]),
                "method": "tukey",
            })

    elif _post_hoc == "bonferroni":
        _pairs = list(itertools.combinations(_group_labels, 2))
        _raw_p_vals = []
        _pair_info = []
        for g1, g2 in _pairs:
            arr1 = _groups_data[g1]
            arr2 = _groups_data[g2]
            _, raw_p = scipy_stats.ttest_ind(arr1, arr2, equal_var=False)
            _raw_p_vals.append(float(raw_p))
            _pair_info.append((g1, g2, float(np.mean(arr1)) - float(np.mean(arr2))))

        _reject, _adj_p, _, _ = multipletests(_raw_p_vals, alpha=_alpha, method="bonferroni")
        _post_hoc_results = []
        for (g1, g2, diff), p_adj, sig in zip(_pair_info, _adj_p, _reject):
            _post_hoc_results.append({
                "comparison": f"{g1}-{g2}",
                "mean_diff": round(diff, 6),
                "p_adjusted": round(float(p_adj), 8),
                "significant": bool(sig),
                "method": "bonferroni",
            })

# ---------------------------------------------------------------------------
# Interpretation string
# ---------------------------------------------------------------------------

_sig_str = "statistically significant" if _p_val < _alpha else "not statistically significant"
_interp = (
    f"One-Way ANOVA: F({_df_between}, {_df_within}) = {_f_stat:.3f}, "
    f"p {'<' if _p_val < _alpha else '>='} {_alpha:.2f}. "
    f"The effect of {group_name} on {dep_name} is {_sig_str} "
    f"(eta-squared = {_eta2:.3f}, {_eta_sq_label(_eta2)} effect). "
)
if _post_hoc_results is not None:
    _interp += f"Post-hoc {_post_hoc} tests were performed."
elif _p_val >= _alpha:
    _interp += "Post-hoc tests were not conducted (ANOVA not significant)."
else:
    _interp += "Post-hoc tests were not requested."

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "f_statistic": round(_f_stat, 6),
    "df_between": _df_between,
    "df_within": _df_within,
    "p_value": round(_p_val, 8),
    "significant": bool(_p_val < _alpha),
    "alpha": _alpha,
    "effect_size": {
        "eta_squared": round(_eta2, 6),
        "interpretation": _eta_sq_label(_eta2),
    },
    "group_stats": _group_stats,
    "post_hoc_results": _post_hoc_results,
    "post_hoc_method": _post_hoc if _run_posthoc else "none",
    "interpretation": _interp,
}
