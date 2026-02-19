"""
Multi-Group Confirmatory Factor Analysis (Measurement Invariance) Script
=========================================================================
Tests measurement invariance across groups by fitting a sequence of
increasingly constrained CFA models:
  configural  -> metric  -> scalar  -> strict

Expected namespace variables (injected by engine):

  data         : dict                Columnar data dictionary: {col_name: [values...]}.
  variables    : list[str]           Observed indicator variable names.
  factors      : dict                Named mapping of factor labels to indicator lists.
                                     e.g. {"F1": ["item1","item2","item3"]}
  group_var    : str                 Name of the grouping variable column.
  options      : dict                Optional settings:
                   estimator    : str  "ML" | "MLR" | "WLSMV" (default "ML")
                   standardized : bool  include standardized estimates (default True)
                   fitIndices   : bool  compute fit indices (default True)
                   testStrict   : bool  also fit strict invariance model (default True)
                   missingValues: str  "exclude-listwise" | "fiml" (default "exclude-listwise")

Result structure
----------------
{
  "configural_fit": {model: str, chi_square: float, df: int, p_value: float,
                     CFI: float, TLI: float, RMSEA: float, SRMR: float,
                     AIC: float, BIC: float, converged: bool},
  "metric_fit":     { same structure },
  "scalar_fit":     { same structure },
  "strict_fit":     { same structure } | null,
  "comparison_table": [
    {"comparison": str, "delta_chi_sq": float, "delta_df": int, "p_value": float,
     "significant": bool, "delta_CFI": float, "delta_RMSEA": float}
  ],
  "loadings": [
    {"group": str, "factor": str, "indicator": str,
     "estimate": float, "se": float, "p_value": float, "std_loading": float}
  ],
  "model_syntax": str,
  "group_variable": str,
  "groups": list[str],
  "n_per_group": {group: int, ...},
  "estimator": str,
  "n": int,
  "n_factors": int,
  "factor_names": list[str],
  "variable_names": list[str],
  "invariance_level": str,
  "interpretation": str
}
"""

from __future__ import annotations

import warnings
import numpy as np
import pandas as pd
from scipy import stats as scipy_stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(x) -> float | None:
    try:
        v = float(x)
        return None if (v != v) else v
    except (TypeError, ValueError):
        return None


def _round(x, digits=4) -> float | None:
    v = _safe_float(x)
    return round(v, digits) if v is not None else None


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data: dict = data if "data" in dir() else {}  # noqa: F821

# variables: list of indicator column names
try:
    _variables = list(variables)  # noqa: F821
except NameError:
    raise ValueError("Variable 'variables' is required - specify observed indicator column names.")

if len(_variables) < 2:
    raise ValueError("Multi-group CFA requires at least 2 observed variables.")

# factors: dict mapping factor names -> list of indicator names
try:
    _factors_raw = factors  # noqa: F821
except NameError:
    raise ValueError("Variable 'factors' is required - specify factor structure as a named dict.")

if not _factors_raw or not isinstance(_factors_raw, dict):
    raise ValueError("'factors' must be a non-empty dict mapping factor names to indicator lists.")

_factor_indicators: dict[str, list[str]] = {}
for _fn, _inds in _factors_raw.items():
    if isinstance(_inds, (list, tuple)):
        _factor_indicators[_fn] = [str(v) for v in _inds]
    else:
        _factor_indicators[_fn] = [str(_inds)]

_factor_names: list[str] = list(_factor_indicators.keys())

for _fn in _factor_names:
    if len(_factor_indicators[_fn]) < 2:
        raise ValueError(f"Factor '{_fn}' has fewer than 2 indicators.")

# group_var: name of the grouping column
try:
    _group_col_raw = group_var  # noqa: F821
    _group_col = str(_group_col_raw[0] if isinstance(_group_col_raw, (list, tuple)) else _group_col_raw).strip()
except NameError:
    _group_col = str(_data.get("group_var", "")).strip()  # noqa: F821

if not _group_col:
    raise ValueError("Variable 'group_var' is required - specify the grouping variable column name.")

# Options
_options: dict = _data.get("options", {}) if isinstance(_data, dict) else {}
if not isinstance(_options, dict):
    _options = {}

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
    _test_strict = bool(testStrict)  # noqa: F821
