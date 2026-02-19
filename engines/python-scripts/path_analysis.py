"""
Path Analysis Script
====================
Expects the following variables in the execution namespace (injected by the engine):

  data : list[dict] | dict[str, list] | pd.DataFrame
      The dataset to analyse.

  model : str | None
      lavaan/semopy-style model syntax string, e.g.:
        "y ~ x1 + x2\\nx2 ~ x1"
      If None or empty, supply structured input below.

  Structured input (used when `model` is absent):
    paths : list[dict]
        Each dict must have "from" and "to" keys (variable names).
    endogenous : list[str]  (optional, helps identify variable types)
    exogenous  : list[str]  (optional)

  estimator : str
      One of "ML" | "MLR" | "GLS" | "WLS". Default: "ML".

  standardized : bool
      Return standardized path coefficients. Default: True.

  bootstrap : bool
      Use bootstrap for indirect effect CIs. Default: False.

  nBoot : int
      Number of bootstrap samples. Default: 1000.

  ciLevel : float
      Confidence interval level. Default: 0.95.

  missingValues : str
      "exclude-listwise" | "fiml". Default: "exclude-listwise".

Result structure
----------------
{
  "n": int,
  "model_syntax": str,
  "estimator": str,
  "endogenous_vars": list[str],
  "exogenous_vars": list[str],
  "path_coefficients": [
    {
      "from": str,
      "to": str,
      "estimate": float,
      "se": float,
      "z": float,
      "p_value": float,
      "ci_lower": float,
      "ci_upper": float,
      "std_estimate": float  # if standardized=True
    },
    ...
  ],
  "indirect_effects": [
    {
      "from": str,
      "through": str,
      "to": str,
      "a_coef": float,
      "b_coef": float,
      "estimate": float,
      "std_estimate": float | null,
      "boot_se": float | null,
      "ci_lower": float | null,
      "ci_upper": float | null,
      "significant": bool | null
    },
    ...
  ] | null,
  "total_effects": [
    {
      "from": str,
      "to": str,
      "direct": float,
      "indirect": float | null,
      "total": float,
      "std_direct": float | null,
      "std_indirect": float | null,
      "std_total": float | null
    },
    ...
  ] | null,
  "fit_indices": {
    "chi_square": float,
    "df": int,
    "p_value": float,
    "cfi": float,
    "tli": float,
    "rmsea": float,
    "rmsea_ci_lower": float | null,
    "rmsea_ci_upper": float | null,
    "srmr": float | null,
    "aic": float,
    "bic": float,
    "fit_interpretation": str
  } | null,
  "r_squared": {var: float, ...} | null,
  "residual_variances": {var: {"estimate": float, "se": float | null}, ...} | null,
  "diagram": {"nodes": [...], "edges": [...]} | null,
  "standardized": bool,
  "bootstrap": bool,
  "n_boot": int | null,
  "ci_level": float,
  "interpretation": str
}
"""

from __future__ import annotations

import re
import warnings
import numpy as np
import pandas as pd
from scipy import stats as scipy_stats


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_dataframe(raw) -> pd.DataFrame:
    if isinstance(raw, pd.DataFrame):
        return raw
    if isinstance(raw, list):
        return pd.DataFrame(raw)
    if isinstance(raw, dict):
        return pd.DataFrame(raw)
    raise TypeError(f"Unsupported data type: {type(raw)}")


def _build_syntax_from_paths(paths_raw: list) -> str:
    """Convert structured paths list to lavaan/semopy model syntax."""
    path_map: dict[str, list[str]] = {}
    for p in paths_raw:
        if not isinstance(p, dict):
            continue
        from_var = str(p.get("from", "")).strip()
        to_var   = str(p.get("to",   "")).strip()
        if not from_var or not to_var:
            continue
        if to_var not in path_map:
            path_map[to_var] = []
        if from_var not in path_map[to_var]:
            path_map[to_var].append(from_var)
    if not path_map:
        raise ValueError("No valid paths found. Each path needs 'from' and 'to' fields.")
    lines = [f"{outcome} ~ {' + '.join(preds)}" for outcome, preds in path_map.items()]
    return "\n".join(lines)


