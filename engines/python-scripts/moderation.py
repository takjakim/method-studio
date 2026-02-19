"""
Moderation Analysis Script (PROCESS Model 1 style)
===================================================
Performs moderated regression with interaction term, simple slopes analysis,
and Johnson-Neyman regions of significance.

Expected namespace variables (injected by engine):

  outcome    : list[str]   One-element list with the outcome (Y) column name.
  predictor  : list[str]   One-element list with the focal predictor (X) column name.
  moderator  : list[str]   One-element list with the moderator (W) column name.
  covariates : list[str]   Optional list of covariate column names.
  data       : dict        Columnar data dictionary: {col_name: [values...]}.
  alpha      : float       Significance level (default 0.05).
  options    : dict        Optional settings (also injected as flat variables):
                 centering        : str   "mean" | "none" (default "none").
                 probeInteraction : bool  Compute simple slopes (default True).
                 probeValues      : str | list  "percentile" | "meanSD" or list of 3 W
                                    values (default "meanSD").
                 johnsonNeyman    : bool  Compute J-N regions (default True).
                 ciLevel          : float CI level (default 0.95).

Result structure
----------------
{
  "n": int,
  "centering_applied": bool,
  "predictor_name": str,
  "moderator_name": str,
  "outcome_name": str,
  "interaction_term": str,
  "model": {
    "formula": str,
    "coefficients": {
      "intercept":   {"coef": float, "se": float, "t": float, "p": float,
                      "ci_lower": float, "ci_upper": float},
      "predictor":   {...},
      "moderator":   {...},
      "interaction": {...}
    },
    "coef_table": [{"term": str, "estimate": float, "std_error": float,
                    "t_value": float, "p_value": float,
                    "ci_lower": float, "ci_upper": float}, ...],
    "r_squared": float,
    "adj_r_squared": float,
    "f_stat": float | null,
    "f_df1": int | null,
    "f_df2": int | null,
    "f_p": float | null
  },
  "simple_slopes": {
    "low":  {"value": float, "slope": float, "se": float, "t": float,
             "p": float, "ci_lower": float, "ci_upper": float, "significant": bool},
    "mean": {...},
    "high": {...}
  } | null,
  "johnson_neyman": {
    "lower_bound": float | null,
    "upper_bound": float | null,
    "percent_in_region": float | null,
    "note": str
  } | null,
  "alpha": float,
  "ci_level": float,
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
    return np.array(x, dtype=float)


def _coef_row(fit_result, idx: int, ci_lower_arr: np.ndarray,
              ci_upper_arr: np.ndarray) -> dict:
    return {
        "coef":     round(float(fit_result.params[idx]),    6),
        "se":       round(float(fit_result.bse[idx]),       6),
        "t":        round(float(fit_result.tvalues[idx]),   6),
        "p":        round(float(fit_result.pvalues[idx]),   8),
        "ci_lower": round(float(ci_lower_arr[idx]),         6),
        "ci_upper": round(float(ci_upper_arr[idx]),         6),
    }


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data  = data if "data" in dir() else {}   # noqa: F821
_alpha = float(alpha) if "alpha" in dir() else 0.05  # noqa: F821

if "outcome" not in dir():    # noqa: F821
    raise ValueError("Variable 'outcome' is required")
if "predictor" not in dir():  # noqa: F821
    raise ValueError("Variable 'predictor' is required")
if "moderator" not in dir():  # noqa: F821
    raise ValueError("Variable 'moderator' is required")

_outcome_raw   = outcome    # noqa: F821
_predictor_raw = predictor  # noqa: F821
_moderator_raw = moderator  # noqa: F821

_outcome_name: str = (
    _outcome_raw[0] if isinstance(_outcome_raw, (list, tuple)) and len(_outcome_raw) > 0
    else str(_outcome_raw)
)
_predictor_name: str = (
    _predictor_raw[0] if isinstance(_predictor_raw, (list, tuple)) and len(_predictor_raw) > 0
    else str(_predictor_raw)
)
_moderator_name: str = (
    _moderator_raw[0] if isinstance(_moderator_raw, (list, tuple)) and len(_moderator_raw) > 0
    else str(_moderator_raw)
)

# Optional covariates
_cov_names: list[str] = []
if "covariates" in dir() and covariates is not None:  # noqa: F821
    _cov_raw = covariates  # noqa: F821
    _cov_names = [str(c) for c in _cov_raw] if isinstance(_cov_raw, (list, tuple)) else [str(_cov_raw)]
    _cov_names = [c for c in _cov_names if c]

# Options - read flat variables injected by the engine
_centering        = "none"
_probe_interaction = True
_probe_values_opt: str | list = "meanSD"
_do_jn            = True
_ci_level         = 0.95

if "centering" in dir() and centering is not None:               # noqa: F821
    _centering = str(centering).lower()                           # noqa: F821
if "probeInteraction" in dir() and probeInteraction is not None: # noqa: F821
    _probe_interaction = bool(probeInteraction)                   # noqa: F821
if "probeValues" in dir() and probeValues is not None:           # noqa: F821
    _probe_values_opt = probeValues                               # noqa: F821
if "johnsonNeyman" in dir() and johnsonNeyman is not None:       # noqa: F821
    _do_jn = bool(johnsonNeyman)                                  # noqa: F821
if "ciLevel" in dir() and ciLevel is not None:                   # noqa: F821
    _v = float(ciLevel)                                           # noqa: F821
    _ci_level = _v if 0 < _v < 1 else 0.95

# Validate columns
for _col in [_outcome_name, _predictor_name, _moderator_name] + _cov_names:
    if _col not in _data:
        raise ValueError(f"Column '{_col}' not found in data")

# ---------------------------------------------------------------------------
# Build DataFrame
# ---------------------------------------------------------------------------

_frame = {
    _outcome_name:   _coerce(_data[_outcome_name]),
    _predictor_name: _coerce(_data[_predictor_name]),
    _moderator_name: _coerce(_data[_moderator_name]),
}
for _c in _cov_names:
    _frame[_c] = _coerce(_data[_c])

df = pd.DataFrame(_frame).dropna()
n = len(df)

_min_obs = 4 + len(_cov_names)
if n < _min_obs:
    raise ValueError(
        f"Insufficient complete observations (n={n}) for moderation analysis."
    )

# Use short aliases internally (matches R's X / W / Y pattern)
df = df.copy()
df["_X"] = df[_predictor_name].values
df["_W"] = df[_moderator_name].values
df["_Y"] = df[_outcome_name].values

# ---------------------------------------------------------------------------
# Mean centering
# ---------------------------------------------------------------------------

_centering_applied = False
if _centering == "mean":
    _centering_applied = True
    _x_mean = df["_X"].mean()
    _w_mean = df["_W"].mean()
    df["_X"] = df["_X"] - _x_mean
    df["_W"] = df["_W"] - _w_mean

# ---------------------------------------------------------------------------
# Create interaction term
# ---------------------------------------------------------------------------

_interaction_name = f"{_predictor_name}_x_{_moderator_name}"
df["_XW"] = df["_X"] * df["_W"]

# ---------------------------------------------------------------------------
# Build and fit moderated regression
# ---------------------------------------------------------------------------

_rhs_cols = ["_X", "_W", "_XW"] + _cov_names
_X_mat    = sm.add_constant(df[_rhs_cols].values, has_constant="add")
_fit      = sm.OLS(df["_Y"].values, _X_mat).fit()

_ci_mat   = _fit.conf_int(alpha=1 - _ci_level)  # shape (k, 2)
_ci_lo    = _ci_mat[:, 0]
_ci_hi    = _ci_mat[:, 1]

# Term labels: intercept=0, _X=1, _W=2, _XW=3, covariates=4+
_term_labels = ["(Intercept)", _predictor_name, _moderator_name, _interaction_name] + _cov_names

_coef_table = []
for _i, _term in enumerate(_term_labels):
    _coef_table.append({
        "term":      _term,
        "estimate":  round(float(_fit.params[_i]),  6),
        "std_error": round(float(_fit.bse[_i]),     6),
        "t_value":   round(float(_fit.tvalues[_i]), 6),
        "p_value":   round(float(_fit.pvalues[_i]), 8),
        "ci_lower":  round(float(_ci_lo[_i]),       6),
        "ci_upper":  round(float(_ci_hi[_i]),       6),
    })

# Key scalars (used in simple slopes and J-N)
_b0   = float(_fit.params[0])
_b_x  = float(_fit.params[1])
_b_w  = float(_fit.params[2])
_b_xw = float(_fit.params[3])

_r2     = float(_fit.rsquared)
_adj_r2 = float(_fit.rsquared_adj)
_f_val  = float(_fit.fvalue)   if _fit.fvalue  is not None else None
_f_p    = float(_fit.f_pvalue) if _fit.f_pvalue is not None else None
_f_df1  = int(_fit.df_model)
_f_df2  = int(_fit.df_resid)

_formula_str = f"_Y ~ const + _X + _W + _XW" + (
    " + " + " + ".join(_cov_names) if _cov_names else ""
)

_model_out = {
    "formula": f"{_outcome_name} ~ const + {_predictor_name} + {_moderator_name} + {_interaction_name}"
               + (" + " + " + ".join(_cov_names) if _cov_names else ""),
    "coefficients": {
        "intercept":   _coef_row(_fit, 0, _ci_lo, _ci_hi),
        "predictor":   _coef_row(_fit, 1, _ci_lo, _ci_hi),
        "moderator":   _coef_row(_fit, 2, _ci_lo, _ci_hi),
        "interaction": _coef_row(_fit, 3, _ci_lo, _ci_hi),
    },
    "coef_table":     _coef_table,
    "r_squared":      round(_r2,     6),
    "adj_r_squared":  round(_adj_r2, 6),
    "f_stat":         round(_f_val, 6) if _f_val is not None else None,
    "f_df1":          _f_df1,
    "f_df2":          _f_df2,
    "f_p":            round(_f_p, 8) if _f_p is not None else None,
}

# ---------------------------------------------------------------------------
# Simple slopes (probing the interaction)
# ---------------------------------------------------------------------------

_simple_slopes_out = None

if _probe_interaction:
    # Determine W probe values
    _w_raw = df["_W"].values

    if isinstance(_probe_values_opt, (list, tuple)) and len(_probe_values_opt) >= 1:
        _w_vals = [float(v) for v in _probe_values_opt[:3]]
        if len(_w_vals) < 3:
            _w_m  = float(np.mean(_w_raw))
            _w_sd = float(np.std(_w_raw, ddof=1))
            _w_vals = [_w_m - _w_sd, _w_m, _w_m + _w_sd]
    elif isinstance(_probe_values_opt, str) and _probe_values_opt.lower() == "percentile":
        _w_vals = [
            float(np.percentile(_w_raw, 16)),
            float(np.percentile(_w_raw, 50)),
            float(np.percentile(_w_raw, 84)),
        ]
    else:
        # Default: mean ± 1 SD
        _w_m  = float(np.mean(_w_raw))
        _w_sd = float(np.std(_w_raw, ddof=1))
        _w_vals = [_w_m - _w_sd, _w_m, _w_m + _w_sd]

    _probe_labels = ["low", "mean", "high"]

    # Variance-covariance matrix (full model)
    _vcov = _fit.cov_params()  # ndarray shape (k, k)
    # Positions: 0=intercept, 1=_X, 2=_W, 3=_XW
    _var_bx  = float(_vcov[1, 1])
    _var_bxw = float(_vcov[3, 3])
    _cov_xw  = float(_vcov[1, 3])
    _df_resid = int(_fit.df_resid)

    _simple_slopes_out = {}
    for _lbl, _wv in zip(_probe_labels, _w_vals):
        # Conditional slope: b_x + b_xw * W
        _slope  = _b_x + _b_xw * _wv
        # Delta-method SE: Var(b_x) + W^2*Var(b_xw) + 2*W*Cov(b_x, b_xw)
        _slope_var = _var_bx + _wv ** 2 * _var_bxw + 2 * _wv * _cov_xw
        _slope_se  = float(np.sqrt(max(_slope_var, 0.0)))
        _t_val     = _slope / _slope_se if _slope_se > 0 else 0.0
        _p_val     = float(2 * scipy_stats.t.sf(abs(_t_val), df=_df_resid))
        _t_crit    = float(scipy_stats.t.ppf((1 + _ci_level) / 2, df=_df_resid))
        _ci_lo_s   = _slope - _t_crit * _slope_se
        _ci_hi_s   = _slope + _t_crit * _slope_se

        _simple_slopes_out[_lbl] = {
            "value":       round(_wv,      6),
            "slope":       round(_slope,   6),
            "se":          round(_slope_se, 6),
            "t":           round(_t_val,   6),
            "p":           round(_p_val,   8),
            "ci_lower":    round(_ci_lo_s, 6),
            "ci_upper":    round(_ci_hi_s, 6),
            "significant": bool(_p_val < _alpha),
        }

# ---------------------------------------------------------------------------
# Johnson-Neyman regions of significance
# ---------------------------------------------------------------------------

_jn_out = None

if _do_jn:
    try:
        _df_resid_jn = int(_fit.df_resid)
        _t_crit_jn   = float(scipy_stats.t.ppf((1 + _ci_level) / 2, df=_df_resid_jn))

        _vcov_jn = _fit.cov_params()
        _var_bx_jn  = float(_vcov_jn[1, 1])
        _var_bxw_jn = float(_vcov_jn[3, 3])
        _cov_xw_jn  = float(_vcov_jn[1, 3])

        # Quadratic in W: find roots where |t_slope| = t_crit
        # a*W^2 + b*W + c = 0
        _qa = _b_xw ** 2         - _t_crit_jn ** 2 * _var_bxw_jn
        _qb = 2 * _b_x * _b_xw  - 2 * _t_crit_jn ** 2 * _cov_xw_jn
        _qc = _b_x ** 2          - _t_crit_jn ** 2 * _var_bx_jn

        _disc = _qb ** 2 - 4 * _qa * _qc

        if _qa == 0:
            _jn_out = {
                "lower_bound":        None,
                "upper_bound":        None,
                "percent_in_region":  None,
                "note": "Quadratic has no finite solution; interaction may be negligible.",
            }
        elif _disc < 0:
            _jn_out = {
                "lower_bound":        None,
                "upper_bound":        None,
                "percent_in_region":  None,
                "note": "No real roots: the effect of X on Y is either always or never significant across W.",
            }
        else:
            _r1 = (-_qb - np.sqrt(_disc)) / (2 * _qa)
            _r2 = (-_qb + np.sqrt(_disc)) / (2 * _qa)
            _jn_lower = float(min(_r1, _r2))
            _jn_upper = float(max(_r1, _r2))

            # Check which region is significant by testing the midpoint
            _w_mid      = (_jn_lower + _jn_upper) / 2
            _slope_mid  = _b_x + _b_xw * _w_mid
            _se_mid_var = _var_bx_jn + _w_mid ** 2 * _var_bxw_jn + 2 * _w_mid * _cov_xw_jn
            _se_mid     = float(np.sqrt(max(_se_mid_var, 0.0)))
            _t_mid      = _slope_mid / _se_mid if _se_mid > 0 else 0.0
            _mid_is_sig = abs(_t_mid) > _t_crit_jn

            _w_vec      = df["_W"].values
            if _mid_is_sig:
                _in_region = (_w_vec >= _jn_lower) & (_w_vec <= _jn_upper)
                _jn_note   = "X -> Y is significant between lower_bound and upper_bound."
            else:
                _in_region = (_w_vec < _jn_lower) | (_w_vec > _jn_upper)
                _jn_note   = "X -> Y is significant outside the range [lower_bound, upper_bound]."

            _pct_in = round(float(100 * np.mean(_in_region)), 4)

            _jn_out = {
                "lower_bound":       round(_jn_lower, 6),
                "upper_bound":       round(_jn_upper, 6),
                "percent_in_region": _pct_in,
                "note":              _jn_note,
            }

    except Exception as _jn_e:
        _jn_out = {
            "lower_bound":        None,
            "upper_bound":        None,
            "percent_in_region":  None,
            "note": f"Johnson-Neyman analysis failed: {_jn_e}",
        }

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_int_row   = next((r for r in _coef_table if r["term"] == _interaction_name), None)
_int_sig   = _int_row is not None and _int_row["p_value"] < _alpha
_int_coef  = _int_row["estimate"] if _int_row else 0.0
_int_p_val = _int_row["p_value"]  if _int_row else 1.0
_f_p_cmp   = "<" if (_f_p is not None and _f_p < _alpha) else ">="

_interp_parts = [
    f"Moderated regression (PROCESS Model 1 style): "
    f"F({_f_df1}, {_f_df2}) = {_f_val:.3f}, p {_f_p_cmp} {_alpha:.4f}.",
    f"The model explains {_r2 * 100:.1f}% of variance in {_outcome_name} "
    f"(R\u00b2 = {_r2:.3f}, adj. R\u00b2 = {_adj_r2:.3f}).",
]

if _int_sig:
    _interp_parts.append(
        f"The interaction term {_predictor_name} \u00d7 {_moderator_name} is statistically significant "
        f"(b = {_int_coef:.3f}, p = {_int_p_val:.4f}), indicating that {_moderator_name} moderates "
        f"the effect of {_predictor_name} on {_outcome_name}."
    )
else:
    _interp_parts.append(
        f"The interaction term {_predictor_name} \u00d7 {_moderator_name} is not statistically significant "
        f"(b = {_int_coef:.3f}, p = {_int_p_val:.4f})."
    )

if _centering_applied:
    _interp_parts.append(
        "Variables were mean-centered prior to analysis (X and W centered at their means)."
    )

interpretation = " ".join(_interp_parts)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n":                  n,
    "centering_applied":  _centering_applied,
    "predictor_name":     _predictor_name,
    "moderator_name":     _moderator_name,
    "outcome_name":       _outcome_name,
    "interaction_term":   _interaction_name,
    "model":              _model_out,
    "simple_slopes":      _simple_slopes_out,
    "johnson_neyman":     _jn_out,
    "alpha":              _alpha,
    "ci_level":           _ci_level,
    "interpretation":     interpretation,
}