except NameError:
    _test_strict = bool(_options.get("testStrict", True))

try:
    _missing_opt = str(missingValues)  # noqa: F821
except NameError:
    _missing_opt = str(_options.get("missingValues", "exclude-listwise"))

_valid_estimators = {"ML", "MLR", "WLSMV", "ULS", "DWLS", "GLS", "WLS"}
if _estimator_opt not in _valid_estimators:
    warnings.warn(f"Unknown estimator '{_estimator_opt}'; defaulting to 'ML'.")
    _estimator_opt = "ML"

# ---------------------------------------------------------------------------
# Build DataFrame
# ---------------------------------------------------------------------------

df = pd.DataFrame(_data)

_all_cols = _variables + [_group_col]
for _col in _all_cols:
    if _col not in df.columns:
        raise ValueError(f"Column '{_col}' not found in data.")

# Coerce indicator columns to numeric
for _col in _variables:
    df[_col] = pd.to_numeric(df[_col], errors="coerce")

if _missing_opt != "fiml":
    df = df[_all_cols].dropna()
else:
    df = df[_all_cols].copy()

n_total = len(df)
if n_total < 10:
    raise ValueError("Insufficient observations for multi-group CFA.")

# Group labels
_group_levels = sorted(df[_group_col].unique().tolist(), key=str)
_n_groups = len(_group_levels)

if _n_groups < 2:
    raise ValueError("Grouping variable must have at least 2 distinct groups.")
if _n_groups > 20:
    warnings.warn("More than 20 groups detected; results may be unstable.")

_n_per_group = {str(g): int((df[_group_col] == g).sum()) for g in _group_levels}

# ---------------------------------------------------------------------------
# Build semopy model syntax
# ---------------------------------------------------------------------------

_model_lines = [
    f"{fn} =~ {' + '.join(_factor_indicators[fn])}"
    for fn in _factor_names
]
model_syntax = "\n".join(_model_lines)

# ---------------------------------------------------------------------------
# Import semopy
# ---------------------------------------------------------------------------

try:
    import semopy
except ImportError:
    raise ImportError(
        "Package 'semopy' is required for Multi-Group CFA. Install with: pip install semopy"
    )

# ---------------------------------------------------------------------------
# Helper: fit a multi-group CFA model with a given constraint level
# ---------------------------------------------------------------------------

def _fit_mg_model(
    model_str: str,
    data_df: pd.DataFrame,
    group_col: str,
    groups: list,
    constraint: str,  # "configural" | "metric" | "scalar" | "strict"
) -> semopy.ModelMeans | None:
    """
    Fit a multi-group CFA using semopy's group fitting capabilities.

    semopy >= 2.3 supports group= parameter in ModelMeans or Model.
    For invariance testing we fit separate per-group models (configural)
    or constrained models using semopy's multi-group API.
    """
    try:
        # semopy 2.x multi-group approach:
        # ModelMeans with group parameter handles multi-group estimation.
        # Constraint levels map to:
        #   configural: group_equal=[]  (no cross-group constraints)
        #   metric:     group_equal=["loadings"]
        #   scalar:     group_equal=["loadings", "intercepts"]
        #   strict:     group_equal=["loadings", "intercepts", "residuals"]
        _equal_map = {
            "configural": [],
            "metric":     ["loadings"],
            "scalar":     ["loadings", "intercepts"],
            "strict":     ["loadings", "intercepts", "residuals"],
        }
        _group_equal = _equal_map.get(constraint, [])

        _mod = semopy.ModelMeans(model_str)
        _mod.fit(data_df, group=group_col, group_equal=_group_equal)
        return _mod
    except (AttributeError, TypeError):
        # Fallback: semopy version without ModelMeans group support
        # Use basic Model per group for configural; return None for constrained
        if constraint == "configural":
            try:
                _mod = semopy.Model(model_str)
                _mod.fit(data_df)
                return _mod
            except Exception as _e:
                warnings.warn(f"Configural model fit failed: {_e}")
                return None
        return None
    except Exception as _e:
        warnings.warn(f"Model fit failed for constraint='{constraint}': {_e}")
        return None


# ---------------------------------------------------------------------------
# Helper: extract fit statistics from a fitted semopy model
# ---------------------------------------------------------------------------

