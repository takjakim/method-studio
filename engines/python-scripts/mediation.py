"""
Mediation Analysis Script (PROCESS Model 4 style)
==================================================
Performs simple or parallel mediation analysis with bootstrap confidence
intervals for indirect effects.

Expected namespace variables (injected by engine):

  outcome    : list[str]   One-element list with the outcome (Y) column name.
  predictor  : list[str]   One-element list with the predictor (X) column name.
  mediators  : list[str]   List of mediator (M) column name(s).
  covariates : list[str]   Optional list of covariate column names.
  data       : dict        Columnar data dictionary: {col_name: [values...]}.
  options    : dict        Optional settings (also injected as flat variables):
                 bootstrap   : bool   Use bootstrapping for indirect CI (default True).
                 nBoot       : int    Number of bootstrap samples (default 5000).
                 ciLevel     : float  CI level, e.g. 0.95 (default 0.95).
                 standardize : bool   Standardize all variables before analysis (default False).
                 effectSize  : bool   Compute kappa-squared effect size (default True).
                 totalEffect : bool   Include total effect (path c) in output (default True).

Result structure
----------------
{
  "n": int,
  "predictor": str,
  "outcome": str,
  "mediators": [str, ...],
  "covariates": [str, ...] | null,
  "paths": {
    "<mediator>": {
      "a": {"coef": float, "se": float, "t": float, "p": float},
      "b": {"coef": float, "se": float, "t": float, "p": float},
      "c": {"coef": float, "se": float, "t": float, "p": float},
      "c_prime": {"coef": float, "se": float, "t": float, "p": float}
    }, ...
  },
  "indirect": {
    "<mediator>": {
      "effect": float,
      "boot_se": float | null,
      "ci_lower": float | null,
      "ci_upper": float | null,
      "significant": bool | null
    }, ...
  },
  "total_indirect": {
    "effect": float,
    "boot_se": float | null,
    "ci_lower": float | null,
    "ci_upper": float | null,
    "significant": bool | null
  },
  "direct": {"effect": float, "se": float, "t": float, "p": float},
  "total": {"effect": float, "se": float, "t": float, "p": float} | null,
  "model_summary": {
    "r_squared_y": float,
    "adj_r_squared_y": float,
    "r_squared_m": {"<mediator>": {"r_squared": float, "adj_r_squared": float}, ...}
  },
  "effect_sizes": {
    "<mediator>": {"kappa_squared": float | null, "interpretation": str}
  } | null,
  "standardized": bool,
  "ci_level": float,
  "n_boot": int | null,
  "interpretation": str
}
"""

from __future__ import annotations

import warnings
import numpy as np
import pandas as pd
import statsmodels.api as sm

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(x) -> np.ndarray:
    return np.array(x, dtype=float)


def _extract_coef(fit_result, term_name: str) -> dict:
    """Extract coefficient info for a term from a fitted OLS result."""
    params = fit_result.params
    bse    = fit_result.bse
    tvals  = fit_result.tvalues
    pvals  = fit_result.pvalues

    if term_name not in params.index:
        return {"coef": None, "se": None, "t": None, "p": None}

    return {
        "coef": round(float(params[term_name]),  6),
        "se":   round(float(bse[term_name]),     6),
        "t":    round(float(tvals[term_name]),   6),
        "p":    round(float(pvals[term_name]),   8),
    }


def _bootstrap_indirect(df: pd.DataFrame, pred: str, mn: str,
                        all_mediators: list[str], outcome: str,
                        covs: list[str], n_boot: int,
                        rng: np.random.Generator) -> np.ndarray:
    """Return array of bootstrapped indirect effect (a*b) estimates."""
    n = len(df)
    boot_vals = np.empty(n_boot)
    boot_vals[:] = np.nan

    a_rhs = [pred] + covs
    direct_rhs = [pred] + all_mediators + covs

    for i in range(n_boot):
        idx = rng.integers(0, n, size=n)
        d = df.iloc[idx].reset_index(drop=True)

        try:
            # Path a: X -> M
            Xa = sm.add_constant(d[a_rhs].values, has_constant="add")
            fa = sm.OLS(d[mn].values, Xa).fit()
            coef_a = fa.params[1]  # index 1 = pred (after const)

            # Path b: M -> Y | X (direct model)
            Xd = sm.add_constant(d[direct_rhs].values, has_constant="add")
            fd = sm.OLS(d[outcome].values, Xd).fit()
            b_idx = direct_rhs.index(mn) + 1  # +1 for const
            coef_b = fd.params[b_idx]

            boot_vals[i] = coef_a * coef_b
        except Exception:
            pass

    return boot_vals


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data = data if "data" in dir() else {}  # noqa: F821