def _parse_model_variables(syntax: str) -> tuple[list[str], list[str], list[str]]:
    """
    Parse model syntax to identify endogenous and exogenous variables.
    Returns (endogenous, exogenous, all_vars).
    """
    endogenous: list[str] = []
    all_vars:   list[str] = []

    for line in syntax.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "~" in line and "~~" not in line:
            parts = line.split("~", 1)
            lhs = parts[0].strip()
            rhs = parts[1].strip()
            # Remove label annotations (e.g., "a*x1" -> "x1")
            lhs_var = re.sub(r".*\*", "", lhs).strip()
            if lhs_var and lhs_var not in endogenous:
                endogenous.append(lhs_var)
            if lhs_var and lhs_var not in all_vars:
                all_vars.append(lhs_var)
            for term in rhs.split("+"):
                var_part = re.sub(r".*\*", "", term.strip()).strip()
                if var_part and not re.match(r"^[0-9.]+$", var_part) and var_part not in all_vars:
                    all_vars.append(var_part)

    exogenous = [v for v in all_vars if v not in endogenous]
    return endogenous, exogenous, all_vars


def _run_semopy(
    df: pd.DataFrame,
    model_syntax: str,
    estimator: str,
    do_std: bool,
    ci_level: float,
    do_bootstrap: bool,
    n_boot: int,
) -> dict:
    """Fit path model using semopy. Returns params DataFrame and fit stats."""
    import semopy

    mod = semopy.Model(model_syntax)
    try:
        mod.fit(df, solver="SLSQP")
    except Exception as e:
        raise RuntimeError(f"semopy path model fitting failed: {e}") from e

    try:
        params = mod.inspect(std_est=do_std)
    except Exception:
        params = mod.inspect()

    # Fit indices
    fit_dict = {}
    try:
        stats = semopy.calc_stats(mod)

        def _get(name):
            try:
                v = stats.loc[name, "Value"]
                return float(v) if not pd.isna(v) else None
            except (KeyError, TypeError):
                return None

        df_val = _get("df")
        fit_dict = {
            "chi_square":     _get("chi2"),
            "df":             int(df_val) if df_val is not None else None,
            "p_value":        _get("chi2 p-value"),
            "cfi":            _get("CFI"),
            "tli":            _get("TLI"),
            "rmsea":          _get("RMSEA"),
            "rmsea_ci_lower": None,
            "rmsea_ci_upper": None,
            "srmr":           _get("SRMR"),
            "aic":            _get("AIC"),
            "bic":            _get("BIC"),
        }
    except Exception:
        fit_dict = {}

    # R-squared
    r2_dict = {}
    try:
        r2_raw = semopy.calc_stats(mod)  # some versions include R2
        # Extract from params: endogenous var residuals
        # We'll compute r2 from regression params instead (done later)
    except Exception:
        pass

    return {"params": params, "fit_indices": fit_dict, "model": mod}


