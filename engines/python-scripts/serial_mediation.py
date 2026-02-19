"""
Serial Mediation Analysis Script (PROCESS Model 6 style)
=========================================================
Performs serial (sequential) mediation with two or more ordered mediators.

Model: X -> M1 -> M2 -> ... -> Mk -> Y

For k mediators the indirect paths are all contiguous sub-chains through the
mediators that start at X and end at Y:
  - Specific path through Mi alone:          a_i * b_i
  - Serial path through Mi -> Mj (i<j):      a_i * d_ij * b_j
  - Serial path through Mi -> Mj -> Ml:      a_i * d_ij * d_jl * b_l
  - ... (all contiguous ordered sub-chains)
  - Full serial path:  a1 * d12 * d23 * ... * d(k-1,k) * bk

Expected namespace variables (injected by engine):

  independentVar : str | list[str]   Predictor (X) column name.
  mediators      : list[str]         Ordered mediator column names [M1, M2, ...].
  dependentVar   : str | list[str]   Outcome (Y) column name.
  covariates     : list[str]         Optional covariate column names.
  data           : dict              Columnar data: {col_name: [values...]}.

  Options (also injected as flat variables):
    bootstrap   : bool   Use bootstrapping for indirect CI (default True).
    nBoot       : int    Number of bootstrap samples (default 5000).
    ciLevel     : float  CI level, e.g. 0.95 (default 0.95).
    standardize : bool   Standardize all variables before analysis (default False).
    effectSize  : bool   Reserved for future use (default True).
    totalEffect : bool   Include total effect (path c) in output (default True).

Result structure
----------------
{
  "n": int,
  "predictor": str,
  "mediators": [str, ...],
  "outcome": str,
  "covariates": [str, ...] | null,
  "paths": {
    "a": [                        # X -> Mi paths (one per mediator)
      {"mediator": str, "coef": float, "se": float, "t": float, "p": float}, ...
    ],
    "b": [                        # Mi -> Y paths (one per mediator)
      {"mediator": str, "coef": float, "se": float, "t": float, "p": float}, ...
    ],
    "d": [                        # Mi -> Mj paths (i < j, consecutive only in regression)
      {"from": str, "to": str, "coef": float, "se": float, "t": float, "p": float}, ...
    ],
    "c":       {"coef": float, "se": float, "t": float, "p": float},  # total
    "c_prime": {"coef": float, "se": float, "t": float, "p": float}   # direct
  },
  "indirect": [
    {
      "path_label": str,          # e.g. "X->M1->Y" or "X->M1->M2->Y"
      "path_vars":  [str, ...],   # variable names in the chain (excl. X/Y)
      "effect": float,
      "boot_se": float | null,
      "ci_lower": float | null,
      "ci_upper": float | null,
      "significant": bool | null
    }, ...
  ],
  "total_indirect": {
    "effect": float,
    "boot_se": float | null,
    "ci_lower": float | null,
    "ci_upper": float | null,
    "significant": bool | null
  },
  "direct": {"effect": float, "se": float, "t": float, "p": float},
  "total":  {"effect": float, "se": float, "t": float, "p": float} | null,
  "model_summary": {
    "r_squared_y": float,
    "adj_r_squared_y": float,
    "r_squared_mediators": [
      {"mediator": str, "r_squared": float, "adj_r_squared": float}, ...
    ]
  },
  "standardized": bool,
  "ci_level": float,
  "n_boot": int | null,
  "interpretation": str
}
"""

from __future__ import annotations

import warnings
from itertools import combinations
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce(x) -> np.ndarray:
    return np.array(x, dtype=float)


def _extract_coef_by_idx(fit_result, idx: int) -> dict:
    """Extract coefficient info at parameter position idx."""
    return {
        "coef": round(float(fit_result.params[idx]),  6),
        "se":   round(float(fit_result.bse[idx]),     6),
        "t":    round(float(fit_result.tvalues[idx]), 6),
        "p":    round(float(fit_result.pvalues[idx]), 8),
    }


def _extract_coef_by_name(fit_result, name: str, rhs_list: list[str]) -> dict:
    """
    Extract coefficient for variable `name` from an OLS result where the RHS
    columns were constructed as [const] + rhs_list.
    Returns None-valued dict if name not found.
    """
    if name not in rhs_list:
        return {"coef": None, "se": None, "t": None, "p": None}
    idx = rhs_list.index(name) + 1  # +1 for intercept
    return _extract_coef_by_idx(fit_result, idx)