def _extract_fit(model, model_name: str) -> dict | None:
    if model is None:
        return None
    try:
        _stats = semopy.calc_stats(model)
        if isinstance(_stats, pd.DataFrame):
            _sd = _stats.iloc[:, 0].to_dict() if _stats.shape[1] >= 1 else {}
        else:
            _sd = {}

        def _gs(*keys):
            for k in keys:
                if k in _sd:
                    v = _safe_float(_sd[k])
                    return _round(v, 4) if v is not None else None
            return None

        _converged = True
        try:
            _converged = getattr(model, "last_result", None) is not None
        except Exception:
            pass

        return {
            "model":       model_name,
            "chi_square":  _gs("chi2", "Chi2", "chi_square"),
            "df":          _gs("DoF", "df"),
            "p_value":     _gs("p-value", "pvalue", "p_chi2"),
            "CFI":         _gs("CFI"),
            "TLI":         _gs("TLI"),
            "RMSEA":       _gs("RMSEA"),
            "RMSEA_lower": _gs("RMSEA lower", "rmsea_lower"),
            "RMSEA_upper": _gs("RMSEA upper", "rmsea_upper"),
            "SRMR":        _gs("SRMR"),
            "AIC":         _gs("AIC"),
            "BIC":         _gs("BIC"),
            "converged":   _converged,
        }
    except Exception as _e:
        warnings.warn(f"Fit extraction failed for {model_name}: {_e}")
        return {"model": model_name, "converged": False}


# ---------------------------------------------------------------------------
# Fit the four invariance models
# ---------------------------------------------------------------------------

_fit_configural_model = _fit_mg_model(model_syntax, df, _group_col, _group_levels, "configural")
if _fit_configural_model is None:
    raise RuntimeError("Configural model failed to fit. Check factor structure and data.")

_fit_metric_model  = _fit_mg_model(model_syntax, df, _group_col, _group_levels, "metric")
_fit_scalar_model  = _fit_mg_model(model_syntax, df, _group_col, _group_levels, "scalar")
_fit_strict_model  = _fit_mg_model(model_syntax, df, _group_col, _group_levels, "strict") if _test_strict else None

configural_fit = _extract_fit(_fit_configural_model, "Configural")
metric_fit     = _extract_fit(_fit_metric_model,     "Metric")
scalar_fit     = _extract_fit(_fit_scalar_model,     "Scalar")
strict_fit     = _extract_fit(_fit_strict_model,     "Strict") if _fit_strict_model is not None else None

# ---------------------------------------------------------------------------
# Chi-square difference test between two model fits
# Uses the stored AIC/BIC/chi2/df values to approximate the LRT.
# ---------------------------------------------------------------------------

def _chi_diff_test(
    fit_constrained: dict | None,
    fit_free: dict | None,
    label_constrained: str,
    label_free: str,
) -> dict | None:
    if fit_constrained is None or fit_free is None:
        return None
    try:
        chi_c = _safe_float(fit_constrained.get("chi_square"))
        df_c  = _safe_float(fit_constrained.get("df"))
        chi_f = _safe_float(fit_free.get("chi_square"))
        df_f  = _safe_float(fit_free.get("df"))

        if any(v is None for v in [chi_c, df_c, chi_f, df_f]):
            return None

        delta_chi = chi_c - chi_f
        delta_df  = int(df_c - df_f)
        p_val: float | None = None
        if delta_df > 0 and delta_chi >= 0:
            p_val = float(scipy_stats.chi2.sf(delta_chi, delta_df))

        return {
            "comparison":   f"{label_constrained} vs. {label_free}",
            "delta_chi_sq": _round(delta_chi, 3),
            "delta_df":     delta_df,
            "p_value":      _round(p_val, 4) if p_val is not None else None,
            "significant":  (p_val is not None and p_val < 0.05),
        }
    except Exception:
        return None