def _run_ols_fallback(
    df: pd.DataFrame,
    endo_vars: list[str],
    exo_vars: list[str],
    all_vars: list[str],
    model_syntax: str,
    do_std: bool,
    ci_level: float,
) -> dict:
    """
    Fallback: fit each endogenous variable via OLS (ignores cross-equation constraints).
    Returns same shape as _run_semopy output.
    """
    import statsmodels.api as sm

    # Parse which predictors go to each outcome
    path_map: dict[str, list[str]] = {}
    for line in model_syntax.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "~" in line and "~~" not in line:
            parts = line.split("~", 1)
            outcome = re.sub(r".*\*", "", parts[0].strip()).strip()
            preds_raw = parts[1].strip().split("+")
            preds = [re.sub(r".*\*", "", t.strip()).strip() for t in preds_raw]
            preds = [p for p in preds if p and not re.match(r"^[0-9.]+$", p)]
            path_map[outcome] = preds

    rows = []
    r2_dict: dict[str, float] = {}
    n_obs_total = len(df)

    for outcome, preds in path_map.items():
        if not preds:
            continue
        _cols = [outcome] + preds
        _df_sub = df[_cols].dropna()
        if len(_df_sub) < len(preds) + 2:
            continue

        Y = _df_sub[outcome].values
        X_raw = _df_sub[preds].values
        X = sm.add_constant(X_raw, has_constant="add")
        fit = sm.OLS(Y, X).fit()

        r2_dict[outcome] = float(fit.rsquared)

        z_crit = scipy_stats.norm.ppf(1 - (1 - ci_level) / 2)
        ci_arr = fit.conf_int(alpha=(1 - ci_level))

        # Standardized: use beta coefficients
        if do_std:
            std_Y = np.std(Y, ddof=1)
            std_X = np.std(X_raw, axis=0, ddof=1)

        for i, pred in enumerate(preds):
            param_idx = i + 1  # +1 for const
            est = float(fit.params[param_idx])
            se  = float(fit.bse[param_idx])
            z   = float(fit.tvalues[param_idx])
            pv  = float(fit.pvalues[param_idx])
            row = {
                "lval": outcome,
                "op":   "~",
                "rval": pred,
                "Estimate": est,
                "Std. Err": se,
                "z-value":  z,
                "p-value":  pv,
                "ci_lower": float(ci_arr[param_idx, 0]),
                "ci_upper": float(ci_arr[param_idx, 1]),
            }
            if do_std and std_Y > 0 and std_X[i] > 0:
                row["std_estimate"] = est * std_X[i] / std_Y
            rows.append(row)

        # Residual variance
        resid_var = float(np.var(fit.resid, ddof=1))
        rows.append({
            "lval": outcome,
            "op":   "~~",
            "rval": outcome,
            "Estimate": resid_var,
            "Std. Err": None,
            "z-value":  None,
            "p-value":  None,
        })

    # Exogenous variable variances
    for exo in exo_vars:
        if exo in df.columns:
            rows.append({
                "lval": exo,
                "op":   "~~",
                "rval": exo,
                "Estimate": float(df[exo].var(ddof=1)),
                "Std. Err": None,
                "z-value":  None,
                "p-value":  None,
            })

    params = pd.DataFrame(rows) if rows else pd.DataFrame(columns=["lval", "op", "rval", "Estimate"])

    # Approximate fit indices for just-identified / over-identified models
    # For OLS fallback we report saturated fit if all paths go to different outcomes
    n_paths = sum(len(preds) for preds in path_map.values())
    n_vars_total = len(all_vars)
    n_obs_used = len(df.dropna(subset=all_vars))
    # Cannot compute proper chi2 without full SEM; return None
    fit_dict: dict = {}

    return {"params": params, "fit_indices": fit_dict, "model": None, "r_squared": r2_dict}


# ---------------------------------------------------------------------------
# Bootstrap indirect effects
# ---------------------------------------------------------------------------

def _bootstrap_indirect(
    df: pd.DataFrame,
    model_syntax: str,
    endo_vars: list[str],
    exo_vars: list[str],
    indirect_pairs: list[tuple[str, str, str]],  # (from, through, to)
    n_boot: int,
    ci_level: float,
) -> dict[tuple, dict]:
    """Compute bootstrap CIs for indirect effects using OLS."""
    import statsmodels.api as sm

    def _fit_paths(df_b: pd.DataFrame) -> dict[tuple, float]:
        coefs: dict[tuple, float] = {}
        _, _, all_vars = _parse_model_variables(model_syntax)
        path_map: dict[str, list[str]] = {}
        for line in model_syntax.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "~" in line and "~~" not in line:
                parts = line.split("~", 1)
                outcome = re.sub(r".*\*", "", parts[0]).strip()
                preds_raw = parts[1].strip().split("+")
                preds = [re.sub(r".*\*", "", t.strip()).strip() for t in preds_raw
                         if not re.match(r"^[0-9.]+$", re.sub(r".*\*", "", t.strip()).strip())]
                path_map[outcome] = preds

        for outcome, preds in path_map.items():
            if not preds:
                continue
            _cols = [outcome] + preds
            _df_s = df_b[_cols].dropna()
            if len(_df_s) < len(preds) + 2:
                continue
            Y = _df_s[outcome].values
            X = sm.add_constant(_df_s[preds].values, has_constant="add")
            try:
                fit = sm.OLS(Y, X).fit()
                for i, pred in enumerate(preds):
                    coefs[(outcome, pred)] = float(fit.params[i + 1])
            except Exception:
                pass
        return coefs

    boot_results: dict[tuple, list[float]] = {pair: [] for pair in indirect_pairs}

    np.random.seed(20240201)
    for _ in range(n_boot):
        idx = np.random.choice(len(df), size=len(df), replace=True)
        df_b = df.iloc[idx].reset_index(drop=True)
        try:
            coefs = _fit_paths(df_b)
        except Exception:
            continue
        for from_var, through, to_var in indirect_pairs:
            a = coefs.get((through, from_var), None)
            b = coefs.get((to_var, through), None)
            if a is not None and b is not None:
                boot_results[(from_var, through, to_var)].append(a * b)

    ci_result: dict[tuple, dict] = {}
    alpha_tail = (1 - ci_level) / 2
    for pair, samples in boot_results.items():
        valid = [s for s in samples if np.isfinite(s)]
        if len(valid) >= 10:
            ci_result[pair] = {
                "boot_se":    float(np.std(valid, ddof=1)),
                "ci_lower":   float(np.percentile(valid, alpha_tail * 100)),
                "ci_upper":   float(np.percentile(valid, (1 - alpha_tail) * 100)),
                "significant": not (
                    np.percentile(valid, alpha_tail * 100) <= 0 <=
                    np.percentile(valid, (1 - alpha_tail) * 100)
                ),
            }
        else:
            ci_result[pair] = {}

    return ci_result


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