def _indirect_paths(mediators: list[str]) -> list[list[str]]:
    """
    Return all contiguous ordered sub-chains of mediators (length >= 1).

    For mediators [M1, M2, M3] this yields:
      [M1], [M2], [M3],
      [M1, M2], [M2, M3],
      [M1, M2, M3]

    Each sub-chain represents an indirect route X -> chain[0] -> ... -> chain[-1] -> Y.
    """
    k = len(mediators)
    paths = []
    for length in range(1, k + 1):
        for start in range(k - length + 1):
            paths.append(mediators[start : start + length])
    return paths


# ---------------------------------------------------------------------------
# Bootstrap engine
# ---------------------------------------------------------------------------

def _run_bootstrap(
    df: pd.DataFrame,
    pred: str,
    mediators: list[str],
    outcome: str,
    covs: list[str],
    n_boot: int,
    rng: np.random.Generator,
) -> dict[str, np.ndarray]:
    """
    Bootstrap all indirect paths simultaneously.

    Returns a dict mapping path_label -> array of bootstrap estimates.
    """
    k    = len(mediators)
    n    = len(df)
    paths = _indirect_paths(mediators)

    # Allocate storage
    boot_storage: dict[str, list[float]] = {
        "_".join(p): [] for p in paths
    }
    boot_storage["__total__"] = []

    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        d   = df.iloc[idx].reset_index(drop=True)

        try:
            # -----------------------------------------------------------------
            # Re-fit all regression models on the resample
            # -----------------------------------------------------------------

            # a_i: X -> Mi  (for each mediator, controlling only prior mediators)
            # Serial mediation regressions:
            #   M1 ~ X  (+ covs)
            #   M2 ~ X + M1  (+ covs)
            #   M3 ~ X + M1 + M2  (+ covs)
            #   ...
            #   Y  ~ X + M1 + M2 + ... + Mk  (+ covs)

            a_coefs:  dict[str, float] = {}   # a_i
            b_coefs:  dict[str, float] = {}   # b_i
            d_coefs:  dict[tuple, float] = {} # d_(i,j) for all i<j pairs from mediator regressions

            ok = True
            for mi_idx, mi in enumerate(mediators):
                prior_meds = mediators[:mi_idx]  # mediators before current
                rhs = [pred] + prior_meds + covs
                try:
                    Xm = sm.add_constant(d[rhs].values, has_constant="add")
                    fm = sm.OLS(d[mi].values, Xm).fit()
                    a_coefs[mi] = float(fm.params[1])  # X coefficient
                    # d_(prior -> mi) coefficients
                    for pm_idx, pm in enumerate(prior_meds):
                        d_coefs[(pm, mi)] = float(fm.params[pm_idx + 2])  # +2: skip const+X
                except Exception:
                    ok = False
                    break

            if not ok:
                continue

            # Y model: outcome ~ X + M1 + ... + Mk + covs
            y_rhs = [pred] + mediators + covs
            try:
                Xy = sm.add_constant(d[y_rhs].values, has_constant="add")
                fy = sm.OLS(d[outcome].values, Xy).fit()
                for mi in mediators:
                    b_idx_val = y_rhs.index(mi) + 1
                    b_coefs[mi] = float(fy.params[b_idx_val])
            except Exception:
                continue

            # -----------------------------------------------------------------
            # Compute indirect effects for each path
            # -----------------------------------------------------------------
            total_boot = 0.0

            for chain in paths:
                key = "_".join(chain)
                try:
                    effect = a_coefs[chain[0]]
                    for seg_idx in range(len(chain) - 1):
                        effect *= d_coefs[(chain[seg_idx], chain[seg_idx + 1])]
                    effect *= b_coefs[chain[-1]]
                    boot_storage[key].append(effect)
                    total_boot += effect
                except Exception:
                    boot_storage[key].append(np.nan)

            boot_storage["__total__"].append(total_boot)

        except Exception:
            # Entire resample failed — skip
            continue

    # Convert to arrays
    return {k: np.array(v, dtype=float) for k, v in boot_storage.items()}


def _ci_from_boots(
    boots: np.ndarray,
    alpha_tail: float,
) -> tuple[float | None, float | None, float | None]:
    """Return (boot_se, ci_lower, ci_upper) from a bootstrap array."""
    valid = boots[np.isfinite(boots)]
    if len(valid) < 10:
        return None, None, None
    boot_se  = round(float(np.std(valid, ddof=1)), 6)
    ci_lower = round(float(np.percentile(valid, alpha_tail * 100)),       6)
    ci_upper = round(float(np.percentile(valid, (1 - alpha_tail) * 100)), 6)
    return boot_se, ci_lower, ci_upper


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data: dict = data if "data" in dir() else {}  # noqa: F821