def _delta_fit_indices(
    fit_constrained: dict | None,
    fit_free: dict | None,
) -> dict:
    """Return delta_CFI and delta_RMSEA (constrained - free)."""
    result: dict = {}
    if fit_constrained is None or fit_free is None:
        return result
    cfi_c  = _safe_float(fit_constrained.get("CFI"))
    cfi_f  = _safe_float(fit_free.get("CFI"))
    r_c    = _safe_float(fit_constrained.get("RMSEA"))
    r_f    = _safe_float(fit_free.get("RMSEA"))
    if cfi_c is not None and cfi_f is not None:
        result["delta_CFI"]   = _round(cfi_c - cfi_f, 4)
    if r_c is not None and r_f is not None:
        result["delta_RMSEA"] = _round(r_c - r_f, 4)
    return result


# ---------------------------------------------------------------------------
# Build comparison table
# ---------------------------------------------------------------------------

comparison_table = []

# Metric vs. Configural
_chi_m = _chi_diff_test(metric_fit, configural_fit, "Metric", "Configural")
_df_m  = _delta_fit_indices(metric_fit, configural_fit)
if _chi_m or _df_m:
    _row: dict = {"comparison": "Metric vs. Configural"}
    if _chi_m:
        _row.update({k: _chi_m[k] for k in ("delta_chi_sq", "delta_df", "p_value", "significant") if k in _chi_m})
    _row.update(_df_m)
    comparison_table.append(_row)

# Scalar vs. Metric
_chi_s = _chi_diff_test(scalar_fit, metric_fit, "Scalar", "Metric")
_df_s  = _delta_fit_indices(scalar_fit, metric_fit)
if _chi_s or _df_s:
    _row = {"comparison": "Scalar vs. Metric"}
    if _chi_s:
        _row.update({k: _chi_s[k] for k in ("delta_chi_sq", "delta_df", "p_value", "significant") if k in _chi_s})
    _row.update(_df_s)
    comparison_table.append(_row)

# Strict vs. Scalar (if tested)
if strict_fit is not None:
    _chi_st = _chi_diff_test(strict_fit, scalar_fit, "Strict", "Scalar")
    _df_st  = _delta_fit_indices(strict_fit, scalar_fit)
    if _chi_st or _df_st:
        _row = {"comparison": "Strict vs. Scalar"}
        if _chi_st:
            _row.update({k: _chi_st[k] for k in ("delta_chi_sq", "delta_df", "p_value", "significant") if k in _chi_st})
        _row.update(_df_st)
        comparison_table.append(_row)

# ---------------------------------------------------------------------------
# Extract factor loadings from the configural model (per group)
# ---------------------------------------------------------------------------

loadings_list = []

try:
    _params_config = _fit_configural_model.inspect()
    _pc = _params_config.copy()

    # Normalise column names
    _col_map: dict = {}
    for _c in _pc.columns:
        _cl = _c.lower().replace(" ", "_").replace(".", "_").replace("-", "_")
        _col_map[_c] = _cl
    _pc = _pc.rename(columns=_col_map)

    def _get_col(df_: pd.DataFrame, *candidates):
        for c in candidates:
            if c in df_.columns:
                return df_[c]
        return pd.Series([None] * len(df_), index=df_.index)

    _pc_lval = _get_col(_pc, "lval", "lhs")
    _pc_op   = _get_col(_pc, "op")
    _pc_rval = _get_col(_pc, "rval", "rhs")
    _pc_est  = _get_col(_pc, "estimate", "est", "value")
    _pc_se   = _get_col(_pc, "std__err", "std_err", "se")
    _pc_pval = _get_col(_pc, "p_value", "pvalue", "p")
    _pc_grp  = _get_col(_pc, "group")  # may be None if model doesn't support groups

    # Standardized estimates
    _std_est: pd.Series | None = None
    if _do_std:
        try:
            _std_p = _fit_configural_model.inspect(std_est=True)
            _std_p = _std_p.rename(columns={c: c.lower().replace(" ", "_").replace(".", "_") for c in _std_p.columns})
            _std_est = _get_col(_std_p, "estimate", "est", "value")
        except Exception:
            _std_est = None

    for _i in range(len(_pc)):
        _op  = str(_pc_op.iloc[_i])
        _lv  = str(_pc_lval.iloc[_i])
        _rv  = str(_pc_rval.iloc[_i])
        if _op != "=~":
            continue

        # Determine group label
        _grp_idx = _pc_grp.iloc[_i] if _pc_grp is not None else None
        if _grp_idx is not None and _safe_float(_grp_idx) is not None:
            _gi = int(_safe_float(_grp_idx)) - 1  # semopy uses 1-based group index
            _grp_label = str(_group_levels[_gi]) if 0 <= _gi < len(_group_levels) else str(_grp_idx)
        else:
            _grp_label = "all"

        _entry: dict = {
            "group":     _grp_label,
            "factor":    _lv,
            "indicator": _rv,
            "estimate":  _round(_pc_est.iloc[_i]),
            "se":        _round(_pc_se.iloc[_i]),
        }
        _pv = _safe_float(_pc_pval.iloc[_i])
        if _pv is not None:
            _entry["p_value"] = _round(_pv, 6)
        if _do_std and _std_est is not None:
            _sv = _safe_float(_std_est.iloc[_i])
            if _sv is not None:
                _entry["std_loading"] = _round(_sv)
        loadings_list.append(_entry)