_data_raw = data if "data" in dir() else {}  # noqa: F821

# model syntax
try:
    _model_raw = model  # noqa: F821
    if isinstance(_model_raw, str):
        _model_syntax_input = _model_raw.strip()
    elif isinstance(_model_raw, list) and _model_raw:
        _model_syntax_input = str(_model_raw[0]).strip()
    else:
        _model_syntax_input = ""
except NameError:
    _model_syntax_input = ""

# paths (structured)
try:
    _paths_raw = paths  # noqa: F821
    _has_paths = bool(_paths_raw)
except NameError:
    _paths_raw = []
    _has_paths = False

if not _model_syntax_input and not _has_paths:
    raise ValueError(
        "Either 'model' (syntax string) or 'paths' (structured path list) must be provided."
    )

# Build model syntax
if _model_syntax_input:
    _model_syntax = _model_syntax_input
else:
    _model_syntax = _build_syntax_from_paths(_paths_raw)

# estimator
try:
    _estimator = str(estimator).upper()  # noqa: F821
except NameError:
    _estimator = "ML"
_valid_estimators = {"ML", "MLR", "GLS", "WLS", "MLM", "WLSMV"}
if _estimator not in _valid_estimators:
    _estimator = "ML"

# standardized
try:
    _do_std = bool(standardized)  # noqa: F821
except NameError:
    _do_std = True

# bootstrap
try:
    _do_bootstrap = bool(bootstrap)  # noqa: F821
except NameError:
    _do_bootstrap = False

# nBoot
try:
    _n_boot = max(100, int(nBoot))  # noqa: F821
except NameError:
    _n_boot = 1000

# ciLevel
try:
    _ci_level = float(ciLevel)  # noqa: F821
    if not (0 < _ci_level < 1):
        _ci_level = 0.95
except NameError:
    _ci_level = 0.95

# missingValues
try:
    _missing = str(missingValues).lower()  # noqa: F821
except NameError:
    _missing = "exclude-listwise"

# ---------------------------------------------------------------------------
# Parse variables and build dataframe
# ---------------------------------------------------------------------------

_endo_vars, _exo_vars, _all_vars = _parse_model_variables(_model_syntax)

if not _all_vars:
    raise ValueError("Could not identify any variables from the model syntax. Check the syntax format.")

df = _to_dataframe(_data_raw)

_missing_cols = [v for v in _all_vars if v not in df.columns]
if _missing_cols:
    raise ValueError(f"Variable(s) not found in data columns: {_missing_cols}")

df_sub = df[_all_vars].copy()
for _col in df_sub.columns:
    df_sub[_col] = pd.to_numeric(df_sub[_col], errors="coerce")

_n_total = len(df_sub)

if _missing == "fiml":
    df_clean = df_sub.copy()
    _n = _n_total
else:
    df_clean = df_sub.dropna()
    _n = len(df_clean)

_n_min = len(_all_vars) + 2
if _n < _n_min:
    raise ValueError(
        f"Insufficient complete observations (n={_n}) for path analysis with "
        f"{len(_all_vars)} variable(s). Need at least {_n_min} complete cases."
    )

# ---------------------------------------------------------------------------
# Fit model
# ---------------------------------------------------------------------------

_sem_result  = None
_r2_external: dict[str, float] = {}
_used_fallback = False
_fallback_note = ""

try:
    import semopy  # noqa: F401
    _sem_result = _run_semopy(
        df_clean, _model_syntax, _estimator, _do_std, _ci_level, _do_bootstrap, _n_boot
    )
    _r2_external = {}
    # Try to extract R2 from semopy
    try:
        for _ev in _endo_vars:
            _r2_val = semopy.calc_stats(_sem_result["model"])
            # No standard R2 in semopy stats; compute from residual variance
    except Exception:
        pass