# Required inputs
if "independentVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'independentVar' is required")
if "dependentVar" not in dir():    # noqa: F821
    raise ValueError("Variable 'dependentVar' is required")
if "mediators" not in dir():       # noqa: F821
    raise ValueError("Variable 'mediators' is required and must contain at least one mediator name")

_x_raw   = independentVar  # noqa: F821
_y_raw   = dependentVar    # noqa: F821
_med_raw = mediators       # noqa: F821

_pred_name: str = (
    _x_raw[0] if isinstance(_x_raw, (list, tuple)) and len(_x_raw) > 0
    else str(_x_raw)
)
_outcome_name: str = (
    _y_raw[0] if isinstance(_y_raw, (list, tuple)) and len(_y_raw) > 0
    else str(_y_raw)
)
_med_names: list[str] = (
    [str(m) for m in _med_raw] if isinstance(_med_raw, (list, tuple))
    else [str(_med_raw)]
)

if len(_med_names) == 0:
    raise ValueError("At least one mediator is required")
if len(_med_names) != len(set(_med_names)):
    raise ValueError("Mediator names must be unique")

# Optional covariates
_cov_names: list[str] = []
if "covariates" in dir() and covariates is not None:  # noqa: F821
    _cov_raw   = covariates  # noqa: F821
    _cov_names = [str(c) for c in _cov_raw] if isinstance(_cov_raw, (list, tuple)) else [str(_cov_raw)]
    _cov_names = [c for c in _cov_names if c]

# Options — flat variables injected by the engine
_do_bootstrap = True
_n_boot       = 5000
_ci_level     = 0.95
_do_std       = False
_do_effect_sz = True   # reserved
_do_total     = True

if "bootstrap" in dir() and bootstrap is not None:      # noqa: F821
    _do_bootstrap = bool(bootstrap)                     # noqa: F821
if "nBoot" in dir() and nBoot is not None:              # noqa: F821
    _n_boot = max(100, int(nBoot))                      # noqa: F821
if "ciLevel" in dir() and ciLevel is not None:          # noqa: F821
    _v = float(ciLevel)                                 # noqa: F821
    _ci_level = _v if 0 < _v < 1 else 0.95
if "standardize" in dir() and standardize is not None:  # noqa: F821
    _do_std = bool(standardize)                         # noqa: F821
if "effectSize" in dir() and effectSize is not None:    # noqa: F821
    _do_effect_sz = bool(effectSize)                    # noqa: F821
if "totalEffect" in dir() and totalEffect is not None:  # noqa: F821
    _do_total = bool(totalEffect)                       # noqa: F821

# Validate columns
_all_col_names = [_pred_name] + _med_names + [_outcome_name] + _cov_names
for _col in _all_col_names:
    if _col not in _data:
        raise ValueError(f"Column '{_col}' not found in data")

if _pred_name in _med_names:
    raise ValueError("independentVar must differ from all mediators")
if _outcome_name in _med_names:
    raise ValueError("dependentVar must differ from all mediators")
if _pred_name == _outcome_name:
    raise ValueError("independentVar and dependentVar must differ")

# ---------------------------------------------------------------------------
# Build DataFrame
# ---------------------------------------------------------------------------

df = pd.DataFrame({col: _coerce(_data[col]) for col in _all_col_names})
df = df.dropna()
n  = len(df)

_n_params_min = len(_all_col_names) + 2
if n < _n_params_min:
    raise ValueError(
        f"Insufficient complete observations (n={n}) for serial mediation with "
        f"{len(_med_names)} mediator(s). Need at least {_n_params_min} complete cases."
    )

# Standardize if requested
if _do_std:
    for col in _all_col_names:
        col_std = df[col].std(ddof=1)
        if col_std > 0:
            df[col] = (df[col] - df[col].mean()) / col_std

_alpha_tail = (1 - _ci_level) / 2
_k = len(_med_names)

# ---------------------------------------------------------------------------
# Fit regression models
# ---------------------------------------------------------------------------
# Serial mediation requires one regression per mediator (each includes all
# prior mediators as predictors) plus the outcome regression.
#
# Mi ~ X + M1 + ... + M(i-1)  (+ covariates)   -> a_i, d_ji for j<i
# Y  ~ X + M1 + M2 + ... + Mk  (+ covariates)  -> b_i, c_prime
# Y  ~ X  (+ covariates)                        -> c (total effect)

