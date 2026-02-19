"""
Multilevel / Hierarchical Linear Modeling (HLM) Script
=======================================================
Performs multilevel (mixed-effects) linear regression using statsmodels MixedLM.

Expected namespace variables (injected by engine):

  outcome      : list[str]           One-element list with the Level-1 outcome column name.
  groupVar     : list[str]           One-element list with the Level-2 grouping column name.
  level1Preds  : list[str]           Level-1 predictor column names (may be empty or absent).
  level2Preds  : list[str]           Level-2 predictor column names (may be empty or absent).
  data         : dict                Columnar data dictionary: {col_name: [values...]}.
  options      : dict                Optional settings:
                   modelType        : str    "null" | "random-intercept" | "random-slope"
                                             (default "random-intercept")
                   centering        : str    "none" | "grand-mean" | "group-mean" (default "none")
                   randomSlopes     : list[str]  Which level-1 predictors get random slopes
                                                 (default: same as level1Preds)
                   reml             : bool   Use REML estimation (default True)
                   confidenceLevel  : float  CI level, e.g. 0.95 (default 0.95)
                   compareModels    : bool   Compare null vs. full model via LRT (default True)
  alpha        : float               Significance level (default 0.05).

Result structure
----------------
{
  "model_type":          str,
  "model_type_label":    str,
  "formula_str":         str,
  "n":                   int,
  "n_groups":            int,
  "converged":           bool,
  "icc":                 float | null,
  "variance_components": {
    "between_group": float | null,
    "within_group":  float | null,
    "total":         float | null
  },
  "fixed_effects": [
    {
      "term":      str,
      "estimate":  float,
      "std_error": float,
      "z_value":   float,
      "p_value":   float,
      "ci_lower":  float,
      "ci_upper":  float
    },
    ...
  ],
  "random_effects": {
    "intercept_variance": float | null,
    "slope_variances":    {predictor: float, ...},
    "residual_variance":  float
  },
  "model_fit": {
    "AIC":      float,
    "BIC":      float,
    "logLik":   float,
    "deviance": float,
    "REML":     bool
  },
  "null_model_fit": {
    "AIC":      float,
    "BIC":      float,
    "logLik":   float,
    "deviance": float
  } | null,
  "lrt_result": {
    "chi_square":  float,
    "df":          int,
    "p_value":     float,
    "significant": bool
  } | null,
  "centering":         str,
  "centering_summary": {"method": str, "variables": list[str]} | null,
  "confidence_level":  float,
  "alpha":             float,
  "interpretation":    str
}
"""

from __future__ import annotations

import warnings
import numpy as np
import pandas as pd
from scipy import stats as scipy_stats
from statsmodels.regression.mixed_linear_model import MixedLM


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce_col(x) -> list:
    """Return a plain Python list (preserving None/NaN for dropna later)."""
    if isinstance(x, (list, tuple)):
        return list(x)
    try:
        return list(x)
    except TypeError:
        return [x]


def _icc_label(icc: float) -> str:
    if icc < 0.05:
        return "negligible"
    elif icc < 0.10:
        return "small"
    elif icc < 0.25:
        return "moderate"
    else:
        return "substantial"


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

if "outcome" not in dir():  # noqa: F821
    raise ValueError("Variable 'outcome' is required")
if "groupVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'groupVar' is required")

_data = data if "data" in dir() else {}  # noqa: F821
_alpha = float(alpha) if "alpha" in dir() else 0.05  # noqa: F821

# Resolve options - check flattened data variables first, then options dict
_options = options if "options" in dir() else {}  # noqa: F821

_model_type      = str(_options.get("modelType",       "random-intercept")) if _options else "random-intercept"
_centering       = str(_options.get("centering",       "none"))             if _options else "none"
_random_slopes   = _options.get("randomSlopes",   None)                    if _options else None
_use_reml        = bool(_options.get("reml",           True))               if _options else True
_confidence_level = float(_options.get("confidenceLevel", 0.95))            if _options else 0.95
_compare_models  = bool(_options.get("compareModels",  True))               if _options else True

# Also check flattened top-level data variables (engine may inject options as top-level keys)
_mt = data.get("modelType")
if _mt is not None:
    _model_type = str(_mt[0] if isinstance(_mt, (list, tuple)) else _mt)

_ct = data.get("centering")
if _ct is not None:
    _centering = str(_ct[0] if isinstance(_ct, (list, tuple)) else _ct)

_rs = data.get("randomSlopes")
if _rs is not None:
    _random_slopes = list(_rs) if isinstance(_rs, (list, tuple)) else [_rs]