except ImportError:
    _used_fallback = True
    _fallback_note = " (OLS fallback; install semopy for full SEM path analysis)"
    _sem_result = _run_ols_fallback(
        df_clean, _endo_vars, _exo_vars, _all_vars, _model_syntax, _do_std, _ci_level
    )
    _r2_external = _sem_result.get("r_squared", {})
except Exception as _e:
    raise RuntimeError(f"Path analysis fitting failed: {_e}") from _e

_params     = _sem_result["params"]
_fit_raw    = _sem_result["fit_indices"]

# Normalise column names
if "lhs" in _params.columns and "lval" not in _params.columns:
    _params = _params.rename(columns={"lhs": "lval", "rhs": "rval"})
if "Estimate" not in _params.columns and "estimate" in _params.columns:
    _params = _params.rename(columns={"estimate": "Estimate"})

# ---------------------------------------------------------------------------
# Extract path coefficients
# ---------------------------------------------------------------------------

_reg_rows = _params[_params["op"] == "~"] if "op" in _params.columns else pd.DataFrame()

_path_coefficients = []
_z_crit = scipy_stats.norm.ppf(1 - (1 - _ci_level) / 2)

for _, _row in _reg_rows.iterrows():
    _est = _row.get("Estimate", _row.get("Est", None))
    _se  = _row.get("Std. Err", _row.get("SE", None))
    _z   = _row.get("z-value",  _row.get("z",  None))
    _pv  = _row.get("p-value",  _row.get("p",  None))
    _ci_l = _row.get("ci_lower", None)
    _ci_u = _row.get("ci_upper", None)

    if _est is None or (isinstance(_est, float) and np.isnan(_est)):
        continue

    # Compute CI from SE if not directly available
    if (_ci_l is None or pd.isna(_ci_l)) and _se is not None and not pd.isna(_se):
        _ci_l = float(_est) - _z_crit * float(_se)
        _ci_u = float(_est) + _z_crit * float(_se)

    _entry = {
        "from":      str(_row.get("rval", "")),
        "to":        str(_row.get("lval", "")),
        "estimate":  round(float(_est), 4),
        "se":        round(float(_se),  4) if _se  is not None and not pd.isna(_se)  else None,
        "z":         round(float(_z),   4) if _z   is not None and not pd.isna(_z)   else None,
        "p_value":   round(float(_pv),  6) if _pv  is not None and not pd.isna(_pv)  else None,
        "ci_lower":  round(float(_ci_l), 4) if _ci_l is not None and not pd.isna(_ci_l) else None,
        "ci_upper":  round(float(_ci_u), 4) if _ci_u is not None and not pd.isna(_ci_u) else None,
    }

    # Standardised estimate
    if _do_std:
        _std_col = next((c for c in _params.columns if "std" in c.lower() and "err" not in c.lower()), None)
        if _std_col is not None:
            _sv = _row.get(_std_col, None)
            if _sv is not None and not pd.isna(_sv):
                _entry["std_estimate"] = round(float(_sv), 4)
        elif "std_estimate" in _row:
            _sv = _row["std_estimate"]
            if _sv is not None and not pd.isna(_sv):
                _entry["std_estimate"] = round(float(_sv), 4)

    _path_coefficients.append(_entry)

# ---------------------------------------------------------------------------
# Indirect effects
# ---------------------------------------------------------------------------

_indirect_effects = None

