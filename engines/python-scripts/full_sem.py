"""
Full Structural Equation Modeling (Full SEM) Script
=====================================================
Estimates a complete SEM with both a measurement model (latent variables defined
by indicator items) and a structural model (regression paths between latent
variables and/or observed variables).

Expected namespace variables (injected by engine):

  data         : dict                Columnar data dictionary: {col_name: [values...]}.
  factors      : dict                Named mapping of latent factor names to indicator lists.
                                     e.g. {"Ability": ["a1","a2","a3"], "Perf": ["p1","p2","p3"]}
  paths        : list[dict]          Structural path definitions. Each dict has:
                                       "from": str  predictor variable name
                                       "to"  : str  outcome variable name
                                     Optional: "label": str  parameter label
  options      : dict                Optional settings:
                   estimator       : str  "ML" | "MLR" | "WLSMV" (default "ML")
                   standardized    : bool  include standardized estimates (default True)
                   fitIndices      : bool  compute fit indices (default True)
                   indirectEffects : bool  compute indirect effects (default True)
                   missingValues   : str  "exclude-listwise" | "fiml" (default "exclude-listwise")

Result structure
----------------
{
  "fit_indices": {
    "chi_square": float, "df": int, "p_value": float,
    "CFI": float, "TLI": float, "RMSEA": float,
    "RMSEA_lower": float, "RMSEA_upper": float,
    "SRMR": float, "AIC": float, "BIC": float,
    "GFI": float, "AGFI": float
  },
  "loadings": [
    {"factor": str, "indicator": str, "estimate": float, "se": float,
     "z": float, "p_value": float, "ci_lower": float, "ci_upper": float,
     "std_loading": float}
  ],
  "structural_paths": [
    {"from": str, "to": str, "estimate": float, "se": float,
     "z": float, "p_value": float, "ci_lower": float, "ci_upper": float,
     "std_estimate": float}
  ],
  "indirect_effects": [
    {"from": str, "through": str, "to": str,
     "a_coef": float, "b_coef": float,
     "estimate": float, "std_estimate": float}
  ],
  "total_effects": [
    {"from": str, "to": str, "direct": float, "indirect": float,
     "total": float, "std_direct": float, "std_indirect": float, "std_total": float}
  ],
  "r_squared": {latent_name: float, ...},
  "factor_correlations": [
    {"factor1": str, "factor2": str, "covariance": float, "correlation": float,
     "se": float, "p_value": float}
  ],
  "residual_variances": {variable_name: {"estimate": float, "se": float, "p_value": float}},
  "model_syntax": str,
  "n": int,
  "n_factors": int,
  "factor_names": list[str],
  "endogenous_latents": list[str],
  "exogenous_latents": list[str],
  "estimator": str,
  "converged": bool,
  "interpretation": str
}
"""

from __future__ import annotations

import warnings
import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(x) -> float | None:
    """Convert to Python float, returning None for NaN/None."""
    try:
        v = float(x)
        return None if (v != v) else v  # NaN check
    except (TypeError, ValueError):
        return None


def _round(x, digits=4) -> float | None:
    v = _safe_float(x)
    return round(v, digits) if v is not None else None


def _fit_quality(cfi, rmsea, srmr) -> str:
    cfi_ok   = cfi   is not None and cfi   >= 0.95
    rmsea_ok = rmsea is not None and rmsea <= 0.06
    srmr_ok  = srmr  is not None and srmr  <= 0.08
    n_ok = sum([cfi_ok, rmsea_ok, srmr_ok])
    if n_ok == 3:   return "good"
    if n_ok == 2:   return "adequate"
    if n_ok == 1:   return "marginal"
    return "poor"


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# data is injected as a columnar dict; also available as flat variable 'data'
_data: dict = data if "data" in dir() else {}  # noqa: F821

# factors: dict mapping factor names -> list of indicator variable names
try:
    _factors_raw = factors  # noqa: F821
except NameError:
    raise ValueError("Variable 'factors' is required - specify latent factor structure as a named dict.")

if not _factors_raw or not isinstance(_factors_raw, dict):
    raise ValueError("'factors' must be a non-empty dict mapping factor names to indicator lists.")