# --- Mediator regressions ---
_a_paths: list[dict] = []       # X -> Mi
_d_paths: list[dict] = []       # Mi -> Mj (i < j, from Mj regression)
_r2_meds: list[dict] = []

for _mi_idx, _mi in enumerate(_med_names):
    _prior = _med_names[:_mi_idx]
    _rhs   = [_pred_name] + _prior + _cov_names
    _Xm    = sm.add_constant(df[_rhs].values, has_constant="add")
    _fm    = sm.OLS(df[_mi].values, _Xm).fit()

    # a_i: X -> Mi (param index 1)
    _a_paths.append({
        "mediator": _mi,
        **_extract_coef_by_idx(_fm, 1),
    })

    # d_(pm, mi): prior mediator -> current mediator
    for _pm_offset, _pm in enumerate(_prior):
        _d_paths.append({
            "from": _pm,
            "to":   _mi,
            **_extract_coef_by_idx(_fm, _pm_offset + 2),  # +2: skip const + X
        })

    _r2_meds.append({
        "mediator":    _mi,
        "r_squared":     round(float(_fm.rsquared),     6),
        "adj_r_squared": round(float(_fm.rsquared_adj), 6),
    })

# --- Outcome regression (direct model): Y ~ X + M1 + ... + Mk + covs ---
_y_rhs    = [_pred_name] + _med_names + _cov_names
_Xy       = sm.add_constant(df[_y_rhs].values, has_constant="add")
_fit_y    = sm.OLS(df[_outcome_name].values, _Xy).fit()

_b_paths: list[dict] = []
for _mi in _med_names:
    _b_paths.append({
        "mediator": _mi,
        **_extract_coef_by_name(_fit_y, _mi, _y_rhs),
    })

_path_c_prime = {
    "coef": round(float(_fit_y.params[1]), 6),
    "se":   round(float(_fit_y.bse[1]),    6),
    "t":    round(float(_fit_y.tvalues[1]),6),
    "p":    round(float(_fit_y.pvalues[1]),8),
}
_r2_y     = float(_fit_y.rsquared)
_adj_r2_y = float(_fit_y.rsquared_adj)

# --- Total effect: Y ~ X + covs ---
_total_rhs = [_pred_name] + _cov_names
_Xt        = sm.add_constant(df[_total_rhs].values, has_constant="add")
_fit_total = sm.OLS(df[_outcome_name].values, _Xt).fit()
_path_c    = {
    "coef": round(float(_fit_total.params[1]), 6),
    "se":   round(float(_fit_total.bse[1]),    6),
    "t":    round(float(_fit_total.tvalues[1]),6),
    "p":    round(float(_fit_total.pvalues[1]),8),
}

# ---------------------------------------------------------------------------
# Point estimates for all indirect paths
# ---------------------------------------------------------------------------
# Build lookup dicts for fast access
_a_lookup: dict[str, float] = {p["mediator"]: p["coef"] for p in _a_paths}
_b_lookup: dict[str, float] = {p["mediator"]: p["coef"] for p in _b_paths}
_d_lookup: dict[tuple, float] = {(p["from"], p["to"]): p["coef"] for p in _d_paths}

_all_chains  = _indirect_paths(_med_names)
_point_ests: dict[str, float] = {}

for _chain in _all_chains:
    _key = "_".join(_chain)
    _eff = _a_lookup[_chain[0]]
    for _seg in range(len(_chain) - 1):
        _eff *= _d_lookup.get((_chain[_seg], _chain[_seg + 1]), 0.0)
    _eff *= _b_lookup[_chain[-1]]
    _point_ests[_key] = _eff

_total_indirect_est = sum(_point_ests.values())

# ---------------------------------------------------------------------------
# Bootstrap confidence intervals
# ---------------------------------------------------------------------------

_boot_results: dict[str, tuple] = {}  # key -> (boot_se, ci_lower, ci_upper)

if _do_bootstrap:
    _rng = np.random.default_rng(20240601)
    try:
        _all_boots = _run_bootstrap(
            df, _pred_name, _med_names, _outcome_name,
            _cov_names, _n_boot, _rng,
        )
        for _chain in _all_chains:
            _key = "_".join(_chain)
            _se, _lo, _hi = _ci_from_boots(_all_boots.get(_key, np.array([])), _alpha_tail)
            _boot_results[_key] = (_se, _lo, _hi)

        # Total indirect
        _t_se, _t_lo, _t_hi = _ci_from_boots(
            _all_boots.get("__total__", np.array([])), _alpha_tail
        )
    except Exception as _boot_exc:
        warnings.warn(f"Bootstrap failed: {_boot_exc}")
        _t_se = _t_lo = _t_hi = None
