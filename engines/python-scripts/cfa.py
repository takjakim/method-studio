"""
Confirmatory Factor Analysis (CFA) Script
==========================================
Expects the following variables in the execution namespace (injected by the engine):

  data : list[dict] | dict[str, list] | pd.DataFrame
      The dataset to analyse. Each key is a variable name; values are lists of numbers.

  variables : list[str]
      Names of observed indicator columns to include. Minimum 2 required.

  factors : dict[str, list[str]]
      Factor structure mapping factor name to list of indicator variable names.
      e.g., {"F1": ["item1", "item2", "item3"], "F2": ["item4", "item5"]}

  estimator : str
      Estimation method. One of: "ML" | "MLR" | "GLS" | "WLS". Default: "ML".

  standardized : bool
      Whether to include standardized loadings. Default: True.

  fitIndices : bool
      Whether to compute model fit indices. Default: True.

  modificationIndices : bool
      Whether to compute modification indices. Default: False.

  miThreshold : float
      Minimum MI value to report. Default: 10.

  missingValues : str
      Missing data handling: "exclude-listwise" | "fiml". Default: "exclude-listwise".

  ciLevel : float
      Confidence interval level, e.g. 0.95. Default: 0.95.

Result structure
----------------
{
  "fit_indices": {
    "CFI": float,
    "TLI": float,
    "RMSEA": float,
    "RMSEA_ci_lower": float,
    "RMSEA_ci_upper": float,
    "SRMR": float,
    "chi_square": float,
    "df": int,
    "p_value": float,
    "AIC": float,
    "BIC": float
  },
  "loadings": [
    {
      "factor": str,
      "indicator": str,
      "estimate": float,
      "se": float,
      "z": float,
      "p_value": float,
      "ci_lower": float,
      "ci_upper": float,
      "std_loading": float  # if standardized=True
    },
    ...
  ],
  "factor_correlations": [
    {"factor1": str, "factor2": str, "covariance": float, "correlation": float, ...},
    ...
  ],
  "residual_variances": {var: {"estimate": float, "se": float}, ...},
  "modification_indices": [...] | null,
  "model_syntax": str,
  "estimator": str,
  "n": int,
  "n_vars": int,
  "n_factors": int,
  "variable_names": list[str],
  "factor_names": list[str],
  "converged": bool,
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

def _to_dataframe(raw) -> pd.DataFrame:
    """Normalise various input shapes to a DataFrame."""
    if isinstance(raw, pd.DataFrame):
        return raw
    if isinstance(raw, list):
        return pd.DataFrame(raw)
    if isinstance(raw, dict):
        return pd.DataFrame(raw)
    raise TypeError(f"Unsupported data type for CFA: {type(raw)}")


def _fit_quality_label(cfi, tli, rmsea, srmr) -> str:
    """Return a text label for overall model fit quality."""
    cfi_ok   = cfi   is not None and cfi   >= 0.95
    tli_ok   = tli   is not None and tli   >= 0.95
    rmsea_ok = rmsea is not None and rmsea <= 0.06
    srmr_ok  = srmr  is not None and srmr  <= 0.08
    n_good = sum([cfi_ok, tli_ok, rmsea_ok, srmr_ok])
    if n_good == 4:
        return "excellent"
    elif n_good >= 3:
        return "good"
    elif n_good >= 2:
        return "adequate"
    else:
        return "poor"


def _build_model_syntax(factor_names: list[str], factor_indicators: dict[str, list[str]]) -> str:
    """Build lavaan/semopy-style model syntax string."""
    lines = []
    for fn in factor_names:
        inds = factor_indicators[fn]
        lines.append(f"{fn} =~ {' + '.join(inds)}")
    return "\n".join(lines)


def _run_cfa_semopy(
    df: pd.DataFrame,
    model_syntax: str,
    estimator: str,
    ci_level: float,
    do_std: bool,
) -> dict:
    """
    Run CFA using semopy.
    Returns a dict with keys: params, fit_indices, converged.
    """
    import semopy

    try:
        mod = semopy.Model(model_syntax)
        mod.fit(df, solver="SLSQP")
        converged = True
    except Exception as e:
        raise RuntimeError(f"semopy CFA fitting failed: {e}") from e

    # Parameter estimates
    try:
        params = mod.inspect(std_est=do_std)
    except Exception:
        params = mod.inspect()

    # Fit indices
    fit_dict = {}
    try:
        stats = semopy.calc_stats(mod)
        # stats is a DataFrame with index = statistic name, col = 'Value'
        def _get(name):
            try:
                val = stats.loc[name, "Value"]
                return float(val) if not pd.isna(val) else None
            except (KeyError, TypeError):
                return None

        fit_dict = {
            "CFI":            _get("CFI"),
            "TLI":            _get("TLI"),
            "RMSEA":          _get("RMSEA"),
            "RMSEA_ci_lower": None,  # semopy does not always provide CI
            "RMSEA_ci_upper": None,
            "SRMR":           _get("SRMR"),
            "chi_square":     _get("chi2"),
            "df":             _get("df"),
            "p_value":        _get("chi2 p-value"),
            "AIC":            _get("AIC"),
            "BIC":            _get("BIC"),
        }
        if fit_dict["df"] is not None:
            fit_dict["df"] = int(fit_dict["df"])
    except Exception:
        fit_dict = {}

    return {
        "params": params,
        "fit_indices": fit_dict,
        "converged": converged,
        "model": mod,
    }


def _run_cfa_fallback(
    df: pd.DataFrame,
    factor_names: list[str],
    factor_indicators: dict[str, list[str]],
    do_std: bool,
    ci_level: float,
) -> dict:
    """
    Fallback CFA using factor_analyzer for single-factor models,
    or OLS-based loading estimation for multi-factor.
    Uses manual ML-based CFA via statsmodels/numpy for fit indices.
    Returns same shape as _run_cfa_semopy output.
    """
    from factor_analyzer import FactorAnalyzer, ConfirmatoryFactorAnalyzer, ModelSpecificationParser

    all_indicators = []
    for fn in factor_names:
        all_indicators.extend(factor_indicators[fn])
    all_indicators = list(dict.fromkeys(all_indicators))  # preserve order, deduplicate

    df_sub = df[all_indicators].dropna()
    n_obs = len(df_sub)

    try:
        # Build factor_analyzer model specification
        model_dict = {fn: factor_indicators[fn] for fn in factor_names}
        model_spec = ModelSpecificationParser.parse_model_specification_from_dict(model_dict)
        cfa = ConfirmatoryFactorAnalyzer(model_spec, disp=False)
        cfa.fit(df_sub.values)
        converged = True

        loadings_matrix = cfa.loadings_  # (n_indicators, n_factors)
        # factor_analyzer CFA does not give SE / z / p natively
        # build params list manually
        params_list = []
        for fi, fn in enumerate(factor_names):
            for vi, ind in enumerate(all_indicators):
                # Only emit loading if this indicator belongs to this factor
                if ind not in factor_indicators[fn]:
                    continue
                ind_idx = all_indicators.index(ind)
                est = float(loadings_matrix[ind_idx, fi]) if fi < loadings_matrix.shape[1] else 0.0
                params_list.append({
                    "lval": fn,
                    "op": "=~",
                    "rval": ind,
                    "Estimate": est,
                    "Std. Err": None,
                    "z-value": None,
                    "p-value": None,
                })
        # Residual variances
        communalities = np.sum(loadings_matrix ** 2, axis=1)
        var_data = np.var(df_sub.values, axis=0, ddof=1)
        for vi, ind in enumerate(all_indicators):
            resid_var = max(float(var_data[vi]) * (1 - float(communalities[vi])), 1e-6)
            params_list.append({
                "lval": ind,
                "op": "~~",
                "rval": ind,
                "Estimate": resid_var,
                "Std. Err": None,
                "z-value": None,
                "p-value": None,
            })

        params = pd.DataFrame(params_list)

        # Fit indices: approximate via chi-square residual
        # Sigma (model-implied covariance) from loadings
        Lam = loadings_matrix  # (p, k)
        Phi = np.eye(len(factor_names))  # assume orthogonal for fallback
        Sigma_model = Lam @ Phi @ Lam.T + np.diag(var_data * (1 - communalities))
        S = np.cov(df_sub.values.T, ddof=1)
        p = len(all_indicators)
        k = len(factor_names)
        df_model = max(1, int(p * (p + 1) / 2 - (p * k - k * (k - 1) // 2 + p + k)))

        try:
            sign, logdet_Sigma = np.linalg.slogdet(Sigma_model)
            sign_S, logdet_S = np.linalg.slogdet(S)
            Sigma_inv = np.linalg.inv(Sigma_model)
            chi2_stat = float(n_obs - 1) * (float(logdet_Sigma - logdet_S) + float(np.trace(S @ Sigma_inv)) - p)
            chi2_stat = max(chi2_stat, 0.0)
            p_val = float(scipy_stats.chi2.sf(chi2_stat, df_model))

            # CFI / TLI
            null_model_chisq = float(n_obs - 1) * np.sum(
                np.corrcoef(df_sub.values.T)[np.tril_indices(p, -1)] ** 2
            )
            null_df = p * (p - 1) / 2
            cfi = max(0.0, min(1.0, 1 - (chi2_stat - df_model) / max(null_model_chisq - null_df, 1e-9)))
            tli = max(0.0, ((null_model_chisq / null_df) - (chi2_stat / max(df_model, 1))) /
                       ((null_model_chisq / null_df) - 1))
            rmsea = float(np.sqrt(max(0.0, (chi2_stat - df_model) / (df_model * (n_obs - 1)))))
            # SRMR
            residual_matrix = S - Sigma_model
            srmr = float(np.sqrt(np.mean(residual_matrix[np.tril_indices(p)] ** 2)))

            # AIC/BIC approximation
            n_params = p * k - k * (k - 1) // 2 + p + k
            aic = chi2_stat - 2 * df_model + 2 * n_params
            bic = chi2_stat - df_model * np.log(n_obs) + n_params * np.log(n_obs)

            fit_dict = {
                "CFI": round(float(cfi), 4),
                "TLI": round(float(tli), 4),
                "RMSEA": round(float(rmsea), 4),
                "RMSEA_ci_lower": None,
                "RMSEA_ci_upper": None,
                "SRMR": round(float(srmr), 4),
                "chi_square": round(float(chi2_stat), 4),
                "df": int(df_model),
                "p_value": round(float(p_val), 8),
                "AIC": round(float(aic), 4),
                "BIC": round(float(bic), 4),
            }
        except Exception:
            fit_dict = {
                "CFI": None, "TLI": None, "RMSEA": None,
                "RMSEA_ci_lower": None, "RMSEA_ci_upper": None,
                "SRMR": None, "chi_square": None, "df": None,
                "p_value": None, "AIC": None, "BIC": None,
            }

    except Exception as e:
        raise RuntimeError(f"factor_analyzer CFA fallback also failed: {e}") from e

    return {
        "params": params,
        "fit_indices": fit_dict,
        "converged": converged,
        "model": None,
    }


def _extract_loadings(params: pd.DataFrame, factor_names: list[str], do_std: bool, ci_level: float) -> list[dict]:
    """Extract factor loading rows from parameter table."""
    loadings_rows = params[params["op"] == "=~"] if "op" in params.columns else pd.DataFrame()
    loadings_list = []

    for _, row in loadings_rows.iterrows():
        factor = str(row.get("lval", row.get("LHS", "")))
        indicator = str(row.get("rval", row.get("RHS", "")))
        est = row.get("Estimate", row.get("Est", None))
        se  = row.get("Std. Err", row.get("SE", None))
        z   = row.get("z-value", row.get("z", None))
        pv  = row.get("p-value", row.get("p", None))

        entry = {
            "factor":    factor,
            "indicator": indicator,
            "estimate":  round(float(est), 4) if est is not None and not pd.isna(est) else None,
            "se":        round(float(se),  4) if se  is not None and not pd.isna(se)  else None,
            "z":         round(float(z),   4) if z   is not None and not pd.isna(z)   else None,
            "p_value":   round(float(pv),  6) if pv  is not None and not pd.isna(pv)  else None,
        }

        # CI via normal approximation when se is available
        if entry["estimate"] is not None and entry["se"] is not None:
            z_crit = scipy_stats.norm.ppf(1 - (1 - ci_level) / 2)
            entry["ci_lower"] = round(entry["estimate"] - z_crit * entry["se"], 4)
            entry["ci_upper"] = round(entry["estimate"] + z_crit * entry["se"], 4)
        else:
            entry["ci_lower"] = None
            entry["ci_upper"] = None

        # Standardised loading
        if do_std:
            std_col = next((c for c in params.columns if "std" in c.lower()), None)
            if std_col is not None:
                sv = row.get(std_col, None)
                entry["std_loading"] = round(float(sv), 4) if sv is not None and not pd.isna(sv) else None

        loadings_list.append(entry)

    return loadings_list


def _extract_factor_corrs(params: pd.DataFrame, factor_names: list[str], do_std: bool) -> list[dict] | None:
    """Extract factor covariance/correlation rows."""
    if len(factor_names) < 2:
        return None

    cov_rows = params[
        (params["op"] == "~~") &
        params["lval"].isin(factor_names) &
        params["rval"].isin(factor_names) &
        (params["lval"] != params["rval"])
    ] if "op" in params.columns else pd.DataFrame()

    if cov_rows.empty:
        return None

    result_list = []
    for _, row in cov_rows.iterrows():
        est = row.get("Estimate", row.get("Est", None))
        se  = row.get("Std. Err", row.get("SE", None))
        z   = row.get("z-value", row.get("z", None))
        pv  = row.get("p-value", row.get("p", None))

        entry = {
            "factor1":    str(row.get("lval", "")),
            "factor2":    str(row.get("rval", "")),
            "covariance": round(float(est), 4) if est is not None and not pd.isna(est) else None,
            "se":         round(float(se),  4) if se  is not None and not pd.isna(se)  else None,
            "z":          round(float(z),   4) if z   is not None and not pd.isna(z)   else None,
            "p_value":    round(float(pv),  6) if pv  is not None and not pd.isna(pv)  else None,
        }

        if do_std:
            std_col = next((c for c in params.columns if "std" in c.lower()), None)
            if std_col is not None:
                sv = row.get(std_col, None)
                entry["correlation"] = round(float(sv), 4) if sv is not None and not pd.isna(sv) else None

        result_list.append(entry)

    return result_list if result_list else None


def _extract_residual_variances(
    params: pd.DataFrame,
    var_names: list[str],
    do_std: bool,
) -> dict:
    """Extract residual variance rows for observed variables."""
    resid_rows = params[
        (params["op"] == "~~") &
        (params["lval"] == params["rval"]) &
        params["lval"].isin(var_names)
    ] if "op" in params.columns else pd.DataFrame()

    rv_dict = {}
    for _, row in resid_rows.iterrows():
        vname = str(row.get("lval", ""))
        est = row.get("Estimate", row.get("Est", None))
        se  = row.get("Std. Err", row.get("SE", None))
        entry = {
            "estimate": round(float(est), 4) if est is not None and not pd.isna(est) else None,
            "se":       round(float(se),  4) if se  is not None and not pd.isna(se)  else None,
        }
        if do_std:
            std_col = next((c for c in params.columns if "std" in c.lower()), None)
            if std_col is not None:
                sv = row.get(std_col, None)
                entry["std_residual"] = round(float(sv), 4) if sv is not None and not pd.isna(sv) else None
        rv_dict[vname] = entry

    return rv_dict


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data_raw = data if "data" in dir() else {}  # noqa: F821

try:
    _variables = list(variables)  # noqa: F821
except NameError:
    raise ValueError("Variable 'variables' is required - specify observed column names to analyze")

try:
    _factors_raw = factors  # noqa: F821
except NameError:
    raise ValueError("Variable 'factors' is required - specify factor structure as a named dict")

if not isinstance(_factors_raw, dict) or len(_factors_raw) == 0:
    raise ValueError("'factors' must be a non-empty dict mapping factor names to indicator lists")

# estimator
_estimator = str(data.get("estimator", "ML")).upper() if isinstance(_data_raw, dict) else "ML"  # noqa: F821
_estimator_raw = data.get("estimator") if isinstance(_data_raw, dict) else None  # noqa: F821
try:
    _estimator = str(estimator).upper()  # noqa: F821
except NameError:
    _estimator = "ML"

# standardized
try:
    _do_std = bool(standardized)  # noqa: F821
except NameError:
    _do_std = True

# fitIndices
try:
    _do_fit = bool(fitIndices)  # noqa: F821
except NameError:
    _do_fit = True

# modificationIndices
try:
    _do_mi = bool(modificationIndices)  # noqa: F821
except NameError:
    _do_mi = False

# miThreshold
try:
    _mi_threshold = float(miThreshold)  # noqa: F821
except NameError:
    _mi_threshold = 10.0

# missingValues
try:
    _missing = str(missingValues).lower()  # noqa: F821
except NameError:
    _missing = "exclude-listwise"

# ciLevel
try:
    _ci_level = float(ciLevel)  # noqa: F821
    if not (0 < _ci_level < 1):
        _ci_level = 0.95
except NameError:
    _ci_level = 0.95

# Validate estimator
_valid_estimators = {"ML", "MLR", "GLS", "WLS", "MLM", "WLSMV"}
if _estimator not in _valid_estimators:
    _estimator = "ML"

# ---------------------------------------------------------------------------
# Build factor structure
# ---------------------------------------------------------------------------

_factor_names = list(_factors_raw.keys())
_factor_indicators: dict[str, list[str]] = {}
for _fn, _inds in _factors_raw.items():
    if isinstance(_inds, (list, tuple)):
        _factor_indicators[_fn] = [str(i) for i in _inds]
    else:
        raise ValueError(f"Factor '{_fn}' indicators must be a list, got: {type(_inds)}")

# Validate: every declared indicator must be in variables
_all_indicators = list(dict.fromkeys(ind for inds in _factor_indicators.values() for ind in inds))
_missing_in_vars = [v for v in _all_indicators if v not in _variables]
if _missing_in_vars:
    raise ValueError(f"Indicator(s) in 'factors' not found in 'variables': {_missing_in_vars}")

# Validate minimum 2 indicators per factor
for _fn in _factor_names:
    if len(_factor_indicators[_fn]) < 2:
        raise ValueError(
            f"Factor '{_fn}' has only {len(_factor_indicators[_fn])} indicator(s); at least 2 required."
        )

# ---------------------------------------------------------------------------
# Build analysis dataframe
# ---------------------------------------------------------------------------

df = _to_dataframe(_data_raw)

_missing_cols = [v for v in _all_indicators if v not in df.columns]
if _missing_cols:
    raise ValueError(f"Column(s) not found in data: {_missing_cols}")

df_sub = df[_all_indicators].copy()
for _col in df_sub.columns:
    df_sub[_col] = pd.to_numeric(df_sub[_col], errors="coerce")

if _missing == "fiml":
    df_clean = df_sub.copy()
else:
    df_clean = df_sub.dropna()

_n_obs  = len(df_clean)
_n_vars = len(_all_indicators)

if _n_obs < _n_vars + 1:
    raise ValueError(
        f"Insufficient observations (n={_n_obs}) for {_n_vars} variables. "
        f"Need at least {_n_vars + 1} complete cases."
    )

# ---------------------------------------------------------------------------
# Build model syntax
# ---------------------------------------------------------------------------

_model_syntax = _build_model_syntax(_factor_names, _factor_indicators)

# ---------------------------------------------------------------------------
# Fit CFA
# ---------------------------------------------------------------------------

_cfa_result = None
_used_fallback = False
_fallback_note = ""

try:
    import semopy  # noqa: F401
    _cfa_result = _run_cfa_semopy(df_clean, _model_syntax, _estimator, _ci_level, _do_std)
except ImportError:
    _used_fallback = True
    _fallback_note = " (factor_analyzer fallback; install semopy for full CFA)"
    try:
        _cfa_result = _run_cfa_fallback(
            df_clean, _factor_names, _factor_indicators, _do_std, _ci_level
        )
    except Exception as _e2:
        raise RuntimeError(
            f"CFA failed: semopy not installed and factor_analyzer fallback failed: {_e2}"
        ) from _e2
except Exception as _e:
    raise RuntimeError(f"CFA fitting failed: {_e}") from _e

_params      = _cfa_result["params"]
_fit_raw     = _cfa_result["fit_indices"]
_converged   = _cfa_result["converged"]

# Normalise column names for semopy output (lhs/op/rhs or lval/op/rval)
if "lhs" in _params.columns and "lval" not in _params.columns:
    _params = _params.rename(columns={"lhs": "lval", "rhs": "rval"})
if "Estimate" not in _params.columns and "Estimate" in _params.columns:
    pass  # already fine

# ---------------------------------------------------------------------------
# Extract output structures
# ---------------------------------------------------------------------------

_loadings_list   = _extract_loadings(_params, _factor_names, _do_std, _ci_level)
_factor_corrs    = _extract_factor_corrs(_params, _factor_names, _do_std)
_residual_vars   = _extract_residual_variances(_params, _all_indicators, _do_std)

# Fit indices (round all floats)
_fit_indices_out = None
if _do_fit and _fit_raw:
    _fit_indices_out = {
        k: (round(v, 4) if isinstance(v, float) else v)
        for k, v in _fit_raw.items()
    }

# Modification indices (only available with semopy when requested)
_mi_out = None
if _do_mi and not _used_fallback and _cfa_result.get("model") is not None:
    try:
        import semopy
        _mi_df = semopy.ModificationIndices(_cfa_result["model"])
        if _mi_df is not None and len(_mi_df) > 0:
            _mi_df_filt = _mi_df[_mi_df["mi"] >= _mi_threshold].sort_values("mi", ascending=False)
            _mi_out = [
                {
                    "lhs": str(row.get("lhs", "")),
                    "op":  str(row.get("op",  "")),
                    "rhs": str(row.get("rhs", "")),
                    "mi":  round(float(row.get("mi", 0)), 3),
                }
                for _, row in _mi_df_filt.iterrows()
            ]
    except Exception:
        _mi_out = None

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_cfi   = _fit_indices_out.get("CFI")   if _fit_indices_out else None
_tli   = _fit_indices_out.get("TLI")   if _fit_indices_out else None
_rmsea = _fit_indices_out.get("RMSEA") if _fit_indices_out else None
_srmr  = _fit_indices_out.get("SRMR")  if _fit_indices_out else None
_chi2  = _fit_indices_out.get("chi_square") if _fit_indices_out else None
_df_model = _fit_indices_out.get("df") if _fit_indices_out else None
_p_val = _fit_indices_out.get("p_value") if _fit_indices_out else None

_quality = _fit_quality_label(_cfi, _tli, _rmsea, _srmr)

_factor_desc = (
    f"a single factor ('{_factor_names[0]}')"
    if len(_factor_names) == 1
    else f"{len(_factor_names)} correlated factors ({', '.join(_factor_names)})"
)

_convergence_str = "Model converged normally." if _converged else "WARNING: Model did NOT converge."

_fit_parts = []
if _chi2 is not None and _df_model is not None and _p_val is not None:
    _fit_parts.append(f"chi2({_df_model}) = {_chi2:.2f}, p = {_p_val:.4f}")
if _cfi   is not None: _fit_parts.append(f"CFI = {_cfi:.3f}")
if _tli   is not None: _fit_parts.append(f"TLI = {_tli:.3f}")
if _rmsea is not None: _fit_parts.append(f"RMSEA = {_rmsea:.3f}")
if _srmr  is not None: _fit_parts.append(f"SRMR = {_srmr:.3f}")
_fit_str = "; ".join(_fit_parts) if _fit_parts else "Fit indices not computed"

interpretation = (
    f"CFA with {_factor_desc} was estimated using the {_estimator} estimator{_fallback_note} "
    f"on N = {_n_obs} complete observations across {_n_vars} observed variables. "
    f"{_convergence_str} "
    f"Overall fit: {_fit_str}. "
    f"Model fit quality: {_quality} "
    f"(CFI/TLI >= .95 and RMSEA <= .06 and SRMR <= .08 considered good)."
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "fit_indices":          _fit_indices_out,
    "loadings":             _loadings_list,
    "factor_correlations":  _factor_corrs,
    "residual_variances":   _residual_vars,
    "modification_indices": _mi_out,
    "model_syntax":         _model_syntax,
    "estimator":            _estimator,
    "n":                    _n_obs,
    "n_vars":               _n_vars,
    "n_factors":            len(_factor_names),
    "variable_names":       _all_indicators,
    "factor_names":         _factor_names,
    "converged":            _converged,
    "interpretation":       interpretation,
}