# Required inputs
if "outcome" not in dir():    # noqa: F821
    raise ValueError("Variable 'outcome' is required")
if "predictor" not in dir():  # noqa: F821
    raise ValueError("Variable 'predictor' is required")
if "mediators" not in dir():  # noqa: F821
    raise ValueError("Variable 'mediators' is required and must contain at least one mediator name")

_outcome_raw   = outcome    # noqa: F821
_predictor_raw = predictor  # noqa: F821
_mediators_raw = mediators  # noqa: F821

_outcome_name: str = (
    _outcome_raw[0] if isinstance(_outcome_raw, (list, tuple)) and len(_outcome_raw) > 0
    else str(_outcome_raw)
)
_pred_name: str = (
    _predictor_raw[0] if isinstance(_predictor_raw, (list, tuple)) and len(_predictor_raw) > 0
    else str(_predictor_raw)
)
_med_names: list[str] = (
    [str(m) for m in _mediators_raw] if isinstance(_mediators_raw, (list, tuple))
    else [str(_mediators_raw)]
)

if len(_med_names) == 0:
    raise ValueError("At least one mediator is required")

# Optional covariates
_cov_names: list[str] = []
if "covariates" in dir() and covariates is not None:  # noqa: F821
    _cov_raw = covariates  # noqa: F821
    _cov_names = [str(c) for c in _cov_raw] if isinstance(_cov_raw, (list, tuple)) else [str(_cov_raw)]
    _cov_names = [c for c in _cov_names if c]

# Options - read flat variables injected by the engine (same pattern as R)
_do_bootstrap  = True
_n_boot        = 5000
_ci_level      = 0.95
_do_std        = False
_do_effect_sz  = True
_do_total      = True

_bootstrap_var = data.get("bootstrap") if hasattr(data, "get") else None  # noqa: F821
if "bootstrap" in dir() and bootstrap is not None:   # noqa: F821
    _do_bootstrap = bool(bootstrap)   # noqa: F821
if "nBoot" in dir() and nBoot is not None:           # noqa: F821
    _n_boot = max(100, int(nBoot))    # noqa: F821
if "ciLevel" in dir() and ciLevel is not None:       # noqa: F821
    _v = float(ciLevel)               # noqa: F821
    _ci_level = _v if 0 < _v < 1 else 0.95
if "standardize" in dir() and standardize is not None:  # noqa: F821
    _do_std = bool(standardize)       # noqa: F821
if "effectSize" in dir() and effectSize is not None:    # noqa: F821
    _do_effect_sz = bool(effectSize)  # noqa: F821
if "totalEffect" in dir() and totalEffect is not None:  # noqa: F821
    _do_total = bool(totalEffect)     # noqa: F821

# Validate columns exist
_all_col_names = [_pred_name] + _med_names + [_outcome_name] + _cov_names
for _col in _all_col_names:
    if _col not in _data:
        raise ValueError(f"Column '{_col}' not found in data")

# ---------------------------------------------------------------------------
# Build DataFrame
# ---------------------------------------------------------------------------

df = pd.DataFrame({col: _coerce(_data[col]) for col in _all_col_names})
df = df.dropna()
n = len(df)

_n_min = len(_all_col_names) + 2
if n < _n_min:
    raise ValueError(
        f"Insufficient complete observations (n={n}) for this mediation model. "
        f"Need at least {_n_min} complete cases."
    )

# Standardize if requested
if _do_std:
    for col in _all_col_names:
        col_std = df[col].std(ddof=1)
        if col_std > 0:
            df[col] = (df[col] - df[col].mean()) / col_std

# ---------------------------------------------------------------------------
# Fit models
# ---------------------------------------------------------------------------

_alpha_tail = (1 - _ci_level) / 2