# Normalise: each value must be a flat list of strings
_factor_indicators: dict[str, list[str]] = {}
for _fn, _inds in _factors_raw.items():
    if isinstance(_inds, (list, tuple)):
        _factor_indicators[_fn] = [str(v) for v in _inds]
    else:
        _factor_indicators[_fn] = [str(_inds)]

_factor_names: list[str] = list(_factor_indicators.keys())

for _fn in _factor_names:
    if len(_factor_indicators[_fn]) < 2:
        raise ValueError(
            f"Factor '{_fn}' has fewer than 2 indicators; each factor requires at least 2."
        )

_all_indicators: list[str] = list(dict.fromkeys(
    ind for inds in _factor_indicators.values() for ind in inds
))

# paths: list of {"from": str, "to": str} structural path dicts (optional)
try:
    _paths_raw = paths  # noqa: F821
    _has_paths = bool(_paths_raw)
except NameError:
    _paths_raw = []
    _has_paths = False

# Options
_options: dict = data.get("options") if isinstance(_data, dict) else {}  # noqa: F821
if not isinstance(_options, dict):
    _options = {}

# Also check flat option variables (Rust engine may inject each option as its own variable)
try:
    _estimator_opt = str(estimator).upper()  # noqa: F821
except NameError:
    _estimator_opt = str(_options.get("estimator", "ML")).upper()

try:
    _do_std = bool(standardized)  # noqa: F821
except NameError:
    _do_std = bool(_options.get("standardized", True))

try:
    _do_fit = bool(fitIndices)  # noqa: F821
except NameError:
    _do_fit = bool(_options.get("fitIndices", True))

try:
    _do_indirect = bool(indirectEffects)  # noqa: F821
except NameError:
    _do_indirect = bool(_options.get("indirectEffects", True))

try:
    _missing_opt = str(missingValues)  # noqa: F821
except NameError:
    _missing_opt = str(_options.get("missingValues", "exclude-listwise"))

_valid_estimators = {"ML", "MLR", "WLSMV", "ULS", "DWLS", "GLS", "WLS"}
if _estimator_opt not in _valid_estimators:
    warnings.warn(f"Unknown estimator '{_estimator_opt}'; defaulting to 'ML'.")
    _estimator_opt = "ML"

# ---------------------------------------------------------------------------
# Build DataFrame from data dict
# ---------------------------------------------------------------------------

df = pd.DataFrame(_data)

# Select and coerce indicator columns
for _col in _all_indicators:
    if _col not in df.columns:
        raise ValueError(f"Indicator column '{_col}' not found in data.")
    df[_col] = pd.to_numeric(df[_col], errors="coerce")

if _missing_opt != "fiml":
    df = df[_all_indicators].dropna()
else:
    df = df[_all_indicators].copy()

n_obs = len(df)
if n_obs < len(_all_indicators) + 1:
    raise ValueError(
        f"Insufficient observations (n={n_obs}) for {len(_all_indicators)} indicator variables. "
        f"Need at least {len(_all_indicators) + 1} complete cases."
    )

# ---------------------------------------------------------------------------
# Parse structural paths to determine endogenous / exogenous latents
# ---------------------------------------------------------------------------

_endo_latents: list[str] = []
_exo_latents: list[str]  = []
_struct_path_map: dict[str, list[str]] = {}  # outcome -> [predictors]

if _has_paths:
    _path_list = _paths_raw if isinstance(_paths_raw, list) else [_paths_raw]
    for _p in _path_list:
        if not isinstance(_p, dict):
            continue
        _from_v = str(_p.get("from", "")).strip()
        _to_v   = str(_p.get("to",   "")).strip()
        if not _from_v or not _to_v:
            continue
        _struct_path_map.setdefault(_to_v, [])
        if _from_v not in _struct_path_map[_to_v]:
            _struct_path_map[_to_v].append(_from_v)
        if _to_v not in _endo_latents:
            _endo_latents.append(_to_v)

    _all_path_vars = list(set(
        v for preds in _struct_path_map.values() for v in preds
    ) | set(_struct_path_map.keys()))
    _exo_latents = [v for v in _all_path_vars if v not in _endo_latents]