try:
    # Detect mediators: variables that appear as both predictor and outcome
    _mediators_detected: list[str] = []
    for _ev in _endo_vars:
        _preds_of_e = [
            _row["rval"] for _, _row in _reg_rows.iterrows() if _row["lval"] == _ev
        ]
        for _p in _preds_of_e:
            if _p in _endo_vars and _p not in _mediators_detected:
                _mediators_detected.append(_p)

    if _mediators_detected:
        _indirect_list = []
        _boot_pairs: list[tuple[str, str, str]] = []

        for _med in _mediators_detected:
            # X vars: predictors of mediator that are exogenous
            _x_vars = [
                _row["rval"] for _, _row in _reg_rows.iterrows()
                if _row["lval"] == _med and _row["rval"] in _exo_vars
            ]
            # Y vars: outcomes of mediator that are endogenous (not itself)
            _y_vars = [
                _row["lval"] for _, _row in _reg_rows.iterrows()
                if _row["rval"] == _med and _row["lval"] in _endo_vars and _row["lval"] != _med
            ]

            for _x_var in _x_vars:
                for _y_var in _y_vars:
                    _a_rows = _reg_rows[(_reg_rows["lval"] == _med) & (_reg_rows["rval"] == _x_var)]
                    _b_rows = _reg_rows[(_reg_rows["lval"] == _y_var) & (_reg_rows["rval"] == _med)]

                    if len(_a_rows) == 1 and len(_b_rows) == 1:
                        _a = float(_a_rows.iloc[0]["Estimate"])
                        _b = float(_b_rows.iloc[0]["Estimate"])
                        _indirect_est = _a * _b

                        _ie = {
                            "from":     _x_var,
                            "through":  _med,
                            "to":       _y_var,
                            "a_coef":   round(_a, 4),
                            "b_coef":   round(_b, 4),
                            "estimate": round(_indirect_est, 4),
                        }

                        # Standardized indirect
                        if _do_std:
                            _std_col = next(
                                (c for c in _params.columns if "std" in c.lower() and "err" not in c.lower()),
                                None
                            )
                            if _std_col is not None:
                                _a_std_rows = _a_rows.copy()
                                _b_std_rows = _b_rows.copy()
                                _a_std = _a_std_rows.iloc[0].get(_std_col, None)
                                _b_std = _b_std_rows.iloc[0].get(_std_col, None)
                                if _a_std is not None and not pd.isna(_a_std) \
                                        and _b_std is not None and not pd.isna(_b_std):
                                    _ie["std_estimate"] = round(float(_a_std) * float(_b_std), 4)

                        _boot_pairs.append((_x_var, _med, _y_var))
                        _indirect_list.append(_ie)

        # Bootstrap CIs if requested
        if _do_bootstrap and _boot_pairs:
            _boot_cis = _bootstrap_indirect(
                df_clean, _model_syntax, _endo_vars, _exo_vars, _boot_pairs, _n_boot, _ci_level
            )
            for _ie in _indirect_list:
                _pair = (_ie["from"], _ie["through"], _ie["to"])
                _bci = _boot_cis.get(_pair, {})
                _ie["boot_se"]    = round(_bci["boot_se"],  4) if _bci.get("boot_se")  is not None else None
                _ie["ci_lower"]   = round(_bci["ci_lower"], 4) if _bci.get("ci_lower") is not None else None
                _ie["ci_upper"]   = round(_bci["ci_upper"], 4) if _bci.get("ci_upper") is not None else None
                _ie["significant"] = _bci.get("significant", None)

        if _indirect_list:
            _indirect_effects = _indirect_list

except Exception as _e_ind:
    warnings.warn(f"Indirect effect computation failed: {_e_ind}")

# ---------------------------------------------------------------------------
# Total effects
# ---------------------------------------------------------------------------

_total_effects = None

try:
    _te_map: dict[str, dict] = {}
    for _pc in _path_coefficients:
        _key = f"{_pc['from']}->{_pc['to']}"
        _direct_val    = _pc["estimate"]
        _std_direct    = _pc.get("std_estimate", None)
        _indirect_sum  = 0.0
        _std_ind_sum   = 0.0
        _has_std_ind   = False

        if _indirect_effects:
            for _ie in _indirect_effects:
                if _ie["from"] == _pc["from"] and _ie["to"] == _pc["to"]:
                    _indirect_sum += _ie["estimate"]
                    if _ie.get("std_estimate") is not None:
                        _std_ind_sum += _ie["std_estimate"]
                        _has_std_ind = True

        _te_entry = {
            "from":     _pc["from"],
            "to":       _pc["to"],
            "direct":   round(_direct_val, 4),
            "indirect": round(_indirect_sum, 4) if _indirect_sum != 0 else None,
            "total":    round(_direct_val + _indirect_sum, 4),
        }
        if _do_std and _std_direct is not None:
            _te_entry["std_direct"]   = _std_direct
            _te_entry["std_indirect"] = round(_std_ind_sum, 4) if _has_std_ind else None
            _te_entry["std_total"]    = round(
                (_std_direct or 0) + (_std_ind_sum if _has_std_ind else 0), 4
            )
        _te_map[_key] = _te_entry

    # Indirect-only pairs (no direct path)
    if _indirect_effects:
        for _ie in _indirect_effects:
            _key = f"{_ie['from']}->{_ie['to']}"
            if _key not in _te_map:
                _te_entry = {
                    "from":     _ie["from"],
                    "to":       _ie["to"],
                    "direct":   0.0,
                    "indirect": round(_ie["estimate"], 4),
                    "total":    round(_ie["estimate"], 4),
                }
                if _do_std and _ie.get("std_estimate") is not None:
                    _te_entry["std_direct"]   = 0.0
                    _te_entry["std_indirect"] = round(_ie["std_estimate"], 4)
                    _te_entry["std_total"]    = round(_ie["std_estimate"], 4)
                _te_map[_key] = _te_entry
            else:
                # Accumulate if already exists
                _existing = _te_map[_key]
                _prev_ind = _existing.get("indirect") or 0.0
                _new_ind  = _prev_ind + _ie["estimate"]
                _te_map[_key]["indirect"] = round(_new_ind, 4)
                _te_map[_key]["total"]    = round(_existing["direct"] + _new_ind, 4)

    _total_effects = list(_te_map.values()) if _te_map else None