# --- Total effect: X -> Y (path c) ---
_total_rhs = [_pred_name] + _cov_names
_Xt = sm.add_constant(df[_total_rhs].values, has_constant="add")
_fit_total = sm.OLS(df[_outcome_name].values, _Xt).fit()
_path_c = _extract_coef(_fit_total, _pred_name)
# Re-extract using column index since add_constant labels may differ
_path_c = {
    "coef": round(float(_fit_total.params[1]), 6),
    "se":   round(float(_fit_total.bse[1]),    6),
    "t":    round(float(_fit_total.tvalues[1]),6),
    "p":    round(float(_fit_total.pvalues[1]),8),
}

# --- Direct effect: X -> Y | M1, M2, ... (path c') ---
_direct_rhs = [_pred_name] + _med_names + _cov_names
_Xd = sm.add_constant(df[_direct_rhs].values, has_constant="add")
_fit_direct = sm.OLS(df[_outcome_name].values, _Xd).fit()
# Param index 1 = pred_name in direct model
_path_c_prime = {
    "coef": round(float(_fit_direct.params[1]), 6),
    "se":   round(float(_fit_direct.bse[1]),    6),
    "t":    round(float(_fit_direct.tvalues[1]),6),
    "p":    round(float(_fit_direct.pvalues[1]),8),
}
_r2_y     = float(_fit_direct.rsquared)
_adj_r2_y = float(_fit_direct.rsquared_adj)

# ---------------------------------------------------------------------------
# Per-mediator paths
# ---------------------------------------------------------------------------

_paths_out     = {}
_indirect_out  = {}
_r2_mediators  = {}
_effect_sz_out = {}

_rng = np.random.default_rng(20240101)

for _mn in _med_names:
    # --- Path a: X -> M ---
    _a_rhs = [_pred_name] + _cov_names
    _Xa = sm.add_constant(df[_a_rhs].values, has_constant="add")
    _fit_a = sm.OLS(df[_mn].values, _Xa).fit()
    _path_a = {
        "coef": round(float(_fit_a.params[1]), 6),
        "se":   round(float(_fit_a.bse[1]),    6),
        "t":    round(float(_fit_a.tvalues[1]),6),
        "p":    round(float(_fit_a.pvalues[1]),8),
    }
    _r2_mediators[_mn] = {
        "r_squared":     round(float(_fit_a.rsquared),     6),
        "adj_r_squared": round(float(_fit_a.rsquared_adj), 6),
    }

    # --- Path b: M -> Y | X (from direct model, param index = mediator's position) ---
    _b_idx = _direct_rhs.index(_mn) + 1  # +1 for const
    _path_b = {
        "coef": round(float(_fit_direct.params[_b_idx]), 6),
        "se":   round(float(_fit_direct.bse[_b_idx]),    6),
        "t":    round(float(_fit_direct.tvalues[_b_idx]),6),
        "p":    round(float(_fit_direct.pvalues[_b_idx]),8),
    }

    # Product-of-coefficients indirect effect
    _indirect_est = _path_a["coef"] * _path_b["coef"]

    # --- CI for indirect effect ---
    _boot_se  = None
    _ci_lower = None
    _ci_upper = None

    if _do_bootstrap:
        try:
            _boot_vals = _bootstrap_indirect(
                df, _pred_name, _mn, _med_names, _outcome_name,
                _cov_names, _n_boot, _rng
            )
            _valid = _boot_vals[np.isfinite(_boot_vals)]
            if len(_valid) >= 10:
                _boot_se  = round(float(np.std(_valid, ddof=1)), 6)
                _ci_lower = round(float(np.percentile(_valid, _alpha_tail * 100)), 6)
                _ci_upper = round(float(np.percentile(_valid, (1 - _alpha_tail) * 100)), 6)
        except Exception as _e:
            warnings.warn(f"Bootstrapping failed for mediator '{_mn}': {_e}")
    else:
        # Sobel SE approximation
        _sobel_se = float(np.sqrt(
            _path_b["coef"] ** 2 * _path_a["se"] ** 2 +
            _path_a["coef"] ** 2 * _path_b["se"] ** 2
        ))
        _z_crit = float(np.abs(np.percentile(
            np.random.standard_normal(1_000_000), (1 - _alpha_tail) * 100
        )))
        # Use scipy norm instead
        from scipy import stats as _scipy_stats
        _z_crit   = float(_scipy_stats.norm.ppf(1 - _alpha_tail))
        _boot_se  = round(_sobel_se, 6)
        _ci_lower = round(_indirect_est - _z_crit * _sobel_se, 6)
        _ci_upper = round(_indirect_est + _z_crit * _sobel_se, 6)

    _is_significant = (
        not (_ci_lower <= 0 <= _ci_upper)
        if (_ci_lower is not None and _ci_upper is not None)
        else None
    )

    _paths_out[_mn] = {
        "a":       _path_a,
        "b":       _path_b,
        "c":       _path_c,
        "c_prime": _path_c_prime,
    }

    _indirect_out[_mn] = {
        "effect":      round(float(_indirect_est), 6),
        "boot_se":     _boot_se,
        "ci_lower":    _ci_lower,
        "ci_upper":    _ci_upper,
        "significant": _is_significant,
    }

    # --- Effect size: kappa-squared (Preacher & Kelley, 2011) ---
    if _do_effect_sz:
        try:
            _var_x  = float(df[_pred_name].var(ddof=1))
            _var_m  = float(df[_mn].var(ddof=1))
            _var_y  = float(df[_outcome_name].var(ddof=1))
            _a_std  = _path_a["coef"] * np.sqrt(_var_x) / np.sqrt(_var_m)
            _b_std  = _path_b["coef"] * np.sqrt(_var_m) / np.sqrt(_var_y)
            _ind_std = _a_std * _b_std
            _r_xm   = float(df[_pred_name].corr(df[_mn]))
            _max_ind = abs(_r_xm) * np.sqrt(1 - _r_xm ** 2) * np.sign(_ind_std) if _ind_std != 0 else 0
            if abs(_max_ind) > 1e-10:
                _kq = min(abs(_ind_std / _max_ind), 1.0)
            else:
                _kq = None

            if _kq is not None:
                if _kq < 0.01:
                    _kq_interp = "negligible"
                elif _kq < 0.09:
                    _kq_interp = "small"
                elif _kq < 0.25:
                    _kq_interp = "medium"
                else:
                    _kq_interp = "large"
            else:
                _kq_interp = "unavailable"

            _effect_sz_out[_mn] = {
                "kappa_squared": round(float(_kq), 4) if _kq is not None else None,
                "interpretation": _kq_interp,
            }
        except Exception:
            _effect_sz_out[_mn] = {"kappa_squared": None, "interpretation": "unavailable"}