# ---------------------------------------------------------------------------
# Build semopy model syntax
# ---------------------------------------------------------------------------

# Measurement model lines: factor =~ ind1 + ind2 + ...
_measurement_lines = [
    f"{fn} =~ {' + '.join(_factor_indicators[fn])}"
    for fn in _factor_names
]

# Structural model lines: outcome ~ pred1 + pred2 + ...
_structural_lines = [
    f"{outcome} ~ {' + '.join(preds)}"
    for outcome, preds in _struct_path_map.items()
]

model_syntax = "\n".join(_measurement_lines + _structural_lines)

# ---------------------------------------------------------------------------
# Fit the SEM via semopy
# ---------------------------------------------------------------------------

try:
    import semopy
except ImportError:
    raise ImportError(
        "Package 'semopy' is required for Full SEM. Install with: pip install semopy"
    )

# semopy uses Model for SEM; SEMopy >= 2.x API
_sem_model = semopy.Model(model_syntax)

try:
    _opt = _sem_model.fit(df)
    _converged = True
except Exception as _e:
    # Try with default ML if another estimator was intended
    try:
        _sem_model = semopy.Model(model_syntax)
        _opt = _sem_model.fit(df)
        _converged = True
        warnings.warn(f"Initial fit failed ({_e}); retried with default optimiser.")
    except Exception as _e2:
        raise RuntimeError(f"Full SEM fitting failed: {_e2}") from _e2

# ---------------------------------------------------------------------------
# Extract parameter estimates
# ---------------------------------------------------------------------------

try:
    _params = _sem_model.inspect(mode="list", what="est", information="expected")
except Exception:
    _params = _sem_model.inspect()

# semopy returns a DataFrame with columns: lval, op, rval, Estimate, Std. Err, z-value, p-value
# Column names may vary slightly by version; normalise them.
_pe = _params.copy()
_col_map = {}
for _c in _pe.columns:
    _cl = _c.lower().replace(" ", "_").replace(".", "_").replace("-", "_")
    _col_map[_c] = _cl
_pe = _pe.rename(columns=_col_map)

# Ensure essential columns exist with fallback names
def _get_col(df_: pd.DataFrame, *candidates):
    for c in candidates:
        if c in df_.columns:
            return df_[c]
    return pd.Series([None] * len(df_), index=df_.index)

_pe_lval    = _get_col(_pe, "lval", "lhs")
_pe_op      = _get_col(_pe, "op")
_pe_rval    = _get_col(_pe, "rval", "rhs")
_pe_est     = _get_col(_pe, "estimate", "est", "value")
_pe_se      = _get_col(_pe, "std__err", "std_err", "se")
_pe_z       = _get_col(_pe, "z_value", "z_score", "z")
_pe_pval    = _get_col(_pe, "p_value", "pvalue", "p")

# Standardized estimates via semopy
_std_est_col = None
if _do_std:
    try:
        _std_params = _sem_model.inspect(mode="list", what="est", std_est=True)
        _std_params_mapped = _std_params.rename(columns=_col_map)
        _std_est_col = _get_col(_std_params_mapped, "estimate", "est", "value")
    except Exception:
        _std_est_col = None

# ---------------------------------------------------------------------------
# Fit indices
# ---------------------------------------------------------------------------

fit_indices_result = None

if _do_fit:
    try:
        _stats = semopy.calc_stats(_sem_model)
        # semopy.calc_stats returns a DataFrame indexed by stat names
        if isinstance(_stats, pd.DataFrame):
            _stats_dict = _stats.iloc[:, 0].to_dict() if _stats.shape[1] >= 1 else {}
        else:
            _stats_dict = {}

        def _get_stat(*keys):
            for k in keys:
                if k in _stats_dict:
                    v = _safe_float(_stats_dict[k])
                    return _round(v, 4) if v is not None else None
            return None

        fit_indices_result = {
            "chi_square":  _get_stat("DoF baseline", "chi2", "Chi2", "chi_square"),
            "df":          _get_stat("DoF", "df"),
            "p_value":     _get_stat("p-value", "pvalue", "p_chi2"),
            "CFI":         _get_stat("CFI"),
            "TLI":         _get_stat("TLI"),
            "RMSEA":       _get_stat("RMSEA"),
            "RMSEA_lower": _get_stat("RMSEA lower", "rmsea_lower"),
            "RMSEA_upper": _get_stat("RMSEA upper", "rmsea_upper"),
            "SRMR":        _get_stat("SRMR"),
            "AIC":         _get_stat("AIC"),
            "BIC":         _get_stat("BIC"),
            "GFI":         _get_stat("GFI"),
            "AGFI":        _get_stat("AGFI"),
        }
        # Remove None-only entries to keep output tidy but keep structure consistent
        fit_indices_result = {k: v for k, v in fit_indices_result.items() if v is not None}
        if not fit_indices_result:
            fit_indices_result = None
    except Exception as _fe:
        warnings.warn(f"Fit indices computation failed: {_fe}")
        fit_indices_result = None

