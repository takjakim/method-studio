"""
T-Test Script
=============
Performs one-sample, independent-samples, or paired-samples t-tests.

Expected namespace variables (injected by engine):

  test_type : str
      One of: "one-sample" | "independent" | "paired"

  data : dict
      Columnar data dictionary with column names as keys and arrays as values.

  -- For "one-sample" --
  testVariables : list[str]   Column names of variables to test.
  options.testValue : float   Hypothesised population mean (default 0).

  -- For "independent" --
  testVariables    : list[str]   Column names of test variables.
  groupingVariable : list[str]   Column name of grouping variable (length 1).
  options.group1Value, options.group2Value : values defining the two groups.

  -- For "paired" --
  variable1 : list[str]   Column name of first variable (length 1).
  variable2 : list[str]   Column name of second variable (length 1).

  -- Shared optional --
  alternative : str      "two-sided" | "less" | "greater"  (default "two-sided")
  alpha       : float    Significance level (default 0.05)

Result structure
----------------
{
  "test_type": "...",
  "statistic": float,
  "df": float,
  "p_value": float,
  "significant": bool,
  "alpha": float,
  "effect_size": {
    "cohens_d": float,
    "interpretation": "negligible"|"small"|"medium"|"large"
  },
  "confidence_interval": {"lower": float, "upper": float, "level": float},
  "descriptives": {
    "group1": {"n": int, "mean": float, "std": float, "se": float},
    ...
  },
  "interpretation": str
}
"""

from __future__ import annotations

import numpy as np
from scipy import stats as scipy_stats
from typing import Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(x) -> np.ndarray:
    """Convert list-like to a clean float64 array, dropping NaN."""
    arr = np.array(x, dtype=float)
    return arr[~np.isnan(arr)]


def _desc(arr: np.ndarray) -> dict:
    n = len(arr)
    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1)) if n > 1 else 0.0
    se = std / np.sqrt(n) if n > 0 else 0.0
    return {"n": n, "mean": round(mean, 6), "std": round(std, 6), "se": round(se, 6)}


def _cohens_d(arr1: np.ndarray, arr2: Optional[np.ndarray] = None, mu: float = 0.0) -> dict:
    """Compute Cohen's d and interpret its magnitude."""
    if arr2 is None:
        # One-sample or paired: d = (mean - mu) / std
        d = float((np.mean(arr1) - mu) / np.std(arr1, ddof=1)) if len(arr1) > 1 else 0.0
    else:
        # Independent samples: pooled-std version
        n1, n2 = len(arr1), len(arr2)
        std1, std2 = float(np.std(arr1, ddof=1)), float(np.std(arr2, ddof=1))
        pooled_std = np.sqrt(((n1 - 1) * std1 ** 2 + (n2 - 1) * std2 ** 2) / (n1 + n2 - 2))
        d = float((np.mean(arr1) - np.mean(arr2)) / pooled_std) if pooled_std > 0 else 0.0

    abs_d = abs(d)
    if abs_d < 0.2:
        interpretation = "negligible"
    elif abs_d < 0.5:
        interpretation = "small"
    elif abs_d < 0.8:
        interpretation = "medium"
    else:
        interpretation = "large"

    return {"cohens_d": round(d, 6), "interpretation": interpretation}


def _ci(mean_diff: float, se: float, df: float, alpha: float) -> dict:
    t_crit = float(scipy_stats.t.ppf(1 - alpha / 2, df))
    return {
        "lower": round(mean_diff - t_crit * se, 6),
        "upper": round(mean_diff + t_crit * se, 6),
        "level": 1 - alpha,
    }


def _get_column(col_name: str, data_dict: dict) -> np.ndarray:
    """Get column data by name from the data dictionary."""
    if col_name not in data_dict:
        raise ValueError(f"Column '{col_name}' not found in data")
    return _coerce(data_dict[col_name])


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_test_type = str(test_type).lower()  # noqa: F821
_alternative = str(alternative).lower() if "alternative" in dir() else "two-sided"  # noqa: F821
_alpha = float(alpha) if "alpha" in dir() else 0.05  # noqa: F821

# Get options dict and data dict
_options = options if "options" in dir() else {}  # noqa: F821
_data = data if "data" in dir() else {}  # noqa: F821

# ---------------------------------------------------------------------------
# Execute test
# ---------------------------------------------------------------------------

if _test_type == "one-sample":
    # Get test variable name and data
    if "testVariables" not in dir() or len(testVariables) == 0:  # noqa: F821
        raise ValueError("testVariables is required for one-sample t-test")

    var_name = testVariables[0]  # noqa: F821
    _x = _get_column(var_name, _data)

    _mu = float(_options.get("testValue", 0)) if _options else 0.0

    if len(_x) < 2:
        raise ValueError("Test variable must have at least 2 non-missing values")

    _stat, _p = scipy_stats.ttest_1samp(_x, popmean=_mu, alternative=_alternative)
    _df_val = float(len(_x) - 1)
    _se = float(np.std(_x, ddof=1) / np.sqrt(len(_x)))
    _ci_dict = _ci(float(np.mean(_x)) - _mu, _se, _df_val, _alpha)
    _effect = _cohens_d(_x, mu=_mu)
    _descriptives = {"sample": _desc(_x)}

    _interp = (
        f"One-sample t-test: t({_df_val:.2f}) = {_stat:.3f}, "
        f"p {'<' if _p < _alpha else '>='} {_alpha:.4f}. "
        f"The mean of {var_name} (M = {np.mean(_x):.3f}, SD = {np.std(_x, ddof=1):.3f}) is "
        f"{'significantly' if _p < _alpha else 'not significantly'} different from {_mu:.3f}."
    )

