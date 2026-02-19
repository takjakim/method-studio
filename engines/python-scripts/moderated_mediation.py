"""
Moderated Mediation Script
==========================
Performs moderated mediation analysis (PROCESS Model 7 / 14 / dual-stage style).

Model 1 (PROCESS Model 7):  W moderates the X -> M (a-path) — first-stage moderation.
Model 2 (PROCESS Model 14): W moderates the M -> Y (b-path) — second-stage moderation.
Model 3 (dual-stage):       W moderates BOTH the X -> M path AND the M -> Y path.

Expected namespace variables (injected by engine):

  independentVar : str | list[str]   Column name of the predictor (X).
  mediatorVar    : str | list[str]   Column name of the mediator (M).
  dependentVar   : str | list[str]   Column name of the outcome (Y).
  moderatorVar   : str | list[str]   Column name of the moderator (W).
  covariates     : list[str]         (optional) Covariate column names.
  data           : dict              Columnar data dictionary: {col_name: [values...]}.

  Flattened option variables (each injected as its own namespace variable):
    model       : int | str   1 = first-stage, 2 = second-stage, 3 = both stages.
                               Default 1.
    bootstrap   : bool        Use bootstrapping for indirect CIs (default True).
    nBoot       : int         Number of bootstrap samples (default 5000).
    ciLevel     : float       CI width, e.g. 0.95 (default 0.95).
    centering   : str         "mean" | "none" (default "mean").
    probeValues : str         "meanSD" | "percentile" (default "meanSD").
    standardize : bool        Standardise variables before analysis (default False).

Result structure
----------------
{
  "n": int,
  "model_type": "1" | "2" | "3",
  "predictor": str,
  "mediator": str,
  "moderator": str,
  "outcome": str,
  "covariates": [str] | null,
  "centering_applied": bool,
  "path_a_model": {
    "formula": str,
    "coefficients": {
      "intercept":   {"coef": float, "se": float, "t": float, "p": float},
      "predictor":   {"coef": float, "se": float, "t": float, "p": float},
      "moderator":   {"coef": float, "se": float, "t": float, "p": float},
      "interaction": {"coef": float, "se": float, "t": float, "p": float} | null
    },
    "r_squared": float,
    "adj_r_squared": float
  },
  "path_b_model": {
    "formula": str,
    "coefficients": {
      "intercept":   {"coef": float, ...},
      "predictor":   {"coef": float, ...},
      "mediator":    {"coef": float, ...},
      "moderator":   {"coef": float, ...},
      "interaction": {"coef": float, ...} | null
    },
    "r_squared": float,
    "adj_r_squared": float
  },
  "conditional_indirect": {
    "low":  {"w_value": float, "w_label": str, "effect": float, "boot_se": float|null,
             "ci_lower": float|null, "ci_upper": float|null, "significant": bool|null},
    "mean": {...},
    "high": {...}
  },
  "index_of_moderated_mediation": {
    "effect": float, "boot_se": float|null,
    "ci_lower": float|null, "ci_upper": float|null, "significant": bool|null
  },
  "direct": {"effect": float, "se": float, "t": float, "p": float},
  "model_summary": {
    "r_squared_a": float, "adj_r_squared_a": float,
    "r_squared_b": float, "adj_r_squared_b": float
  },
  "ci_level": float,
  "n_boot": int | null,
  "interpretation": str
}
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data = data if "data" in dir() else {}  # noqa: F821

# Require the four main variable name slots
if "independentVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'independentVar' is required")
if "mediatorVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'mediatorVar' is required")
if "dependentVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'dependentVar' is required")
if "moderatorVar" not in dir():  # noqa: F821
    raise ValueError("Variable 'moderatorVar' is required")

_x_raw  = independentVar  # noqa: F821
_m_raw  = mediatorVar     # noqa: F821
_y_raw  = dependentVar    # noqa: F821
_w_raw  = moderatorVar    # noqa: F821

def _scalar_name(v) -> str:
    if isinstance(v, (list, tuple)):
        return str(v[0])
    return str(v)

pred_name    = _scalar_name(_x_raw)
med_name     = _scalar_name(_m_raw)
outcome_name = _scalar_name(_y_raw)
mod_name     = _scalar_name(_w_raw)

for _nm in [pred_name, med_name, outcome_name, mod_name]:
    if _nm not in _data:
        raise ValueError(f"Column '{_nm}' not found in data")

# Optional covariates
cov_names: list[str] = []
if "covariates" in dir() and covariates is not None:  # noqa: F821
    _cov_raw = covariates  # noqa: F821
    if isinstance(_cov_raw, (list, tuple)):
        cov_names = [str(c) for c in _cov_raw if str(c)]
    elif isinstance(_cov_raw, str) and _cov_raw:
        cov_names = [_cov_raw]
    for _cn in cov_names:
        if _cn not in _data:
            raise ValueError(f"Covariate column '{_cn}' not found in data")

# ---------------------------------------------------------------------------
# Resolve flattened option variables
# ---------------------------------------------------------------------------

_model_type   = "1"    # 1 = first-stage, 2 = second-stage, 3 = both
_do_bootstrap = True
_n_boot       = 5000
_ci_level     = 0.95
_centering    = "mean"
_probe_opt    = "meanSD"
_do_std       = False

# model
if "model" in dir():  # noqa: F821
    _mv = model  # noqa: F821
    if _mv is not None:
        _model_type = str(_mv[0] if isinstance(_mv, (list, tuple)) else _mv)
        if _model_type not in ("1", "2", "3"):
            _model_type = "1"
else:
    _dv = _data.get("model")
    if _dv is not None:
        _raw = _dv[0] if isinstance(_dv, (list, tuple)) else _dv
        _model_type = str(_raw) if str(_raw) in ("1", "2", "3") else "1"

# bootstrap
if "bootstrap" in dir() and bootstrap is not None:  # noqa: F821
    _do_bootstrap = bool(bootstrap)  # noqa: F821
else:
    _dv = _data.get("bootstrap")
    if _dv is not None:
        _do_bootstrap = bool(_dv[0] if isinstance(_dv, (list, tuple)) else _dv)

# nBoot
if "nBoot" in dir() and nBoot is not None:  # noqa: F821
    _n_boot = max(100, int(nBoot))  # noqa: F821
else:
    _dv = _data.get("nBoot")
    if _dv is not None:
        _n_boot = max(100, int(_dv[0] if isinstance(_dv, (list, tuple)) else _dv))

# ciLevel
if "ciLevel" in dir() and ciLevel is not None:  # noqa: F821
    _ci_raw = float(ciLevel)  # noqa: F821
    if 0 < _ci_raw < 1:
        _ci_level = _ci_raw
else:
    _dv = _data.get("ciLevel")
    if _dv is not None:
        _ci_raw = float(_dv[0] if isinstance(_dv, (list, tuple)) else _dv)
        if 0 < _ci_raw < 1:
            _ci_level = _ci_raw

# centering
if "centering" in dir() and centering is not None:  # noqa: F821
    _centering = str(centering)  # noqa: F821
else:
    _dv = _data.get("centering")
    if _dv is not None:
        _centering = str(_dv[0] if isinstance(_dv, (list, tuple)) else _dv)

# probeValues
if "probeValues" in dir() and probeValues is not None:  # noqa: F821
    _probe_opt = str(probeValues)  # noqa: F821
else:
    _dv = _data.get("probeValues")
    if _dv is not None:
        _probe_opt = str(_dv[0] if isinstance(_dv, (list, tuple)) else _dv)

# standardize
if "standardize" in dir() and standardize is not None:  # noqa: F821
    _do_std = bool(standardize)  # noqa: F821
else:
    _dv = _data.get("standardize")
    if _dv is not None:
        _do_std = bool(_dv[0] if isinstance(_dv, (list, tuple)) else _dv)

# ---------------------------------------------------------------------------
# Build clean DataFrame
# ---------------------------------------------------------------------------

_all_cols = list(dict.fromkeys([pred_name, med_name, mod_name, outcome_name] + cov_names))
_frame_raw: dict[str, np.ndarray] = {}
for _col in _all_cols:
    _frame_raw[_col] = np.array(_data[_col], dtype=float)

df = pd.DataFrame(_frame_raw).dropna()
n = len(df)

_n_min = len(_all_cols) + 3
if n < _n_min:
    raise ValueError(
        f"Insufficient complete observations (n={n}) for moderated mediation. "
        f"Need at least {_n_min} complete cases."
    )

# ---------------------------------------------------------------------------
# Standardize if requested
# ---------------------------------------------------------------------------

if _do_std:
    for _col in _all_cols:
        _mu_s = df[_col].mean()
        _sd_s = df[_col].std(ddof=1)
        if _sd_s > 0:
            df[_col] = (df[_col] - _mu_s) / _sd_s

# ---------------------------------------------------------------------------
# Mean centering (X and W)
# ---------------------------------------------------------------------------

_centering_applied = False
if _centering.lower() == "mean":
    _centering_applied = True
    df[pred_name] = df[pred_name] - df[pred_name].mean()
    df[mod_name]  = df[mod_name]  - df[mod_name].mean()

# ---------------------------------------------------------------------------
# Interaction columns
# ---------------------------------------------------------------------------

xw_name = f"{pred_name}_x_{mod_name}"    # X*W — a-path interaction (models 1 & 3)
mw_name = f"{med_name}_x_{mod_name}"     # M*W — b-path interaction (models 2 & 3)
df[xw_name] = df[pred_name] * df[mod_name]
df[mw_name] = df[med_name]  * df[mod_name]

# ---------------------------------------------------------------------------
# Helper: extract coef dict from statsmodels result using named index
# ---------------------------------------------------------------------------

def _extract_coef(fit_result, term: str) -> dict:
    params = fit_result.params
    bse    = fit_result.bse
    tvals  = fit_result.tvalues
    pvals  = fit_result.pvalues
    if term not in params.index:
        return {"coef": None, "se": None, "t": None, "p": None}
    return {
        "coef": round(float(params[term]), 6),
        "se":   round(float(bse[term]),    6),
        "t":    round(float(tvals[term]),  6),
        "p":    round(float(pvals[term]),  8),
    }


# ---------------------------------------------------------------------------
# Determine which paths carry the interaction based on model_type
#
#   model 1 (first-stage):  a-path has X*W interaction; b-path does NOT
#   model 2 (second-stage): a-path does NOT;             b-path has M*W
#   model 3 (both stages):  a-path has X*W;              b-path has M*W
# ---------------------------------------------------------------------------

_a_has_xw = _model_type in ("1", "3")   # interaction on a-path
_b_has_mw = _model_type in ("2", "3")   # interaction on b-path

# ---------------------------------------------------------------------------
# Path A model: M ~ X + W [+ X*W] (+ covs)
# ---------------------------------------------------------------------------

if _a_has_xw:
    _a_terms = [pred_name, mod_name, xw_name] + cov_names
else:
    _a_terms = [pred_name, mod_name] + cov_names

_Xa = sm.add_constant(df[_a_terms], has_constant="add")
_ya = df[med_name].values
_fit_a = sm.OLS(_ya, _Xa).fit()
_a_formula = f"{med_name} ~ const + {' + '.join(_a_terms)}"

path_a_coefs = {
    "intercept":   _extract_coef(_fit_a, "const"),
    "predictor":   _extract_coef(_fit_a, pred_name),
    "moderator":   _extract_coef(_fit_a, mod_name),
    "interaction": _extract_coef(_fit_a, xw_name) if _a_has_xw else None,
}
r2_a     = float(_fit_a.rsquared)
adj_r2_a = float(_fit_a.rsquared_adj)

# ---------------------------------------------------------------------------
# Path B model: Y ~ X + M + W [+ M*W] (+ covs)
# ---------------------------------------------------------------------------

if _b_has_mw:
    _b_terms = [pred_name, med_name, mod_name, mw_name] + cov_names
else:
    _b_terms = [pred_name, med_name, mod_name] + cov_names

_Xb = sm.add_constant(df[_b_terms], has_constant="add")
_yb = df[outcome_name].values
_fit_b = sm.OLS(_yb, _Xb).fit()
_b_formula = f"{outcome_name} ~ const + {' + '.join(_b_terms)}"

path_b_coefs = {
    "intercept":   _extract_coef(_fit_b, "const"),
    "predictor":   _extract_coef(_fit_b, pred_name),
    "mediator":    _extract_coef(_fit_b, med_name),
    "moderator":   _extract_coef(_fit_b, mod_name),
    "interaction": _extract_coef(_fit_b, mw_name) if _b_has_mw else None,
}
r2_b     = float(_fit_b.rsquared)
adj_r2_b = float(_fit_b.rsquared_adj)

# ---------------------------------------------------------------------------
# Direct effect: coefficient of X in path B model
# ---------------------------------------------------------------------------

_direct_coef = _extract_coef(_fit_b, pred_name)

# ---------------------------------------------------------------------------
# Key scalar coefficients for computing conditional indirect effects
#
#   a(W) = b_x_a + b_xw * W   (b_xw = 0 when no a-path interaction)
#   b(W) = b_m_b + b_mw * W   (b_mw = 0 when no b-path interaction)
#   indirect(W) = a(W) * b(W)
# ---------------------------------------------------------------------------

_b_x_in_a = float(_fit_a.params[pred_name])
_b_xw     = float(_fit_a.params[xw_name]) if _a_has_xw else 0.0
_b_m_in_b = float(_fit_b.params[med_name])
_b_mw     = float(_fit_b.params[mw_name]) if _b_has_mw else 0.0

# ---------------------------------------------------------------------------
# Probe values for W
# ---------------------------------------------------------------------------

if _probe_opt.lower() == "percentile":
    _w_vals = np.percentile(df[mod_name].values, [16, 50, 84])
else:
    _w_mu  = float(df[mod_name].mean())
    _w_sd  = float(df[mod_name].std(ddof=1))
    _w_vals = np.array([_w_mu - _w_sd, _w_mu, _w_mu + _w_sd])

_probe_labels = ["low", "mean", "high"]
_alpha_tail   = (1.0 - _ci_level) / 2.0


def _cond_indirect(w_val: float) -> float:
    """Point estimate of the indirect effect at a given W value."""
    a_w = _b_x_in_a + _b_xw * w_val
    b_w = _b_m_in_b + _b_mw * w_val
    return float(a_w * b_w)


# ---------------------------------------------------------------------------
# Bootstrap helper — handles cond (conditional indirect) and imm (index)
# ---------------------------------------------------------------------------

def _bootstrap(w_val: float | None, mode: str, rng_seed: int) -> dict:
    """
    Bootstrap CI for:
      mode='cond' — conditional indirect effect at w_val
      mode='imm'  — index of moderated mediation

    Returns {"boot_se": float|None, "ci_lower": float|None, "ci_upper": float|None}
    """
    if not _do_bootstrap:
        return {"boot_se": None, "ci_lower": None, "ci_upper": None}

    rng      = np.random.default_rng(rng_seed)
    _n_obs   = len(df)
    _df_arr  = df.values                   # shape (n, ncols); columns = df.columns
    _cols    = list(df.columns)

    _pred_i  = _cols.index(pred_name)
    _med_i   = _cols.index(med_name)
    _mod_i   = _cols.index(mod_name)
    _out_i   = _cols.index(outcome_name)
    _xw_i    = _cols.index(xw_name)
    _mw_i    = _cols.index(mw_name)

    # Column indices for path A and B (excluding const)
    _a_feat_i = [_cols.index(c) for c in _a_terms]
    _b_feat_i = [_cols.index(c) for c in _b_terms]

    boot_samples = np.full(_n_boot, np.nan)

    for _bi in range(_n_boot):
        _idx = rng.integers(0, _n_obs, size=_n_obs)
        _d   = _df_arr[_idx].copy()

        # Recompute interaction columns on bootstrap sample
        _d[:, _xw_i] = _d[:, _pred_i] * _d[:, _mod_i]
        _d[:, _mw_i] = _d[:, _med_i]  * _d[:, _mod_i]

        try:
            # Path A
            _Xa_b = np.column_stack([np.ones(_n_obs), _d[:, _a_feat_i]])
            _ya_b = _d[:, _med_i]
            _pa   = np.linalg.lstsq(_Xa_b, _ya_b, rcond=None)[0]
            # param order: const, then _a_terms
            _bxa  = float(_pa[_a_terms.index(pred_name) + 1])
            _bxwa = float(_pa[_a_terms.index(xw_name) + 1]) if _a_has_xw else 0.0

            # Path B
            _Xb_b = np.column_stack([np.ones(_n_obs), _d[:, _b_feat_i]])
            _yb_b = _d[:, _out_i]
            _pb   = np.linalg.lstsq(_Xb_b, _yb_b, rcond=None)[0]
            _bmb  = float(_pb[_b_terms.index(med_name) + 1])
            _bmwb = float(_pb[_b_terms.index(mw_name) + 1]) if _b_has_mw else 0.0

            if mode == "imm":
                # For model 1: IMM = b_xw * b_m
                # For model 2: IMM = b_x_a * b_mw
                # For model 3: IMM depends on W — not a single index; use mean W
                if _model_type == "1":
                    boot_samples[_bi] = _bxwa * _bmb
                elif _model_type == "2":
                    boot_samples[_bi] = _bxa  * _bmwb
                else:
                    # Both paths moderated: the "index" is the product of both
                    # interaction coefficients (b_xw * b_mw)
                    boot_samples[_bi] = _bxwa * _bmwb
            else:  # cond
                _a_w = _bxa  + _bxwa * w_val
                _b_w = _bmb  + _bmwb * w_val
                boot_samples[_bi] = _a_w * _b_w

        except Exception:
            pass  # leave as nan

    _valid = boot_samples[np.isfinite(boot_samples)]
    if len(_valid) < 10:
        return {"boot_se": None, "ci_lower": None, "ci_upper": None}

    return {
        "boot_se":  round(float(np.std(_valid, ddof=1)), 6),
        "ci_lower": round(float(np.percentile(_valid, _alpha_tail * 100)), 6),
        "ci_upper": round(float(np.percentile(_valid, (1.0 - _alpha_tail) * 100)), 6),
    }


# ---------------------------------------------------------------------------
# Conditional indirect effects at each probe value of W
# ---------------------------------------------------------------------------

_cond_indirect_out: dict[str, dict] = {}
for _i, _label in enumerate(_probe_labels):
    _w_val  = float(_w_vals[_i])
    _ie_est = _cond_indirect(_w_val)
    _ci_info = _bootstrap(_w_val, mode="cond", rng_seed=20240100 + _i + 1)

    _sig: bool | None
    if _ci_info["ci_lower"] is not None and _ci_info["ci_upper"] is not None:
        _sig = not (_ci_info["ci_lower"] <= 0 <= _ci_info["ci_upper"])
    else:
        _sig = None

    _cond_indirect_out[_label] = {
        "w_value":     round(_w_val, 6),
        "w_label":     _label,
        "effect":      round(_ie_est, 6),
        "boot_se":     _ci_info["boot_se"],
        "ci_lower":    _ci_info["ci_lower"],
        "ci_upper":    _ci_info["ci_upper"],
        "significant": _sig,
    }

# ---------------------------------------------------------------------------
# Index of Moderated Mediation (IMM)
#
#   model 1: IMM = b_xw * b_m          (linear in b_m)
#   model 2: IMM = b_x_a * b_mw        (linear in b_mw)
#   model 3: IMM = b_xw * b_mw         (product of both interaction coefs)
#            — represents how the indirect effect changes per unit of W^2
#            (the "second-order" or dual interaction index)
# ---------------------------------------------------------------------------

if _model_type == "1":
    _imm_est = _b_xw * _b_m_in_b
elif _model_type == "2":
    _imm_est = _b_x_in_a * _b_mw
else:  # model 3
    _imm_est = _b_xw * _b_mw

_imm_ci = _bootstrap(None, mode="imm", rng_seed=20240110)

_imm_sig: bool | None
if _imm_ci["ci_lower"] is not None and _imm_ci["ci_upper"] is not None:
    _imm_sig = not (_imm_ci["ci_lower"] <= 0 <= _imm_ci["ci_upper"])
else:
    _imm_sig = None

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_ci_pct     = _ci_level * 100
_method_str = f"bias-corrected bootstrap (B = {_n_boot})" if _do_bootstrap else "no bootstrap"

_model_labels = {
    "1": f"Model 1 — first-stage moderation ({mod_name} moderates {pred_name} -> {med_name})",
    "2": f"Model 2 — second-stage moderation ({mod_name} moderates {med_name} -> {outcome_name})",
    "3": f"Model 3 — dual-stage moderation ({mod_name} moderates both paths)",
}
_model_label = _model_labels[_model_type]

_sig_w_labels = [
    _lbl for _lbl in _probe_labels
    if _cond_indirect_out[_lbl]["significant"] is True
]

_interp_parts = [
    (f"Moderated mediation analysis ({_model_label}) tested whether the indirect effect "
     f"of '{pred_name}' on '{outcome_name}' through '{med_name}' was moderated by '{mod_name}'."),
    (f"N = {n} complete cases. Conditional indirect effects estimated via {_method_str} "
     f"at {_ci_pct:.0f}% CI."),
]

if len(_sig_w_labels) == 0:
    _interp_parts.append("None of the conditional indirect effects were significant.")
else:
    _interp_parts.append(
        f"Significant conditional indirect effects at {len(_sig_w_labels)} "
        f"W value(s): {', '.join(_sig_w_labels)}."
    )

if _imm_sig is not None:
    _imm_lo_str = f"{_imm_ci['ci_lower']:.4f}" if _imm_ci["ci_lower"] is not None else "NA"
    _imm_hi_str = f"{_imm_ci['ci_upper']:.4f}" if _imm_ci["ci_upper"] is not None else "NA"
    _interp_parts.append(
        f"Index of moderated mediation = {_imm_est:.4f}; "
        f"{_ci_pct:.0f}% CI [{_imm_lo_str}, {_imm_hi_str}]; "
        f"{'significant' if _imm_sig else 'not significant'}."
    )

_interpretation = " ".join(_interp_parts)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n":                 n,
    "model_type":        _model_type,
    "predictor":         pred_name,
    "mediator":          med_name,
    "moderator":         mod_name,
    "outcome":           outcome_name,
    "covariates":        cov_names if cov_names else None,
    "centering_applied": _centering_applied,
    "path_a_model": {
        "formula":       _a_formula,
        "coefficients":  path_a_coefs,
        "r_squared":     round(r2_a, 6),
        "adj_r_squared": round(adj_r2_a, 6),
    },
    "path_b_model": {
        "formula":       _b_formula,
        "coefficients":  path_b_coefs,
        "r_squared":     round(r2_b, 6),
        "adj_r_squared": round(adj_r2_b, 6),
    },
    "conditional_indirect": _cond_indirect_out,
    "index_of_moderated_mediation": {
        "effect":      round(float(_imm_est), 6),
        "boot_se":     _imm_ci["boot_se"],
        "ci_lower":    _imm_ci["ci_lower"],
        "ci_upper":    _imm_ci["ci_upper"],
        "significant": _imm_sig,
    },
    "direct": {
        "effect": _direct_coef["coef"],
        "se":     _direct_coef["se"],
        "t":      _direct_coef["t"],
        "p":      _direct_coef["p"],
    },
    "model_summary": {
        "r_squared_a":     round(r2_a, 6),
        "adj_r_squared_a": round(adj_r2_a, 6),
        "r_squared_b":     round(r2_b, 6),
        "adj_r_squared_b": round(adj_r2_b, 6),
    },
    "ci_level":      _ci_level,
    "n_boot":        _n_boot if _do_bootstrap else None,
    "interpretation": _interpretation,
}