_rm = data.get("reml")
if _rm is not None:
    _use_reml = bool(_rm[0] if isinstance(_rm, (list, tuple)) else _rm)

_cl = data.get("confidenceLevel")
if _cl is not None:
    _confidence_level = float(_cl[0] if isinstance(_cl, (list, tuple)) else _cl)

_cm = data.get("compareModels")
if _cm is not None:
    _compare_models = bool(_cm[0] if isinstance(_cm, (list, tuple)) else _cm)

# Extract column names from slot lists
_outcome_raw = outcome  # noqa: F821
_outcome_name: str = (
    _outcome_raw[0] if isinstance(_outcome_raw, (list, tuple)) and len(_outcome_raw) > 0
    else str(_outcome_raw)
)

_group_raw = groupVar  # noqa: F821
_group_name: str = (
    _group_raw[0] if isinstance(_group_raw, (list, tuple)) and len(_group_raw) > 0
    else str(_group_raw)
)

# Level-1 predictors
if "level1Preds" in dir() and level1Preds is not None:  # noqa: F821
    _l1_names: list[str] = [str(n) for n in (level1Preds if isinstance(level1Preds, (list, tuple)) else [level1Preds])]  # noqa: F821
else:
    _l1_names = []

# Level-2 predictors
if "level2Preds" in dir() and level2Preds is not None:  # noqa: F821
    _l2_names: list[str] = [str(n) for n in (level2Preds if isinstance(level2Preds, (list, tuple)) else [level2Preds])]  # noqa: F821
else:
    _l2_names = []

# Default random slopes = all level-1 predictors
if _random_slopes is None:
    _random_slopes = list(_l1_names)

# Validate columns exist in data
for _nm in [_outcome_name, _group_name] + _l1_names + _l2_names:
    if _nm not in _data:
        raise ValueError(f"Column '{_nm}' not found in data")

# ---------------------------------------------------------------------------
# Build DataFrame using pd.DataFrame(data)
# ---------------------------------------------------------------------------

_all_vars = [_outcome_name, _group_name] + _l1_names + _l2_names
_all_vars_unique = list(dict.fromkeys(_all_vars))  # preserve order, deduplicate

df = pd.DataFrame({nm: _coerce_col(_data[nm]) for nm in _all_vars_unique})

# Convert grouping var to string/factor, numerics to float
df[_group_name] = df[_group_name].astype(str)
for _nm in [_outcome_name] + _l1_names + _l2_names:
    df[_nm] = pd.to_numeric(df[_nm], errors="coerce")

# Listwise deletion
df = df.dropna().reset_index(drop=True)
_n = len(df)
_groups = df[_group_name].astype("category")
_n_groups = _groups.nunique()

if _n < 10:
    raise ValueError(f"Insufficient complete observations (n={_n}) for multilevel analysis.")
if _n_groups < 2:
    raise ValueError("Grouping variable must have at least 2 groups.")

# ---------------------------------------------------------------------------
# Centering
# ---------------------------------------------------------------------------

_centering_summary = None
_l1_names_model = list(_l1_names)
_random_slopes_model = [s for s in _random_slopes if s in _l1_names]

if _centering != "none" and len(_l1_names) > 0:
    _centered_vars: list[str] = []
    for _nm in _l1_names:
        _c_nm = _nm + "_c"
        if _centering == "grand-mean":
            gm = float(df[_nm].mean())
            df[_c_nm] = df[_nm] - gm
        elif _centering == "group-mean":
            grp_means = df.groupby(_group_name)[_nm].transform("mean")
            df[_c_nm] = df[_nm] - grp_means
        _centered_vars.append(_nm)

    _l1_names_model = [nm + "_c" for nm in _l1_names]
    _random_slopes_model = [s + "_c" for s in _random_slopes if s in _l1_names]
    _centering_summary = {"method": _centering, "variables": _centered_vars}

# ---------------------------------------------------------------------------
# Build formula string (for display only; MixedLM uses endog/exog directly)
# ---------------------------------------------------------------------------

_fixed_preds_model = _l1_names_model + _l2_names
_fixed_rhs = " + ".join(_fixed_preds_model) if _fixed_preds_model else "1"
if _model_type == "null":
    _fixed_rhs = "1"
    _fixed_preds_model = []

_random_part_str = f"(1|{_group_name})"
if _model_type in ("random-slope", "cross-level") and _random_slopes_model:
    _random_part_str = f"({'|'.join(['1'] + _random_slopes_model)}|{_group_name})"

_formula_str = f"{_outcome_name} ~ {_fixed_rhs} + {_random_part_str}"