elif _test_type == "independent":
    # Get test and grouping variables
    if "testVariables" not in dir() or len(testVariables) == 0:  # noqa: F821
        raise ValueError("testVariables is required for independent t-test")
    if "groupingVariable" not in dir() or len(groupingVariable) == 0:  # noqa: F821
        raise ValueError("groupingVariable is required for independent t-test")

    var_name = testVariables[0]  # noqa: F821
    group_name = groupingVariable[0]  # noqa: F821

    # Access column data from the data dictionary
    if var_name not in _data:
        raise ValueError(f"Column '{var_name}' not found in data")
    if group_name not in _data:
        raise ValueError(f"Grouping column '{group_name}' not found in data")

    test_data = np.array(_data[var_name], dtype=float)
    group_data = np.array(_data[group_name])

    # Get group values from options
    g1_val = _options.get("group1Value", 1) if _options else 1
    g2_val = _options.get("group2Value", 2) if _options else 2

    # Split data by group
    mask1 = (group_data == g1_val) | (group_data == str(g1_val))
    mask2 = (group_data == g2_val) | (group_data == str(g2_val))

    _x1 = test_data[mask1 & ~np.isnan(test_data)]
    _x2 = test_data[mask2 & ~np.isnan(test_data)]

    if len(_x1) < 2:
        raise ValueError("Group 1 must have at least 2 non-missing values")
    if len(_x2) < 2:
        raise ValueError("Group 2 must have at least 2 non-missing values")

    _stat, _p = scipy_stats.ttest_ind(_x1, _x2, equal_var=False, alternative=_alternative)

    # Welch–Satterthwaite df
    s1, s2 = np.var(_x1, ddof=1), np.var(_x2, ddof=1)
    n1, n2 = len(_x1), len(_x2)
    _df_val = float((s1 / n1 + s2 / n2) ** 2 / (
        (s1 / n1) ** 2 / (n1 - 1) + (s2 / n2) ** 2 / (n2 - 1)
    ))

    _se = float(np.sqrt(np.var(_x1, ddof=1) / len(_x1) + np.var(_x2, ddof=1) / len(_x2)))
    _ci_dict = _ci(float(np.mean(_x1) - np.mean(_x2)), _se, _df_val, _alpha)
    _effect = _cohens_d(_x1, _x2)
    _descriptives = {"group1": _desc(_x1), "group2": _desc(_x2)}

    _interp = (
        f"Independent samples t-test (Welch): t({_df_val:.2f}) = {_stat:.3f}, "
        f"p {'<' if _p < _alpha else '>='} {_alpha:.4f}. "
        f"Group 1 (M = {np.mean(_x1):.3f}, SD = {np.std(_x1, ddof=1):.3f}, n = {len(_x1)}) vs "
        f"Group 2 (M = {np.mean(_x2):.3f}, SD = {np.std(_x2, ddof=1):.3f}, n = {len(_x2)})."
    )

elif _test_type == "paired":
    # Get paired variables
    if "variable1" not in dir() or len(variable1) == 0:  # noqa: F821
        raise ValueError("variable1 is required for paired t-test")
    if "variable2" not in dir() or len(variable2) == 0:  # noqa: F821
        raise ValueError("variable2 is required for paired t-test")

    var1_name = variable1[0]  # noqa: F821
    var2_name = variable2[0]  # noqa: F821

    # Access column data from the data dictionary
    if var1_name not in _data:
        raise ValueError(f"Column '{var1_name}' not found in data")
    if var2_name not in _data:
        raise ValueError(f"Column '{var2_name}' not found in data")

    _before = np.array(_data[var1_name], dtype=float)
    _after = np.array(_data[var2_name], dtype=float)

    # Remove pairwise missing
    mask = ~np.isnan(_before) & ~np.isnan(_after)
    _before = _before[mask]
    _after = _after[mask]
    _diff = _before - _after

    if len(_diff) < 2:
        raise ValueError("At least 2 complete pairs are required")

    _stat, _p = scipy_stats.ttest_rel(_before, _after, alternative=_alternative)
    _df_val = float(len(_diff) - 1)
    _se = float(np.std(_diff, ddof=1) / np.sqrt(len(_diff)))
    _ci_dict = _ci(float(np.mean(_diff)), _se, _df_val, _alpha)
    _effect = _cohens_d(_diff, mu=0.0)
    _descriptives = {
        "var1": _desc(_before),
        "var2": _desc(_after),
        "difference": _desc(_diff),
    }

    _interp = (
        f"Paired samples t-test: t({int(_df_val)}) = {_stat:.3f}, "
        f"p {'<' if _p < _alpha else '>='} {_alpha:.4f}. "
        f"Mean difference = {np.mean(_diff):.3f} (SD = {np.std(_diff, ddof=1):.3f}, n = {len(_diff)} pairs)."
    )

else:
    raise ValueError(
        f"Unknown test_type '{_test_type}'. Expected 'one-sample', 'independent', or 'paired'."
    )

result = {
    "test_type": _test_type,
    "statistic": round(float(_stat), 6),
    "df": round(_df_val, 4),
    "p_value": round(float(_p), 8),
    "significant": float(_p) < _alpha,
    "alpha": _alpha,
    "effect_size": _effect,
    "confidence_interval": _ci_dict,
    "descriptives": _descriptives,
    "interpretation": _interp,
}
