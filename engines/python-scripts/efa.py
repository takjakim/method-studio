"""
Exploratory Factor Analysis (EFA) Script
=========================================
Expects the following variables in the execution namespace (injected by the engine):

  data : list[dict] | dict[str, list] | pd.DataFrame
      The dataset to analyse. Each key is a variable name; values are lists of numbers.

  variables : list[str]
      Names of numeric columns to include. Minimum 3 required.

  nFactors : int | None
      Number of factors to extract. If None or 0, uses the factor_analyzer
      default (factors with eigenvalue > 1). Default: None.

  rotation : str
      Rotation method. One of: "varimax" | "promax" | "oblimin" | "none".
      Default: "varimax".

  extractionMethod : str
      Extraction method. One of: "minres" | "ml" | "principal".
      Default: "minres".

  alpha : float
      Significance level for Bartlett's test. Default: 0.05.

Result structure
----------------
{
  "n": int,
  "n_vars": int,
  "variable_names": list[str],
  "adequacy": {
    "kmo": {
      "overall": float,
      "per_variable": {var: float, ...},
      "interpretation": str
    },
    "bartlett": {
      "chi_square": float,
      "df": int,
      "p_value": float,
      "significant": bool,
      "note": str
    }
  },
  "n_factors": int,
  "rotation": str,
  "extraction_method": str,
  "eigenvalues": list[float],
  "variance_explained": [
    {"factor": "F1", "ss_loadings": float, "prop_var": float, "cumul_var": float},
    ...
  ],
  "loadings": [
    {"variable": str, "F1": float, "F2": float, ...},
    ...
  ],
  "communalities": {var: float, ...},
  "uniqueness": {var: float, ...},
  "interpretation": str
}
"""

from __future__ import annotations

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
    raise TypeError(f"Unsupported data type for EFA: {type(raw)}")


def _kmo_interpret(msa: float) -> str:
    if msa >= 0.90:
        return "Marvelous"
    elif msa >= 0.80:
        return "Meritorious"
    elif msa >= 0.70:
        return "Middling"
    elif msa >= 0.60:
        return "Mediocre"
    elif msa >= 0.50:
        return "Miserable"
    else:
        return "Unacceptable"


def _compute_kmo(corr_matrix: np.ndarray, var_names: list[str]) -> dict:
    """
    Compute Kaiser-Meyer-Olkin (KMO) measure of sampling adequacy.
    Uses the partial correlation approach.
    """
    n_vars = corr_matrix.shape[0]
    try:
        corr_inv = np.linalg.inv(corr_matrix)
    except np.linalg.LinAlgError:
        # Singular matrix - regularise with a small diagonal
        corr_inv = np.linalg.pinv(corr_matrix)

    # Partial correlation matrix
    diag_inv = np.sqrt(np.diag(corr_inv))
    partial_corr = np.zeros_like(corr_inv)
    for i in range(n_vars):
        for j in range(n_vars):
            if i != j:
                partial_corr[i, j] = -corr_inv[i, j] / (diag_inv[i] * diag_inv[j])

    # KMO per variable
    corr_sq = corr_matrix ** 2
    partial_sq = partial_corr ** 2

    np.fill_diagonal(corr_sq, 0)
    np.fill_diagonal(partial_sq, 0)

    sum_corr = corr_sq.sum(axis=1)
    sum_partial = partial_sq.sum(axis=1)

    kmo_per = sum_corr / (sum_corr + sum_partial)
    kmo_overall = corr_sq.sum() / (corr_sq.sum() + partial_sq.sum())

    per_var = {var_names[i]: round(float(kmo_per[i]), 4) for i in range(n_vars)}

    return {
        "overall": round(float(kmo_overall), 4),
        "per_variable": per_var,
        "interpretation": _kmo_interpret(float(kmo_overall)),
    }


def _compute_bartlett(corr_matrix: np.ndarray, n_obs: int, alpha: float) -> dict:
    """Bartlett's Test of Sphericity."""
    n_vars = corr_matrix.shape[0]
    det = float(np.linalg.det(corr_matrix))
    det = max(det, 1e-300)  # Guard against log(0)

    chi_sq = -(n_obs - 1 - (2 * n_vars + 5) / 6) * np.log(det)
    df = int(n_vars * (n_vars - 1) / 2)
    p_value = float(scipy_stats.chi2.sf(chi_sq, df))
    significant = p_value < alpha

    return {
        "chi_square": round(float(chi_sq), 4),
        "df": df,
        "p_value": round(p_value, 8),
        "significant": significant,
        "note": (
            "Bartlett's test is significant: factor analysis is appropriate."
            if significant
            else "Bartlett's test is NOT significant: factor analysis may not be appropriate."
        ),
    }