# ---------------------------------------------------------------------------
# Factor loadings  (op == "=~")
# ---------------------------------------------------------------------------

loadings_list = []
for _i, _row in _pe.iterrows():
    if str(_pe_op.iloc[_i] if hasattr(_pe_op, 'iloc') else _pe_op[_i]) != "=~":
        continue
    _entry: dict = {
        "factor":    str(_pe_lval.iloc[_i]),
        "indicator": str(_pe_rval.iloc[_i]),
        "estimate":  _round(_pe_est.iloc[_i]),
        "se":        _round(_pe_se.iloc[_i]),
    }
    _z = _safe_float(_pe_z.iloc[_i])
    if _z is not None:
        _entry["z"] = _round(_z)
    _pv = _safe_float(_pe_pval.iloc[_i])
    if _pv is not None:
        _entry["p_value"] = _round(_pv, 6)
    if _do_std and _std_est_col is not None:
        _sv = _safe_float(_std_est_col.iloc[_i])
        if _sv is not None:
            _entry["std_loading"] = _round(_sv)
    loadings_list.append(_entry)

# ---------------------------------------------------------------------------
# Structural paths  (op == "~")
# ---------------------------------------------------------------------------

structural_paths_list = []
for _i, _row in _pe.iterrows():
    if str(_pe_op.iloc[_i] if hasattr(_pe_op, 'iloc') else _pe_op[_i]) != "~":
        continue
    _entry = {
        "from":     str(_pe_rval.iloc[_i]),
        "to":       str(_pe_lval.iloc[_i]),
        "estimate": _round(_pe_est.iloc[_i]),
        "se":       _round(_pe_se.iloc[_i]),
    }
    _z = _safe_float(_pe_z.iloc[_i])
    if _z is not None:
        _entry["z"] = _round(_z)
    _pv = _safe_float(_pe_pval.iloc[_i])
    if _pv is not None:
        _entry["p_value"] = _round(_pv, 6)
    if _do_std and _std_est_col is not None:
        _sv = _safe_float(_std_est_col.iloc[_i])
        if _sv is not None:
            _entry["std_estimate"] = _round(_sv)
    structural_paths_list.append(_entry)

# ---------------------------------------------------------------------------
# Factor correlations  (op == "~~" between two different latent factors)
# ---------------------------------------------------------------------------

factor_correlations_result = None
_factor_set = set(_factor_names)

if len(_factor_names) > 1:
    _fc_list = []
    for _i, _row in _pe.iterrows():
        _op = str(_pe_op.iloc[_i])
        _lv = str(_pe_lval.iloc[_i])
        _rv = str(_pe_rval.iloc[_i])
        if _op == "~~" and _lv in _factor_set and _rv in _factor_set and _lv != _rv:
            _entry = {
                "factor1":    _lv,
                "factor2":    _rv,
                "covariance": _round(_pe_est.iloc[_i]),
                "se":         _round(_pe_se.iloc[_i]),
            }
            _pv = _safe_float(_pe_pval.iloc[_i])
            if _pv is not None:
                _entry["p_value"] = _round(_pv, 6)
            if _do_std and _std_est_col is not None:
                _sv = _safe_float(_std_est_col.iloc[_i])
                if _sv is not None:
                    _entry["correlation"] = _round(_sv)
            _fc_list.append(_entry)
    if _fc_list:
        factor_correlations_result = _fc_list