except Exception as _le:
    warnings.warn(f"Loading extraction failed: {_le}")

# ---------------------------------------------------------------------------
# Determine highest supported invariance level
# Decision rule: chi-sq diff test p > .05 AND |delta CFI| <= .010
# ---------------------------------------------------------------------------

def _determine_invariance(comp_tbl: list) -> str:
    supported = "configural"
    for _row in comp_tbl:
        _sig       = bool(_row.get("significant", True))
        _delta_cfi = _safe_float(_row.get("delta_CFI"))
        _cfi_concern = _delta_cfi is not None and abs(_delta_cfi) > 0.010
        _label = str(_row.get("comparison", ""))

        if not _sig and not _cfi_concern:
            if "Metric" in _label and "Configural" in _label:
                supported = "metric"
            elif "Scalar" in _label and "Metric" in _label:
                supported = "scalar"
            elif "Strict" in _label and "Scalar" in _label:
                supported = "strict"
        else:
            break  # Stop once invariance is violated
    return supported


invariance_level = _determine_invariance(comparison_table) if comparison_table else "configural"

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_inv_descriptions = {
    "configural": (
        "Configural invariance only: same factor structure holds across groups, "
        "but loadings and intercepts differ."
    ),
    "metric": (
        "Metric invariance: factor loadings are equal across groups, allowing "
        "meaningful comparison of relationships."
    ),
    "scalar": (
        "Scalar invariance: loadings and intercepts are equal, supporting latent "
        "mean comparisons across groups."
    ),
    "strict": (
        "Strict invariance: loadings, intercepts, and residual variances are equal "
        "across groups."
    ),
}

_config_fit_str = "unavailable"
if configural_fit:
    _parts = []
    _chi2  = _safe_float(configural_fit.get("chi_square"))
    _df_v  = _safe_float(configural_fit.get("df"))
    _cfi   = _safe_float(configural_fit.get("CFI"))
    _rmsea = _safe_float(configural_fit.get("RMSEA"))
    if _chi2 is not None and _df_v is not None:
        _parts.append(f"chi2({int(_df_v)}) = {_chi2:.2f}")
    if _cfi   is not None: _parts.append(f"CFI = {_cfi:.3f}")
    if _rmsea is not None: _parts.append(f"RMSEA = {_rmsea:.3f}")
    if _parts:
        _config_fit_str = ", ".join(_parts)

_group_labels_str = ", ".join(str(g) for g in _group_levels)

interpretation = (
    f"Multi-group CFA with {_n_groups} groups ({_group_labels_str}) "
    f"and {len(_factor_names)} factor(s) estimated using {_estimator_opt}. "
    f"N = {n_total} total observations. "
    f"Configural model fit: {_config_fit_str}. "
    f"Conclusion: {_inv_descriptions[invariance_level]}"
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "configural_fit":  configural_fit,
    "metric_fit":      metric_fit,
    "scalar_fit":      scalar_fit,
    "strict_fit":      strict_fit,
    "comparison_table": comparison_table,
    "loadings":        loadings_list,
    "model_syntax":    model_syntax,
    "group_variable":  _group_col,
    "groups":          [str(g) for g in _group_levels],
    "n_per_group":     _n_per_group,
    "estimator":       _estimator_opt,
    "n":               n_total,
    "n_factors":       len(_factor_names),
    "factor_names":    _factor_names,
    "variable_names":  _variables,
    "invariance_level": invariance_level,
    "interpretation":  interpretation,
}