def _run_efa_factor_analyzer(
    df_clean: pd.DataFrame,
    n_factors: int,
    rotation: str,
    method: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Run EFA using the factor_analyzer package.
    Returns (loadings, communalities, eigenvalues_from_fa).
    """
    from factor_analyzer import FactorAnalyzer

    rotation_arg = None if rotation == "none" else rotation
    fa = FactorAnalyzer(n_factors=n_factors, rotation=rotation_arg, method=method)
    fa.fit(df_clean.values)

    loadings = fa.loadings_
    communalities = fa.get_communalities()
    ev, _ = fa.get_eigenvalues()
    return loadings, communalities, ev


def _run_efa_sklearn_fallback(
    df_clean: pd.DataFrame,
    n_factors: int,
    rotation: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Fallback EFA using principal component extraction (no factor_analyzer).
    Only supports varimax-style rotation via scipy.
    """
    from sklearn.decomposition import PCA
    from scipy.stats import ortho_group

    pca = PCA(n_components=n_factors)
    pca.fit(df_clean.values)
    loadings = pca.components_.T  # shape: (n_vars, n_factors)

    # Scale by sqrt(eigenvalues) to get factor loadings
    eigenvalues_full = pca.explained_variance_
    loadings = loadings * np.sqrt(eigenvalues_full)

    communalities = np.sum(loadings ** 2, axis=1)

    # All eigenvalues from correlation matrix
    corr_matrix = np.corrcoef(df_clean.values.T)
    ev = np.linalg.eigvalsh(corr_matrix)[::-1]

    return loadings, communalities, ev


# ---------------------------------------------------------------------------
# Resolve inputs from injected namespace
# ---------------------------------------------------------------------------

# Get data dictionary (injected by wrapper)
_data_raw = data if "data" in dir() else {}  # noqa: F821

# Get variable names from the 'variables' slot (injected by wrapper)
try:
    _variables = list(variables)  # noqa: F821
except NameError:
    raise ValueError("Variable 'variables' is required - specify column names to analyze")

if len(_variables) == 0:
    raise ValueError("At least one variable must be specified in 'variables'")

# nFactors: 0 or absent means auto-detect (Kaiser criterion)
try:
    _nf_raw = nFactors  # noqa: F821
    _n_factors_req = int(_nf_raw) if _nf_raw is not None else 0
except NameError:
    _n_factors_req = 0

# rotation
try:
    _rotation = str(rotation).lower()  # noqa: F821
except NameError:
    _rotation = "varimax"

# extractionMethod
try:
    _method_raw = str(extractionMethod).lower()  # noqa: F821
except NameError:
    _method_raw = "minres"

# alpha
try:
    _alpha = float(alpha)  # noqa: F821
except NameError:
    _alpha = 0.05

# missingValues
try:
    _missing_values = str(missingValues)  # noqa: F821
except NameError:
    _missing_values = "exclude-listwise"

# Validate rotation
_valid_rotations = {"varimax", "promax", "oblimin", "none", "quartimax"}
if _rotation not in _valid_rotations:
    _rotation = "varimax"

# Map extraction method labels (spec uses "pa"; factor_analyzer uses "principal")
_method_map = {"minres": "minres", "ml": "ml", "principal": "principal", "pa": "principal"}
_method = _method_map.get(_method_raw, "minres")

# ---------------------------------------------------------------------------
# Build analysis dataframe
# ---------------------------------------------------------------------------

df_full = _to_dataframe(_data_raw)

if _variables:
    _missing = [v for v in _variables if v not in df_full.columns]
    if _missing:
        raise ValueError(f"Variables not found in data: {_missing}")
    df_num = df_full[_variables].copy()
else:
    df_num = df_full.select_dtypes(include="number").copy()

# Coerce all columns to numeric
for col in df_num.columns:
    df_num[col] = pd.to_numeric(df_num[col], errors="coerce")

# Handle missing values
if _missing_values == "pairwise":
    # Keep all rows; correlation matrix will use pairwise complete obs
    df_clean = df_num.copy()
    corr_method = "pearson"  # pandas uses pairwise by default for corr()
else:
    # Listwise deletion (default)
    df_clean = df_num.dropna()

var_names = list(df_clean.columns)
n_vars = len(var_names)
n_obs = len(df_clean)

if n_vars < 3:
    raise ValueError(f"EFA requires at least 3 numeric variables; only {n_vars} provided.")

if n_obs < n_vars + 1:
    raise ValueError(
        f"Insufficient observations ({n_obs}) for {n_vars} variables. "
        f"Need at least {n_vars + 1} complete cases."
    )

# ---------------------------------------------------------------------------
# Adequacy tests
# ---------------------------------------------------------------------------

corr_matrix = df_clean.corr().values
kmo_result = _compute_kmo(corr_matrix, var_names)
bartlett_result = _compute_bartlett(corr_matrix, n_obs, _alpha)

adequacy = {
    "kmo": kmo_result,
    "bartlett": bartlett_result,
}

# ---------------------------------------------------------------------------
# Determine number of factors
# ---------------------------------------------------------------------------

# Full eigenvalues from correlation matrix for scree / Kaiser rule
_eig_full = np.linalg.eigvalsh(corr_matrix)[::-1]

if _n_factors_req is None or _n_factors_req <= 0:
    # Kaiser criterion: eigenvalues > 1
    _n_factors = max(1, int(np.sum(_eig_full > 1.0)))
else:
    _n_factors = _n_factors_req

_max_factors = max(1, (n_vars - 1) // 2)
if _n_factors > _max_factors:
    _n_factors = _max_factors

# ---------------------------------------------------------------------------
# Run EFA
# ---------------------------------------------------------------------------

try:
    _loadings, _communalities, _ev_fa = _run_efa_factor_analyzer(
        df_clean, _n_factors, _rotation, _method
    )
    _used_fallback = False
except ImportError:
    _loadings, _communalities, _ev_fa = _run_efa_sklearn_fallback(
        df_clean, _n_factors, _rotation
    )
    _used_fallback = True

_uniqueness = 1.0 - _communalities

# ---------------------------------------------------------------------------
# Build output structures
# ---------------------------------------------------------------------------

_factor_names = [f"F{i + 1}" for i in range(_n_factors)]

# Loadings table
loadings_out = []
for i, var in enumerate(var_names):
    row = {"variable": var}
    for j, fname in enumerate(_factor_names):
        row[fname] = round(float(_loadings[i, j]), 4)
    loadings_out.append(row)

# Communalities and uniqueness
communalities_out = {var_names[i]: round(float(_communalities[i]), 4) for i in range(n_vars)}
uniqueness_out = {var_names[i]: round(float(_uniqueness[i]), 4) for i in range(n_vars)}

# Eigenvalues (from full correlation matrix)
eigenvalues_out = [round(float(v), 4) for v in _eig_full]

# Variance explained
_ss = np.sum(_loadings ** 2, axis=0)
_prop = _ss / n_vars
_cumul = np.cumsum(_prop)
variance_explained_out = [
    {
        "factor": _factor_names[i],
        "ss_loadings": round(float(_ss[i]), 4),
        "prop_var": round(float(_prop[i]), 4),
        "cumul_var": round(float(_cumul[i]), 4),
    }
    for i in range(_n_factors)
]

# ---------------------------------------------------------------------------
# Interpretation
# ---------------------------------------------------------------------------

_adequacy_ok = kmo_result["overall"] >= 0.60 and bartlett_result["significant"]
_var_pct = round(float(_cumul[_n_factors - 1]) * 100, 1)
_fallback_note = " (sklearn PCA fallback; install factor_analyzer for full EFA)" if _used_fallback else ""

interpretation = (
    f"EFA with {_n_factors} factor(s) extracted using {_method}{_fallback_note} "
    f"and {_rotation} rotation. "
    f"KMO = {kmo_result['overall']:.3f} ({kmo_result['interpretation']}). "
    f"Bartlett's test: chi2({bartlett_result['df']}) = {bartlett_result['chi_square']:.2f}, "
    f"p {'<' if bartlett_result['significant'] else '>='} {_alpha:.4f}. "
    f"Cumulative variance explained by {_n_factors} factor(s): {_var_pct:.1f}%. "
    + (
        "Data adequacy is acceptable for EFA."
        if _adequacy_ok
        else "Note: Data adequacy may be insufficient for reliable EFA."
    )
)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result = {
    "n": n_obs,
    "n_vars": n_vars,
    "variable_names": var_names,
    "adequacy": adequacy,
    "n_factors": _n_factors,
    "rotation": _rotation,
    "extraction_method": _method,
    "eigenvalues": eigenvalues_out,
    "variance_explained": variance_explained_out,
    "loadings": loadings_out,
    "communalities": communalities_out,
    "uniqueness": uniqueness_out,
    "interpretation": interpretation,
}
