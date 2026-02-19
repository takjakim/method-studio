"""
Linear Regression Script
========================
Performs simple or multiple Ordinary Least Squares (OLS) linear regression.

Expected namespace variables (injected by engine):

  dependent    : list[str]           One-element list with the dependent column name.
  independents : list[str]           List of predictor column name strings.
  data         : dict                Columnar data dictionary: {col_name: [values...]}.
  options      : dict                Optional settings:
                   includeConstant : bool   Include intercept term (default True).
                   confidenceLevel : float  CI level, e.g. 0.95 (default 0.95).
                   diagnostics     : bool   Compute VIF for multicollinearity (default True).
  alpha        : float               Significance level (default 0.05).

Result structure
----------------
{
  "model_type": "simple" | "multiple",
  "formula": str,
  "n": int,
  "k": int,
  "r_squared": float,
  "adj_r_squared": float,
  "rmse": float,
  "f_statistic": float,
  "f_df1": int,
  "f_df2": int,
  "f_p_value": float,
  "aic": float,
  "bic": float,
  "coefficients": [
    {
      "term": str,
      "estimate": float,
      "std_error": float,
      "t_value": float,
      "p_value": float,
      "ci_lower": float,
      "ci_upper": float
    },
    ...
  ],
  "anova_table": [
    {
      "source": str,
      "df": int,
      "ss": float,
      "ms": float,
      "f_value": float | null,
      "p_value": float | null
    },
    ...
  ],
  "normality_test": {
    "method": "Shapiro-Wilk",
    "statistic": float,
    "p_value": float,
    "normal": bool
  },
  "vif": [{"term": str, "vif": float}] | null,   # null when k == 1
  "alpha": float,
  "confidence_level": float,
  "interpretation": str
}
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as scipy_stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(x) -> np.ndarray:
    """Convert list-like to float64, keeping NaN for later removal."""
    return np.array(x, dtype=float)


def _vif_series(X_df: pd.DataFrame) -> list[dict]:
    """Compute Variance Inflation Factor for each column of X_df (no constant)."""
    from statsmodels.stats.outliers_influence import variance_inflation_factor
    results = []
    for i, col in enumerate(X_df.columns):
        v = variance_inflation_factor(X_df.values, i)
        results.append({"term": col, "vif": round(float(v), 4)})
    return results


def _shapiro(resids: np.ndarray, alpha: float) -> dict:
    stat, p = scipy_stats.shapiro(resids)
    return {
        "method": "Shapiro-Wilk",
        "statistic": round(float(stat), 6),
        "p_value": round(float(p), 8),
        "normal": bool(float(p) >= alpha),
    }


def _anova_table(fit_result) -> list[dict]:
    """Build a simple ANOVA decomposition from an OLS fit result."""
    n    = int(fit_result.nobs)
    k    = int(fit_result.df_model)     # regression df (excl. constant)
    df_r = int(fit_result.df_resid)

    ss_total = float(np.sum((fit_result.model.endog - np.mean(fit_result.model.endog)) ** 2))
    ss_resid = float(fit_result.ssr)
    ss_reg   = float(fit_result.ess)

    ms_reg   = ss_reg  / k     if k   > 0 else None
    ms_resid = ss_resid / df_r if df_r > 0 else None
    f_val    = float(fit_result.fvalue)   if ms_resid else None
    f_p      = float(fit_result.f_pvalue) if ms_resid else None

    return [
        {
            "source":  "Regression",
            "df":      k,
            "ss":      round(ss_reg, 6),
            "ms":      round(ms_reg, 6) if ms_reg is not None else None,
            "f_value": round(f_val, 6)  if f_val  is not None else None,
            "p_value": round(f_p, 8)    if f_p    is not None else None,
        },
        {
            "source":  "Residual",
            "df":      df_r,
            "ss":      round(ss_resid, 6),
            "ms":      round(ms_resid, 6) if ms_resid is not None else None,
            "f_value": None,
            "p_value": None,
        },
        {
            "source":  "Total",
            "df":      n - 1,
            "ss":      round(ss_total, 6),
            "ms":      None,
            "f_value": None,
            "p_value": None,
        },
    ]


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# 'dependent' is a list with one column name string (e.g. ["income"])
# 'independents' is a list of column name strings (e.g. ["age", "education"])
# 'data' is a dict mapping column names to lists of values

if "dependent" not in dir():  # noqa: F821
    raise ValueError("Variable 'dependent' is required")
if "independents" not in dir():  # noqa: F821
    raise ValueError("Variable 'independents' is required")

_data = data if "data" in dir() else {}  # noqa: F821
_alpha = float(alpha) if "alpha" in dir() else 0.05  # noqa: F821

# Resolve options
_options = options if "options" in dir() else {}  # noqa: F821
_include_constant = bool(_options.get("includeConstant", True)) if _options else True
_confidence_level = float(_options.get("confidenceLevel", 0.95)) if _options else 0.95
_run_diagnostics  = bool(_options.get("diagnostics", True)) if _options else True

# Extract dependent column name from the slot list
_dep_raw = dependent  # noqa: F821
_dep_name: str = (
    _dep_raw[0] if isinstance(_dep_raw, (list, tuple)) and len(_dep_raw) > 0
    else str(_dep_raw)
)

if _dep_name not in _data:
    raise ValueError(f"Column '{_dep_name}' not found in data")

# Extract independent column names from the slot list
_indeps_raw = independents  # noqa: F821
if isinstance(_indeps_raw, (list, tuple)):
    _indep_names: list[str] = [str(n) for n in _indeps_raw]
else:
    _indep_names = [str(_indeps_raw)]

_k = len(_indep_names)
if _k == 0:
    raise ValueError("At least one predictor (independent variable) is required")

for _nm in _indep_names:
    if _nm not in _data:
        raise ValueError(f"Column '{_nm}' not found in data")

# ---------------------------------------------------------------------------
# Build clean DataFrame from data dictionary
# ---------------------------------------------------------------------------

_frame_data: dict[str, np.ndarray] = {_dep_name: _coerce(_data[_dep_name])}
for _nm in _indep_names:
    _frame_data[_nm] = _coerce(_data[_nm])

_df = pd.DataFrame(_frame_data).dropna()
_n = len(_df)

if _n < _k + 2:
    raise ValueError(
        f"Insufficient complete observations (n={_n}) for {_k} predictor(s)."
    )

_Y = _df[_dep_name].values
_X_raw = _df[_indep_names].values  # shape (n, k), no constant yet

if _include_constant:
    _X = sm.add_constant(_X_raw, has_constant="add")
    _const_col = ["const"] + _indep_names
else:
    _X = _X_raw
    _const_col = _indep_names

# ---------------------------------------------------------------------------
# Fit OLS
# ---------------------------------------------------------------------------

_fit = sm.OLS(_Y, _X).fit()

# ---------------------------------------------------------------------------
# Coefficients table
# ---------------------------------------------------------------------------

_alpha_val = 1 - _confidence_level
_ci = _fit.conf_int(alpha=_alpha_val)  # (lower, upper) per param

_coef_list = []
for i, term in enumerate(_const_col):
    _coef_list.append({
        "term":      term,
        "estimate":  round(float(_fit.params[i]),    6),
        "std_error": round(float(_fit.bse[i]),        6),
        "t_value":   round(float(_fit.tvalues[i]),    6),
        "p_value":   round(float(_fit.pvalues[i]),    8),
        "ci_lower":  round(float(_ci[i, 0]),           6),
        "ci_upper":  round(float(_ci[i, 1]),           6),
    })

# ---------------------------------------------------------------------------
# Model fit statistics
# ---------------------------------------------------------------------------

_r2     = float(_fit.rsquared)
_adj_r2 = float(_fit.rsquared_adj)
_rmse   = float(np.sqrt(_fit.mse_resid))
_f_val  = float(_fit.fvalue)   if _fit.fvalue  is not None else None
_f_p    = float(_fit.f_pvalue) if _fit.f_pvalue is not None else None
_f_df1  = int(_fit.df_model)
_f_df2  = int(_fit.df_resid)
_aic    = float(_fit.aic)
_bic    = float(_fit.bic)

# ---------------------------------------------------------------------------
# ANOVA table
# ---------------------------------------------------------------------------

_anova = _anova_table(_fit)

# ---------------------------------------------------------------------------
# Normality test (Shapiro-Wilk on residuals)
# ---------------------------------------------------------------------------

_resids = _fit.resid
_norm_test = None
if 3 <= len(_resids) <= 5000:
    _norm_test = _shapiro(_resids, _alpha)

# ---------------------------------------------------------------------------
# VIF (only meaningful when k >= 2)
# ---------------------------------------------------------------------------

_vif_result = None
if _run_diagnostics and _k >= 2:
    _vif_result = _vif_series(_df[_indep_names])

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_model_type = "simple" if _k == 1 else "multiple"

_formula_str = (
    f"{_dep_name} ~ {'const + ' if _include_constant else ''}{' + '.join(_indep_names)}"
)

_sig_preds = [
    c["term"] for c in _coef_list
    if c["term"] != "const" and c["p_value"] < _alpha
]
_n_sig = len(_sig_preds)

_interpretation = (
    f"{'Simple' if _model_type == 'simple' else 'Multiple'} linear regression: "
    f"F({_f_df1}, {_f_df2}) = {_f_val:.3f}, "
    f"p {'<' if _f_p is not None and _f_p < _alpha else '>='} {_alpha:.4f}. "
    f"The model explains {_r2 * 100:.1f}% of variance "
    f"(R\u00b2 = {_r2:.3f}, adj. R\u00b2 = {_adj_r2:.3f}, RMSE = {_rmse:.3f}). "
    f"{_n_sig} of {_k} predictor(s) "
    f"{'is' if _n_sig == 1 else 'are'} significant at \u03b1 = {_alpha:.2f}."
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "model_type":      _model_type,
    "formula":         _formula_str,
    "n":               _n,
    "k":               _k,
    "r_squared":       round(_r2, 6),
    "adj_r_squared":   round(_adj_r2, 6),
    "rmse":            round(_rmse, 6),
    "f_statistic":     round(_f_val, 6) if _f_val is not None else None,
    "f_df1":           _f_df1,
    "f_df2":           _f_df2,
    "f_p_value":       round(_f_p, 8)   if _f_p  is not None else None,
    "aic":             round(_aic, 4),
    "bic":             round(_bic, 4),
    "coefficients":    _coef_list,
    "anova_table":     _anova,
    "normality_test":  _norm_test,
    "vif":             _vif_result,
    "alpha":           _alpha,
    "confidence_level": _confidence_level,
    "interpretation":  _interpretation,
}