except Exception as _e_te:
    warnings.warn(f"Total effects computation failed: {_e_te}")

# ---------------------------------------------------------------------------
# Fit indices output
# ---------------------------------------------------------------------------

_fit_indices_out = None
if _fit_raw:
    _df_fit = _fit_raw.get("df")
    _chi2   = _fit_raw.get("chi_square")
    _cfi    = _fit_raw.get("cfi")
    _rmsea  = _fit_raw.get("rmsea")
    _srmr   = _fit_raw.get("srmr")

    if _df_fit is not None and _df_fit == 0:
        _fit_interp = "Model is just-identified (saturated); fit is perfect by definition."
    elif _cfi is not None or _rmsea is not None or _srmr is not None:
        _cfi_ok   = _cfi   is not None and _cfi   >= 0.95
        _rmsea_ok = _rmsea is not None and _rmsea <= 0.06
        _srmr_ok  = _srmr  is not None and _srmr  <= 0.08
        _n_ok = sum([_cfi_ok, _rmsea_ok, _srmr_ok])
        if _n_ok == 3:
            _fit_interp = "Good fit (CFI >= .95, RMSEA <= .06, SRMR <= .08)"
        elif _n_ok == 2:
            _fit_interp = "Adequate fit (2 of 3 primary indices in acceptable range)"
        elif _n_ok == 1:
            _fit_interp = "Marginal fit (only 1 of 3 primary indices in acceptable range)"
        else:
            _fit_interp = "Poor fit (none of CFI, RMSEA, SRMR in acceptable range)"
    else:
        _fit_interp = "Fit indices unavailable"

    _fit_indices_out = {
        k: (round(v, 4) if isinstance(v, float) else v)
        for k, v in _fit_raw.items()
    }
    _fit_indices_out["fit_interpretation"] = _fit_interp

# ---------------------------------------------------------------------------
# R-squared for endogenous variables
# ---------------------------------------------------------------------------

_r_squared: dict[str, float] | None = None
try:
    if _r2_external:
        _r_squared = {k: round(float(v), 4) for k, v in _r2_external.items() if v is not None}
    elif not _used_fallback and _sem_result.get("model") is not None:
        # Compute R2 from semopy inspect or manually
        _r2_dict_tmp: dict[str, float] = {}
        for _ev in _endo_vars:
            _y_vals = df_clean[_ev].values
            _y_pred_rows = _path_coefficients
            # Reconstruct predicted values from direct predictors
            _ev_preds = [pc for pc in _path_coefficients if pc["to"] == _ev]
            if _ev_preds:
                _y_pred = np.zeros(len(df_clean))
                for _pc in _ev_preds:
                    if _pc["from"] in df_clean.columns:
                        _y_pred += _pc["estimate"] * df_clean[_pc["from"]].values
                _ss_res = np.sum((_y_vals - _y_pred) ** 2)
                _ss_tot = np.sum((_y_vals - np.mean(_y_vals)) ** 2)
                _r2_dict_tmp[_ev] = round(float(1 - _ss_res / _ss_tot), 4) if _ss_tot > 0 else 0.0
        if _r2_dict_tmp:
            _r_squared = _r2_dict_tmp