_model_type_label = {
    "null":             "Null (unconditional)",
    "random-intercept": "Random Intercept",
    "random-slope":     "Random Slope",
    "cross-level":      "Cross-Level Interaction",
}.get(_model_type, _model_type)

# ---------------------------------------------------------------------------
# Prepare endog / exog matrices for MixedLM
# ---------------------------------------------------------------------------

_endog = df[_outcome_name].values.astype(float)

# Fixed effects design matrix (intercept + fixed predictors)
if _fixed_preds_model:
    _exog = pd.DataFrame({"Intercept": 1.0}, index=df.index)
    for _nm in _fixed_preds_model:
        _exog[_nm] = df[_nm].values
else:
    _exog = pd.DataFrame({"Intercept": 1.0}, index=df.index)

_groups_col = df[_group_name].values

# Random effects design matrix
if _model_type in ("random-slope", "cross-level") and _random_slopes_model:
    _exog_re = pd.DataFrame({"Intercept": 1.0}, index=df.index)
    for _nm in _random_slopes_model:
        _exog_re[_nm] = df[_nm].values
else:
    _exog_re = None  # random intercept only

# ---------------------------------------------------------------------------
# Fit null model (always, for ICC and optional comparison)
# ---------------------------------------------------------------------------

_endog_null = _endog
_exog_null = pd.DataFrame({"Intercept": 1.0}, index=df.index)

_fit_null = None
try:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _null_model = MixedLM(_endog_null, _exog_null, groups=_groups_col)
        _fit_null = _null_model.fit(reml=False, method="lbfgs")
except Exception:
    pass

# ICC from null model variance components
_icc_value = None
_var_between = None
_var_within = None

if _fit_null is not None:
    try:
        _var_between = float(_fit_null.cov_re.iloc[0, 0])
        _var_within  = float(_fit_null.scale)
        if _var_between + _var_within > 0:
            _icc_value = _var_between / (_var_between + _var_within)
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Fit full model
# ---------------------------------------------------------------------------

_converged = False
_fit = None

try:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _model = MixedLM(
            endog=_endog,
            exog=_exog,
            groups=_groups_col,
            exog_re=_exog_re,
        )
        _fit = _model.fit(reml=_use_reml, method="lbfgs")
    _converged = bool(_fit.converged)
except Exception as _exc:
    raise RuntimeError(f"Model fitting failed: {_exc}") from _exc

# ---------------------------------------------------------------------------
# Fixed effects table
# ---------------------------------------------------------------------------

_ci_alpha = 1.0 - _confidence_level
_ci = _fit.conf_int(alpha=_ci_alpha)  # DataFrame with columns [0, 1]

_fixed_effects = []
for _i, _term in enumerate(_fit.fe_params.index):
    _fixed_effects.append({
        "term":      str(_term),
        "estimate":  round(float(_fit.fe_params.iloc[_i]),     6),
        "std_error": round(float(_fit.bse_fe.iloc[_i]),         6),
        "z_value":   round(float(_fit.tvalues.iloc[_i]),        6),
        "p_value":   round(float(_fit.pvalues.iloc[_i]),        8),
        "ci_lower":  round(float(_ci.iloc[_i, 0]),              6),
        "ci_upper":  round(float(_ci.iloc[_i, 1]),              6),
    })

# ---------------------------------------------------------------------------
# Random effects variance components
# ---------------------------------------------------------------------------

_intercept_variance = None
_slope_variances: dict[str, float] = {}
_residual_variance = float(_fit.scale)

try:
    _cov_re = _fit.cov_re
    if _cov_re is not None and _cov_re.shape[0] > 0:
        _re_labels = list(_cov_re.index)
        for _idx, _lbl in enumerate(_re_labels):
            _v = float(_cov_re.iloc[_idx, _idx])
            if _lbl == "Intercept" or _lbl == "Group Var":
                _intercept_variance = _v
            else:
                _slope_variances[str(_lbl)] = round(_v, 6)
        # If only one entry and intercept wasn't labeled, treat it as intercept variance
        if _intercept_variance is None and len(_re_labels) == 1:
            _intercept_variance = float(_cov_re.iloc[0, 0])
except Exception:
    pass

_random_effects = {
    "intercept_variance": round(_intercept_variance, 6) if _intercept_variance is not None else None,
    "slope_variances":    _slope_variances,
    "residual_variance":  round(_residual_variance, 6),
}

# ---------------------------------------------------------------------------
# Model fit statistics
# ---------------------------------------------------------------------------

# For REML fits, refit with ML for AIC/BIC/LRT comparisons
_fit_ml = None
if _use_reml:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            _ml_model = MixedLM(
                endog=_endog,
                exog=_exog,
                groups=_groups_col,
                exog_re=_exog_re,
            )
            _fit_ml = _ml_model.fit(reml=False, method="lbfgs")
    except Exception:
        _fit_ml = None