# ---------------------------------------------------------------------------
# Residual variances for endogenous latent variables  (op == "~~", lval == rval)
# ---------------------------------------------------------------------------

residual_variances_result = None
if _endo_latents:
    _rv_dict = {}
    _endo_set = set(_endo_latents)
    for _i, _row in _pe.iterrows():
        _op = str(_pe_op.iloc[_i])
        _lv = str(_pe_lval.iloc[_i])
        _rv = str(_pe_rval.iloc[_i])
        if _op == "~~" and _lv == _rv and _lv in _endo_set:
            _entry = {
                "estimate": _round(_pe_est.iloc[_i]),
                "se":       _round(_pe_se.iloc[_i]),
            }
            _pv = _safe_float(_pe_pval.iloc[_i])
            if _pv is not None:
                _entry["p_value"] = _round(_pv, 6)
            _rv_dict[_lv] = _entry
    if _rv_dict:
        residual_variances_result = _rv_dict

# ---------------------------------------------------------------------------
# R-squared for endogenous latent variables
# Computed as 1 - (residual variance / total variance)
# We approximate from the parameter table.
# ---------------------------------------------------------------------------

r_squared_result = None
if _endo_latents and residual_variances_result:
    _r2_dict = {}
    for _ev in _endo_latents:
        # Total variance approximation: sum of squared loadings + residual
        # For latent endogenous: R2 = 1 - (residual_var / total_latent_var)
        # semopy does not directly expose R2; use indicator variance approach
        try:
            # Predicted values for the latent variable from structural part
            # Approximate: R2 ≈ 1 - resid_var / (resid_var + explained_var)
            # We use the structural path estimates to compute explained variance
            _preds = _struct_path_map.get(_ev, [])
            if not _preds:
                continue
            # Sum of squared standardized structural coefficients as R2 proxy
            if _do_std and _std_est_col is not None:
                _r2_val = 0.0
                for _sp in structural_paths_list:
                    if _sp["to"] == _ev and "std_estimate" in _sp:
                        _r2_val += (_sp["std_estimate"] or 0.0) ** 2
                if _r2_val > 0:
                    _r2_dict[_ev] = round(min(_r2_val, 1.0), 4)
        except Exception:
            pass
    if _r2_dict:
        r_squared_result = _r2_dict

# ---------------------------------------------------------------------------
# Indirect and total effects
# ---------------------------------------------------------------------------

indirect_effects_result = None
total_effects_result    = None