# ---------------------------------------------------------------------------
# Total indirect effect (sum across mediators)
# ---------------------------------------------------------------------------

_total_indirect_est = sum(
    v["effect"] for v in _indirect_out.values()
    if v["effect"] is not None and np.isfinite(v["effect"])
)

_total_ci_lower = None
_total_ci_upper = None
_total_boot_se  = None

if len(_med_names) == 1:
    # Single mediator: reuse per-mediator CI
    _single = _indirect_out[_med_names[0]]
    _total_boot_se  = _single["boot_se"]
    _total_ci_lower = _single["ci_lower"]
    _total_ci_upper = _single["ci_upper"]

elif _do_bootstrap and len(_med_names) > 1:
    # Combined bootstrap for total indirect (sum over all mediators)
    try:
        _n_obs = len(df)
        _total_boots = np.empty(_n_boot)
        _total_boots[:] = np.nan
        _rng2 = np.random.default_rng(20240102)

        _a_rhs_list  = [_pred_name] + _cov_names
        _dir_rhs_list = [_pred_name] + _med_names + _cov_names

        for _bi in range(_n_boot):
            _idx2 = _rng2.integers(0, _n_obs, size=_n_obs)
            _d2 = df.iloc[_idx2].reset_index(drop=True)
            try:
                _Xd2 = sm.add_constant(_d2[_dir_rhs_list].values, has_constant="add")
                _fd2 = sm.OLS(_d2[_outcome_name].values, _Xd2).fit()
                _total_ab = 0.0
                for _bm in _med_names:
                    _Xa2 = sm.add_constant(_d2[_a_rhs_list].values, has_constant="add")
                    _fa2 = sm.OLS(_d2[_bm].values, _Xa2).fit()
                    _ca2 = _fa2.params[1]
                    _bi2 = _dir_rhs_list.index(_bm) + 1
                    _cb2 = _fd2.params[_bi2]
                    if np.isfinite(_ca2) and np.isfinite(_cb2):
                        _total_ab += _ca2 * _cb2
                _total_boots[_bi] = _total_ab
            except Exception:
                pass

        _valid2 = _total_boots[np.isfinite(_total_boots)]
        if len(_valid2) >= 10:
            _total_boot_se  = round(float(np.std(_valid2, ddof=1)), 6)
            _total_ci_lower = round(float(np.percentile(_valid2, _alpha_tail * 100)), 6)
            _total_ci_upper = round(float(np.percentile(_valid2, (1 - _alpha_tail) * 100)), 6)
    except Exception as _e2:
        warnings.warn(f"Total indirect bootstrap failed: {_e2}")