_fit_for_stats = _fit_ml if _fit_ml is not None else _fit

_aic    = float(_fit_for_stats.aic)
_bic    = float(_fit_for_stats.bic)
_loglik = float(_fit_for_stats.llf)
_dev    = -2.0 * _loglik

_model_fit = {
    "AIC":      round(_aic,    4),
    "BIC":      round(_bic,    4),
    "logLik":   round(_loglik, 6),
    "deviance": round(_dev,    4),
    "REML":     _use_reml,
}

# ---------------------------------------------------------------------------
# Null model fit + Likelihood Ratio Test
# ---------------------------------------------------------------------------

_null_model_fit = None
_lrt_result = None

if _compare_models and _fit_null is not None and _model_type != "null":
    _null_aic    = float(_fit_null.aic)
    _null_bic    = float(_fit_null.bic)
    _null_loglik = float(_fit_null.llf)
    _null_dev    = -2.0 * _null_loglik

    _null_model_fit = {
        "AIC":      round(_null_aic,    4),
        "BIC":      round(_null_bic,    4),
        "logLik":   round(_null_loglik, 6),
        "deviance": round(_null_dev,    4),
    }

    # LRT: full ML model vs. null ML model
    try:
        _ll_full  = float(_fit_for_stats.llf)
        _ll_null  = float(_fit_null.llf)
        _lrt_chi2 = 2.0 * (_ll_full - _ll_null)
        _lrt_df   = int(_fit_for_stats.df_modelwc - _fit_null.df_modelwc)
        if _lrt_df <= 0:
            _lrt_df = max(1, len(_fixed_preds_model))
        _lrt_p    = float(scipy_stats.chi2.sf(_lrt_chi2, _lrt_df))
        _lrt_result = {
            "chi_square":  round(_lrt_chi2, 6),
            "df":          _lrt_df,
            "p_value":     round(_lrt_p,    8),
            "significant": bool(_lrt_p < _alpha),
        }
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Variance components summary
# ---------------------------------------------------------------------------

_variance_components = {
    "between_group": round(_var_between, 6) if _var_between is not None else None,
    "within_group":  round(_var_within,  6) if _var_within  is not None else None,
    "total": (
        round(_var_between + _var_within, 6)
        if _var_between is not None and _var_within is not None
        else None
    ),
}

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_interp_parts: list[str] = []

if _icc_value is not None:
    _icc_pct  = round(_icc_value * 100, 1)
    _icc_desc = _icc_label(_icc_value)
    _interp_parts.append(
        f"ICC = {_icc_value:.3f} ({_icc_pct:.1f}% of variance is between-groups; "
        f"{_icc_desc} clustering effect)"
    )

_sig_fixed = [
    fe for fe in _fixed_effects
    if fe["term"] != "Intercept" and fe["p_value"] < _alpha
]
if _model_type != "null" and _fixed_preds_model:
    _n_preds = len(_fixed_preds_model)
    _interp_parts.append(
        f"{len(_sig_fixed)} of {_n_preds} fixed effect(s) "
        f"(excl. intercept) significant at alpha = {_alpha:.2f}"
    )

if _lrt_result is not None:
    _sig_word = "significantly" if _lrt_result["significant"] else "did not significantly"
    _p_cmp = "<" if _lrt_result["significant"] else ">="
    _interp_parts.append(
        f"Full model {_sig_word} improved fit over null model: "
        f"chi2({_lrt_result['df']}) = {_lrt_result['chi_square']:.3f}, "
        f"p {_p_cmp} {_alpha:.4f}"
    )

if not _converged:
    _interp_parts.append(
        "WARNING: Model may not have converged. Interpret results with caution."
    )

_interpretation = (
    f"{_model_type_label} HLM: "
    + (". ".join(_interp_parts) if _interp_parts else "model fitted successfully.")
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "model_type":          _model_type,
    "model_type_label":    _model_type_label,
    "formula_str":         _formula_str,
    "n":                   _n,
    "n_groups":            _n_groups,
    "converged":           _converged,
    "icc":                 round(_icc_value, 6) if _icc_value is not None else None,
    "variance_components": _variance_components,
    "fixed_effects":       _fixed_effects,
    "random_effects":      _random_effects,
    "model_fit":           _model_fit,
    "null_model_fit":      _null_model_fit,
    "lrt_result":          _lrt_result,
    "centering":           _centering,
    "centering_summary":   _centering_summary,
    "confidence_level":    _confidence_level,
    "alpha":               _alpha,
    "interpretation":      _interpretation,
}