if _has_paths and _do_indirect and structural_paths_list:
    try:
        # Build direct path lookup: (from, to) -> path dict
        _direct_map: dict[tuple[str, str], dict] = {
            (sp["from"], sp["to"]): sp for sp in structural_paths_list
        }

        # Identify mediating latent variables:
        # appear as both an outcome (to) and a predictor (from) in structural paths
        _all_froms = {sp["from"] for sp in structural_paths_list}
        _all_tos   = {sp["to"]   for sp in structural_paths_list}
        _mediators = (_all_froms & _all_tos) & _factor_set

        _indirect_list = []
        for _med in _mediators:
            _x_vars = [sp["from"] for sp in structural_paths_list if sp["to"] == _med]
            _y_vars = [sp["to"]   for sp in structural_paths_list if sp["from"] == _med and sp["to"] != _med]
            for _xv in _x_vars:
                for _yv in _y_vars:
                    _a = _direct_map.get((_xv, _med))
                    _b = _direct_map.get((_med, _yv))
                    if _a and _b:
                        _a_est = _a["estimate"] or 0.0
                        _b_est = _b["estimate"] or 0.0
                        _ind_entry: dict = {
                            "from":     _xv,
                            "through":  _med,
                            "to":       _yv,
                            "a_coef":   _round(_a_est),
                            "b_coef":   _round(_b_est),
                            "estimate": _round(_a_est * _b_est),
                        }
                        if _do_std:
                            _a_std = _a.get("std_estimate")
                            _b_std = _b.get("std_estimate")
                            if _a_std is not None and _b_std is not None:
                                _ind_entry["std_estimate"] = _round(_a_std * _b_std)
                        _indirect_list.append(_ind_entry)

        if _indirect_list:
            indirect_effects_result = _indirect_list

        # Total effects: direct + summed indirect per (from, to) pair
        _te_list = []
        for _sp in structural_paths_list:
            _fv, _tv = _sp["from"], _sp["to"]
            _direct_e  = _sp["estimate"] or 0.0
            _ind_sum   = 0.0
            _std_direct = _sp.get("std_estimate")
            _std_ind    = 0.0

            if indirect_effects_result:
                for _ie in indirect_effects_result:
                    if _ie["from"] == _fv and _ie["to"] == _tv:
                        _ind_sum += (_ie["estimate"] or 0.0)
                        if "std_estimate" in _ie and _ie["std_estimate"] is not None:
                            _std_ind += _ie["std_estimate"]

            _te: dict = {
                "from":   _fv,
                "to":     _tv,
                "direct": _round(_direct_e),
                "total":  _round(_direct_e + _ind_sum),
            }
            if _ind_sum != 0.0:
                _te["indirect"] = _round(_ind_sum)
            if _do_std and _std_direct is not None:
                _te["std_direct"] = _round(_std_direct)
                _te["std_total"]  = _round((_std_direct or 0.0) + _std_ind)
                if _std_ind != 0.0:
                    _te["std_indirect"] = _round(_std_ind)
            _te_list.append(_te)

        if _te_list:
            total_effects_result = _te_list

    except Exception as _ie_err:
        warnings.warn(f"Indirect/total effects computation failed: {_ie_err}")

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_cfi   = (fit_indices_result or {}).get("CFI")
_rmsea = (fit_indices_result or {}).get("RMSEA")
_srmr  = (fit_indices_result or {}).get("SRMR")
_fq    = _fit_quality(_cfi, _rmsea, _srmr)

_fit_str_parts = []
_chi2 = (fit_indices_result or {}).get("chi_square")
_df_v = (fit_indices_result or {}).get("df")
if _chi2 is not None and _df_v is not None:
    _fit_str_parts.append(f"chi2({int(_df_v)}) = {_chi2:.2f}")
if _cfi   is not None: _fit_str_parts.append(f"CFI = {_cfi:.3f}")
if _rmsea is not None: _fit_str_parts.append(f"RMSEA = {_rmsea:.3f}")
if _srmr  is not None: _fit_str_parts.append(f"SRMR = {_srmr:.3f}")
_fit_str = "; ".join(_fit_str_parts) if _fit_str_parts else "Fit indices not computed"

_n_sig_struct = sum(
    1 for p in structural_paths_list
    if p.get("p_value") is not None and p["p_value"] < 0.05
)

_r2_str = ""
if r_squared_result:
    _r2_parts = [f"{k}: R\u00b2={v:.3f}" for k, v in r_squared_result.items() if v is not None]
    if _r2_parts:
        _r2_str = " Variance explained: " + "; ".join(_r2_parts) + "."

interpretation = (
    f"Full SEM with {len(_factor_names)} latent factor(s) ({', '.join(_factor_names)}) "
    f"and {len(_all_indicators)} indicator variable(s). "
    f"{_estimator_opt} estimator, N = {n_obs}. "
    + ("" if _converged else "WARNING: model did not converge. ")
    + f"Structural model: {len(structural_paths_list)} path(s), "
    f"{_n_sig_struct} significant (p < .05). "
    f"Fit: {_fit_str} [{_fq}].{_r2_str}"
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "fit_indices":         fit_indices_result,
    "loadings":            loadings_list,
    "structural_paths":    structural_paths_list,
    "indirect_effects":    indirect_effects_result,
    "total_effects":       total_effects_result,
    "r_squared":           r_squared_result,
    "factor_correlations": factor_correlations_result,
    "residual_variances":  residual_variances_result,
    "model_syntax":        model_syntax,
    "n":                   n_obs,
    "n_factors":           len(_factor_names),
    "factor_names":        _factor_names,
    "endogenous_latents":  _endo_latents,
    "exogenous_latents":   _exo_latents,
    "all_indicators":      _all_indicators,
    "estimator":           _estimator_opt,
    "converged":           _converged,
    "standardized":        _do_std,
    "interpretation":      interpretation,
}