else:
    _t_se = _t_lo = _t_hi = None

# ---------------------------------------------------------------------------
# Build indirect output list
# ---------------------------------------------------------------------------

def _make_path_label(chain: list[str], pred: str, outcome: str) -> str:
    return pred + "->" + "->".join(chain) + "->" + outcome


def _make_significant(ci_lower, ci_upper) -> bool | None:
    if ci_lower is None or ci_upper is None:
        return None
    return not (ci_lower <= 0.0 <= ci_upper)


_indirect_list: list[dict] = []
for _chain in _all_chains:
    _key  = "_".join(_chain)
    _est  = _point_ests[_key]
    _se_v, _lo_v, _hi_v = _boot_results.get(_key, (None, None, None))
    _indirect_list.append({
        "path_label":  _make_path_label(_chain, _pred_name, _outcome_name),
        "path_vars":   list(_chain),
        "effect":      round(float(_est), 6),
        "boot_se":     _se_v,
        "ci_lower":    _lo_v,
        "ci_upper":    _hi_v,
        "significant": _make_significant(_lo_v, _hi_v),
    })

_total_sig = _make_significant(_t_lo, _t_hi)

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_ci_pct = _ci_level * 100
_method = (
    f"bias-corrected bootstrap (B = {_n_boot})" if _do_bootstrap
    else "product-of-coefficients (no bootstrap)"
)
_med_chain_str = " -> ".join(_med_names)
_n_paths = len(_indirect_list)

_sig_paths = [ie["path_label"] for ie in _indirect_list if ie["significant"] is True]

if _k == 1:
    _model_str = "simple mediation (PROCESS Model 4 style)"
elif _k == 2:
    _model_str = "serial mediation (PROCESS Model 6 style)"
else:
    _model_str = f"serial mediation with {_k} mediators"

_alpha_val_str = f"{1 - _ci_level:.4f}"
_c_cmp  = "<" if _path_c["p"] is not None and _path_c["p"]       < (1 - _ci_level) else ">="
_cp_cmp = "<" if _path_c_prime["p"] is not None and _path_c_prime["p"] < (1 - _ci_level) else ">="

_interp_parts = [
    f"Serial mediation analysis ({_model_str}) tested whether '{_pred_name}' affects "
    f"'{_outcome_name}' sequentially through {_med_chain_str}.",
    f"N = {n} complete cases. {_n_paths} indirect path(s) estimated via {_method} "
    f"with {_ci_pct:.0f}% CIs.",
    f"Total effect (path c): b = {_path_c['coef']:.4f}, "
    f"SE = {_path_c['se']:.4f}, p {_c_cmp} {_alpha_val_str}.",
    f"Direct effect (path c'): b = {_path_c_prime['coef']:.4f}, "
    f"SE = {_path_c_prime['se']:.4f}, p {_cp_cmp} {_alpha_val_str}.",
    f"Total indirect effect = {_total_indirect_est:.4f}"
    + (f" (95% CI: [{_t_lo:.4f}, {_t_hi:.4f}])" if _t_lo is not None else "")
    + ".",
]

if len(_sig_paths) == 0:
    _interp_parts.append("None of the indirect paths were individually significant.")
elif len(_sig_paths) == _n_paths:
    _interp_parts.append(f"All {_n_paths} indirect path(s) were significant.")
else:
    _interp_parts.append(f"Significant indirect path(s): {'; '.join(_sig_paths)}.")

interpretation = " ".join(_interp_parts)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n":          n,
    "predictor":  _pred_name,
    "mediators":  _med_names,
    "outcome":    _outcome_name,
    "covariates": _cov_names if _cov_names else None,
    "paths": {
        "a":       _a_paths,
        "b":       _b_paths,
        "d":       _d_paths,
        "c":       _path_c,
        "c_prime": _path_c_prime,
    },
    "indirect": _indirect_list,
    "total_indirect": {
        "effect":      round(float(_total_indirect_est), 6),
        "boot_se":     _t_se,
        "ci_lower":    _t_lo,
        "ci_upper":    _t_hi,
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
        "r_squared_y":            round(_r2_y,     6),
        "adj_r_squared_y":        round(_adj_r2_y, 6),
        "r_squared_mediators":    _r2_meds,
    },
    "standardized":   _do_std,
    "ci_level":       _ci_level,
    "n_boot":         _n_boot if _do_bootstrap else None,
    "interpretation": interpretation,
}