except Exception:
    _r_squared = None

# ---------------------------------------------------------------------------
# Residual variances
# ---------------------------------------------------------------------------

_residual_variances: dict | None = None
try:
    _rv_rows = _params[
        (_params["op"] == "~~") &
        (_params["lval"] == _params["rval"]) &
        _params["lval"].isin(_endo_vars)
    ] if "op" in _params.columns else pd.DataFrame()

    if not _rv_rows.empty:
        _rv_dict: dict[str, dict] = {}
        for _, _row in _rv_rows.iterrows():
            _vname = str(_row["lval"])
            _est = _row.get("Estimate", None)
            _se  = _row.get("Std. Err", None)
            _pv  = _row.get("p-value", None)
            _rv_dict[_vname] = {
                "estimate": round(float(_est), 4) if _est is not None and not pd.isna(_est) else None,
                "se":       round(float(_se),  4) if _se  is not None and not pd.isna(_se)  else None,
                "p_value":  round(float(_pv),  6) if _pv  is not None and not pd.isna(_pv)  else None,
            }
        _residual_variances = _rv_dict if _rv_dict else None
except Exception:
    _residual_variances = None

# ---------------------------------------------------------------------------
# Diagram data
# ---------------------------------------------------------------------------

_diagram = None
try:
    _nodes = [
        {
            "id":    v,
            "label": v,
            "type":  "endogenous" if v in _endo_vars else "exogenous",
        }
        for v in _all_vars
    ]
    _edges = [
        {
            "from":        _pc["from"],
            "to":          _pc["to"],
            "estimate":    _pc["estimate"],
            "p_value":     _pc.get("p_value"),
            "significant": _pc.get("p_value") is not None and _pc["p_value"] < 0.05,
            **({"std_estimate": _pc["std_estimate"]} if "std_estimate" in _pc else {}),
        }
        for _pc in _path_coefficients
    ]
    _diagram = {"nodes": _nodes, "edges": _edges}
except Exception:
    _diagram = None

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_n_paths      = len(_path_coefficients)
_n_endo       = len(_endo_vars)
_n_exo        = len(_exo_vars)
_sig_paths    = sum(
    1 for _pc in _path_coefficients
    if _pc.get("p_value") is not None and _pc["p_value"] < 0.05
)

_fit_interp_str = (
    _fit_indices_out.get("fit_interpretation", "Fit indices unavailable")
    if _fit_indices_out else "Fit indices unavailable"
)

_r2_parts = []
if _r_squared:
    for _v, _r2v in _r_squared.items():
        if _r2v is not None:
            _r2_parts.append(f"{_v}: R\u00b2 = {_r2v:.3f} ({_r2v * 100:.1f}% variance explained)")

_indirect_str = ""
if _indirect_effects:
    _n_sig_ind = sum(1 for _ie in _indirect_effects if _ie.get("significant") is True)
    _indirect_str = (
        f" {len(_indirect_effects)} indirect effect(s) identified"
        + (f"; {_n_sig_ind} significant via bootstrapping." if _do_bootstrap else ".")
    )

_interp_parts = [
    f"Path analysis{_fallback_note} (estimator: {_estimator}). N = {_n}. "
    f"Model: {_n_endo} endogenous variable(s) ({', '.join(_endo_vars)}), "
    f"{_n_exo} exogenous variable(s) ({', '.join(_exo_vars) if _exo_vars else 'none'}).",
    f"{_sig_paths} of {_n_paths} direct path(s) statistically significant (p < .05).{_indirect_str}",
    _fit_interp_str,
]
if _r2_parts:
    _interp_parts.append("Variance explained: " + "; ".join(_r2_parts))

interpretation = " ".join(_interp_parts)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n":                   _n,
    "model_syntax":        _model_syntax,
    "estimator":           _estimator,
    "endogenous_vars":     _endo_vars,
    "exogenous_vars":      _exo_vars,
    "path_coefficients":   _path_coefficients,
    "indirect_effects":    _indirect_effects,
    "total_effects":       _total_effects,
    "fit_indices":         _fit_indices_out,
    "r_squared":           _r_squared,
    "residual_variances":  _residual_variances,
    "diagram":             _diagram,
    "standardized":        _do_std,
    "bootstrap":           _do_bootstrap,
    "n_boot":              _n_boot if _do_bootstrap else None,
    "ci_level":            _ci_level,
    "interpretation":      interpretation,
}