_total_sig = (
    not (_total_ci_lower <= 0 <= _total_ci_upper)
    if (_total_ci_lower is not None and _total_ci_upper is not None)
    else None
)

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_n_med   = len(_med_names)
_ci_pct  = _ci_level * 100
_method  = (
    f"bias-corrected bootstrap (B = {_n_boot})"
    if _do_bootstrap
    else "Sobel z-approximation"
)

_sig_meds = [
    _mn for _mn in _med_names
    if _indirect_out[_mn].get("significant") is True
]

if len(_sig_meds) == 0:
    _sig_str = "None of the indirect effects were significant"
elif len(_sig_meds) == _n_med:
    _sig_str = (
        f"All {_n_med} indirect effect(s) via {', '.join(_sig_meds)} were significant"
    )
else:
    _sig_str = f"Significant indirect effect(s) via: {', '.join(_sig_meds)}"

_alpha_val = 1 - _ci_level
_c_p_cmp   = "<" if (_path_c["p"] is not None and _path_c["p"] < _alpha_val) else ">="
_cp_p_cmp  = "<" if (_path_c_prime["p"] is not None and _path_c_prime["p"] < _alpha_val) else ">="

_med_label = (
    f"'{_med_names[0]}'"
    if _n_med == 1
    else f"{_n_med} mediators ({', '.join(_med_names)})"
)

interpretation = " ".join([
    f"Mediation analysis (PROCESS Model 4 style) tested whether the effect of '{_pred_name}' "
    f"on '{_outcome_name}' was mediated by {_med_label}.",
    f"N = {n} complete cases used. Indirect effects estimated via {_method} with {_ci_pct:.0f}% CIs.",
    f"Total effect (path c): b = {_path_c['coef']:.3f}, SE = {_path_c['se']:.3f}, p {_c_p_cmp} {_alpha_val:.4f}.",
    f"Direct effect (path c'): b = {_path_c_prime['coef']:.3f}, SE = {_path_c_prime['se']:.3f}, p {_cp_p_cmp} {_alpha_val:.4f}.",
    f"{_sig_str}.",
])

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n":           n,
    "predictor":   _pred_name,
    "outcome":     _outcome_name,
    "mediators":   _med_names,
    "covariates":  _cov_names if _cov_names else None,
    "paths":       _paths_out,
    "indirect":    _indirect_out,
    "total_indirect": {
        "effect":      round(float(_total_indirect_est), 6),
        "boot_se":     _total_boot_se,
        "ci_lower":    _total_ci_lower,
        "ci_upper":    _total_ci_upper,
        "significant": _total_sig,
    },
    "direct": {
        "effect": _path_c_prime["coef"],
        "se":     _path_c_prime["se"],
        "t":      _path_c_prime["t"],
        "p":      _path_c_prime["p"],
    },
    "total": {
        "effect": _path_c["coef"],
        "se":     _path_c["se"],
        "t":      _path_c["t"],
        "p":      _path_c["p"],
    } if _do_total else None,
    "model_summary": {
        "r_squared_y":     round(_r2_y,     6),
        "adj_r_squared_y": round(_adj_r2_y, 6),
        "r_squared_m":     _r2_mediators,
    },
    "effect_sizes": _effect_sz_out if _do_effect_sz else None,
    "standardized": _do_std,
    "ci_level":     _ci_level,
    "n_boot":       _n_boot if _do_bootstrap else None,
    "interpretation": interpretation,
}
