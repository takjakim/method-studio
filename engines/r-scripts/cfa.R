# cfa.R - Confirmatory Factor Analysis for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   factor1, factor2, factor3, factor4, factor5: lists of indicator variables for each factor
#   <col_name>: each column's data injected as a variable (list from JSON)
#   options   : optional named list with fields:
#                 estimator         : character, "ML" | "MLR" | "WLSMV" (default "ML")
#                 standardized      : logical, include standardized solution (default TRUE)
#                 fitIndices        : logical, compute model fit indices (default TRUE)
#                 modificationIndices: logical, compute modification indices (default FALSE)
#                 orthogonal        : logical, use orthogonal factors (default FALSE)
#                 miThreshold       : numeric, MI threshold to report (default 10)
#                 missingValues     : character, "listwise" | "fiml" (default "listwise")
#                 ciLevel           : numeric in (0,1), CI level for parameters (default 0.95)
#
# Returns a named list assigned to `result` with:
#   fit_indices           : list (CFI, TLI, RMSEA, RMSEA_ci_lower, RMSEA_ci_upper,
#                           SRMR, chi_square, df, p_value, AIC, BIC)
#   loadings              : list of per-indicator loading rows (unstandardized + standardized)
#   factor_correlations   : list of factor-pair correlation entries (if >1 factor)
#   residual_variances    : named list of residual variance per indicator
#   modification_indices  : list of MI rows (if requested and MIs >= miThreshold)
#   model_syntax          : character, the lavaan model string used
#   estimator             : character, estimator used
#   n                     : integer, number of observations
#   n_vars                : integer, number of observed variables
#   n_factors             : integer, number of latent factors
#   variable_names        : character vector of observed variable names
#   factor_names          : character vector of latent factor names
#   converged             : logical, whether the model converged
#   interpretation        : character, narrative model summary
#
# Dependencies: lavaan (loaded by caller via packages field)

# ---- Input validation ----

if (!requireNamespace("lavaan", quietly = TRUE)) {
  stop("Package 'lavaan' is required for CFA. Install it with install.packages('lavaan').")
}

# ---- Build factors from factor1, factor2, ... slots ----

factor_indicators <- list()
factor_names_vec <- character(0)

# Helper to get factor indicators from a slot variable
get_factor_vars <- function(slot_name) {
  if (!exists(slot_name)) return(character(0))
  x <- get(slot_name)
  if (is.null(x) || length(x) == 0) return(character(0))
  if (is.list(x)) unlist(x) else as.character(x)
}

# Check each factor slot
for (i in 1:5) {
  slot_name <- paste0("factor", i)
  vars <- get_factor_vars(slot_name)
  if (length(vars) >= 2) {
    factor_name <- paste0("F", i)
    factor_indicators[[factor_name]] <- vars
    factor_names_vec <- c(factor_names_vec, factor_name)
  } else if (length(vars) == 1) {
    warning(paste0("Factor ", i, " has only 1 indicator; skipping (need at least 2)."))
  }
}

if (length(factor_indicators) == 0) {
  stop("CFA requires at least one factor with 2+ indicators. Please assign variables to Factor 1.")
}

# Collect all variable names
var_names <- unique(unlist(factor_indicators))

# ---- Resolve options ----

estimator_opt  <- "ML"
do_std         <- TRUE
do_fit         <- TRUE
do_mi          <- FALSE
do_orthogonal  <- FALSE
mi_threshold   <- 10
missing_opt    <- "listwise"
ci_level       <- 0.95

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("estimator") && !is.null(estimator)) {
  estimator_opt <- toupper(as.character(if (is.list(estimator)) estimator[[1]] else estimator))
}
if (exists("standardized") && !is.null(standardized)) {
  do_std <- as.logical(if (is.list(standardized)) standardized[[1]] else standardized)
}
if (exists("fitIndices") && !is.null(fitIndices)) {
  do_fit <- as.logical(if (is.list(fitIndices)) fitIndices[[1]] else fitIndices)
}
if (exists("modificationIndices") && !is.null(modificationIndices)) {
  do_mi <- as.logical(if (is.list(modificationIndices)) modificationIndices[[1]] else modificationIndices)
}
if (exists("orthogonal") && !is.null(orthogonal)) {
  do_orthogonal <- as.logical(if (is.list(orthogonal)) orthogonal[[1]] else orthogonal)
}
if (exists("miThreshold") && !is.null(miThreshold)) {
  mi_threshold <- as.numeric(if (is.list(miThreshold)) miThreshold[[1]] else miThreshold)
  if (is.na(mi_threshold) || mi_threshold < 0) mi_threshold <- 10
}
if (exists("missingValues") && !is.null(missingValues)) {
  missing_opt <- as.character(if (is.list(missingValues)) missingValues[[1]] else missingValues)
}
if (exists("ciLevel") && !is.null(ciLevel)) {
  ci_level <- as.numeric(if (is.list(ciLevel)) ciLevel[[1]] else ciLevel)
  if (is.na(ci_level) || ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
}

# Validate estimator
valid_estimators <- c("ML", "MLR", "WLSMV", "ULS", "DWLS", "GLS", "WLS")
if (!estimator_opt %in% valid_estimators) {
  warning(paste0("Unknown estimator '", estimator_opt, "'; defaulting to 'ML'."))
  estimator_opt <- "ML"
}

# ---- Build data frame ----

df_list <- list()
for (vn in var_names) {
  if (!exists(vn)) {
    stop(paste0("Column '", vn, "' not found in data"))
  }
  x_raw <- get(vn)
  df_list[[vn]] <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

# Handle missing values
if (missing_opt == "fiml") {
  df <- df_raw
  lavaan_missing <- "ml"  # lavaan uses "ml" for FIML
} else {
  # Listwise deletion (default)
  df <- df_raw[complete.cases(df_raw), , drop = FALSE]
  lavaan_missing <- "listwise"
}

n_obs <- nrow(df)
n_vars <- ncol(df)

if (n_obs < n_vars + 1L) {
  stop(paste0(
    "Insufficient observations (n = ", n_obs, ") for ", n_vars,
    " variables. Need at least ", n_vars + 1L, " complete cases."
  ))
}

# ---- Build lavaan model syntax ----

model_lines <- vapply(factor_names_vec, function(fn) {
  inds <- factor_indicators[[fn]]
  paste0(fn, " =~ ", paste(inds, collapse = " + "))
}, character(1L))

model_syntax <- paste(model_lines, collapse = "\n")

# ---- Fit CFA model ----

cfa_fit <- tryCatch(
  lavaan::cfa(
    model     = model_syntax,
    data      = df,
    estimator = estimator_opt,
    missing   = lavaan_missing,
    orthogonal = do_orthogonal
  ),
  error = function(e) {
    # If WLSMV/WLS fails, suggest ML
    if (estimator_opt %in% c("WLSMV", "WLS", "DWLS")) {
      warning(paste0("Estimator '", estimator_opt, "' failed; trying 'ML': ", e$message))
      tryCatch(
        lavaan::cfa(
          model      = model_syntax,
          data       = df,
          estimator  = "ML",
          missing    = if (missing_opt == "fiml") "ml" else "listwise",
          orthogonal = do_orthogonal
        ),
        error = function(e2) stop(paste0("CFA failed: ", e2$message))
      )
    } else {
      stop(paste0("CFA failed: ", e$message))
    }
  }
)

did_converge <- lavaan::lavInspect(cfa_fit, "converged")

# ---- Fit indices ----

fit_indices_result <- NULL

if (do_fit) {
  fm <- tryCatch(
    lavaan::fitMeasures(
      cfa_fit,
      fit.measures = c(
        "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper",
        "srmr", "chisq", "df", "pvalue", "aic", "bic"
      )
    ),
    error = function(e) NULL
  )

  if (!is.null(fm)) {
    safe_fm <- function(nm) {
      v <- unname(fm[nm])
      if (is.null(v) || length(v) == 0 || is.na(v)) NULL else round(v, 4)
    }

    fit_indices_result <- list(
      CFI          = safe_fm("cfi"),
      TLI          = safe_fm("tli"),
      RMSEA        = safe_fm("rmsea"),
      RMSEA_ci_lower = safe_fm("rmsea.ci.lower"),
      RMSEA_ci_upper = safe_fm("rmsea.ci.upper"),
      SRMR         = safe_fm("srmr"),
      chi_square   = safe_fm("chisq"),
      df           = safe_fm("df"),
      p_value      = safe_fm("pvalue"),
      AIC          = safe_fm("aic"),
      BIC          = safe_fm("bic")
    )
  }
}

# ---- Parameter estimates ----

pe_all <- tryCatch(
  lavaan::parameterEstimates(
    cfa_fit,
    ci         = TRUE,
    level      = ci_level,
    standardized = do_std
  ),
  error = function(e) {
    lavaan::parameterEstimates(cfa_fit, ci = FALSE, standardized = FALSE)
  }
)

# ---- Factor loadings (op == "=~") ----

pe_loadings <- pe_all[pe_all$op == "=~", , drop = FALSE]

loadings_list <- lapply(seq_len(nrow(pe_loadings)), function(i) {
  row <- pe_loadings[i, ]
  entry <- list(
    factor      = as.character(row$lhs),
    indicator   = as.character(row$rhs),
    estimate    = round(row$est,  4),
    se          = round(row$se,   4),
    z           = if (!is.null(row$z)     && !is.na(row$z))     round(row$z,    4) else NULL,
    p_value     = if (!is.null(row$pvalue) && !is.na(row$pvalue)) round(row$pvalue, 6) else NULL,
    ci_lower    = if (!is.null(row$ci.lower) && !is.na(row$ci.lower)) round(row$ci.lower, 4) else NULL,
    ci_upper    = if (!is.null(row$ci.upper) && !is.na(row$ci.upper)) round(row$ci.upper, 4) else NULL
  )
  if (do_std && "std.all" %in% names(row)) {
    entry$std_loading <- if (!is.na(row$std.all)) round(row$std.all, 4) else NULL
  }
  entry
})

# ---- Factor correlations (op == "~~" between two different latent factors) ----

n_factors <- length(factor_names_vec)
factor_correlations_result <- NULL

if (n_factors > 1L) {
  pe_fcov <- pe_all[
    pe_all$op == "~~" &
    pe_all$lhs %in% factor_names_vec &
    pe_all$rhs %in% factor_names_vec &
    pe_all$lhs != pe_all$rhs,
    , drop = FALSE
  ]

  if (nrow(pe_fcov) > 0) {
    factor_correlations_result <- lapply(seq_len(nrow(pe_fcov)), function(i) {
      row <- pe_fcov[i, ]
      entry <- list(
        factor1  = as.character(row$lhs),
        factor2  = as.character(row$rhs),
        covariance = round(row$est, 4),
        se         = round(row$se, 4),
        z          = if (!is.null(row$z)      && !is.na(row$z))      round(row$z, 4)      else NULL,
        p_value    = if (!is.null(row$pvalue)  && !is.na(row$pvalue))  round(row$pvalue, 6) else NULL
      )
      if (do_std && "std.all" %in% names(row)) {
        entry$correlation <- if (!is.na(row$std.all)) round(row$std.all, 4) else NULL
      }
      entry
    })
  }
}

# ---- Residual variances (op == "~~" for observed variables with lhs == rhs) ----

pe_resid <- pe_all[
  pe_all$op == "~~" &
  pe_all$lhs == pe_all$rhs &
  pe_all$lhs %in% var_names,
  , drop = FALSE
]

resid_variances <- list()
if (nrow(pe_resid) > 0) {
  for (i in seq_len(nrow(pe_resid))) {
    row <- pe_resid[i, ]
    vname <- as.character(row$lhs)
    entry <- list(
      estimate = round(row$est, 4),
      se       = round(row$se,  4)
    )
    if (do_std && "std.all" %in% names(row)) {
      entry$std_residual <- if (!is.na(row$std.all)) round(row$std.all, 4) else NULL
    }
    resid_variances[[vname]] <- entry
  }
}

# ---- Modification indices (optional) ----

mi_result <- NULL

if (do_mi && did_converge) {
  mi_result <- tryCatch({
    mi_df <- lavaan::modificationIndices(cfa_fit, sort. = TRUE, minimum.value = mi_threshold)
    if (nrow(mi_df) == 0) {
      list()
    } else {
      lapply(seq_len(nrow(mi_df)), function(i) {
        row <- mi_df[i, ]
        list(
          lhs = as.character(row$lhs),
          op  = as.character(row$op),
          rhs = as.character(row$rhs),
          mi  = round(row$mi, 3),
          epc = if ("epc" %in% names(row) && !is.na(row$epc)) round(row$epc, 4) else NULL
        )
      })
    }
  }, error = function(e) {
    warning(paste0("Could not compute modification indices: ", e$message))
    NULL
  })
}

# ---- Interpretation ----

# Fit quality helpers
fit_quality <- function(fit) {
  if (is.null(fit)) return("unavailable")

  cfi_ok   <- !is.null(fit$CFI)   && !is.na(fit$CFI)   && fit$CFI   >= 0.95
  tli_ok   <- !is.null(fit$TLI)   && !is.na(fit$TLI)   && fit$TLI   >= 0.95
  rmsea_ok <- !is.null(fit$RMSEA) && !is.na(fit$RMSEA) && fit$RMSEA <= 0.06
  srmr_ok  <- !is.null(fit$SRMR)  && !is.na(fit$SRMR)  && fit$SRMR  <= 0.08

  n_good <- sum(c(cfi_ok, tli_ok, rmsea_ok, srmr_ok))
  if (n_good == 4) "excellent"
  else if (n_good >= 3) "good"
  else if (n_good >= 2) "adequate"
  else "poor"
}

quality_label <- fit_quality(fit_indices_result)

fit_str <- if (!is.null(fit_indices_result)) {
  parts <- character(0)
  if (!is.null(fit_indices_result$chi_square) && !is.null(fit_indices_result$df) &&
      !is.null(fit_indices_result$p_value)) {
    parts <- c(parts, sprintf(
      "chi2(%d) = %.2f, p = %.4f",
      as.integer(fit_indices_result$df),
      fit_indices_result$chi_square,
      fit_indices_result$p_value
    ))
  }
  if (!is.null(fit_indices_result$CFI))   parts <- c(parts, sprintf("CFI = %.3f",   fit_indices_result$CFI))
  if (!is.null(fit_indices_result$TLI))   parts <- c(parts, sprintf("TLI = %.3f",   fit_indices_result$TLI))
  if (!is.null(fit_indices_result$RMSEA)) parts <- c(parts, sprintf("RMSEA = %.3f", fit_indices_result$RMSEA))
  if (!is.null(fit_indices_result$SRMR))  parts <- c(parts, sprintf("SRMR = %.3f",  fit_indices_result$SRMR))
  paste(parts, collapse = "; ")
} else {
  "Fit indices not computed"
}

convergence_str <- if (did_converge) "Model converged normally." else "WARNING: Model did NOT converge."

factor_str <- if (n_factors == 1) {
  paste0("a single factor ('", factor_names_vec[1], "')")
} else if (do_orthogonal) {
  paste0(n_factors, " orthogonal factors (", paste(factor_names_vec, collapse = ", "), ")")
} else {
  paste0(n_factors, " correlated factors (", paste(factor_names_vec, collapse = ", "), ")")
}

interpretation <- sprintf(
  paste0(
    "CFA with %s was estimated using the %s estimator on N = %d complete observations ",
    "across %d observed variables. %s ",
    "Overall fit: %s. ",
    "Model fit quality: %s (CFI/TLI >= .95 and RMSEA <= .06 and SRMR <= .08 considered good)."
  ),
  factor_str,
  estimator_opt,
  n_obs,
  n_vars,
  convergence_str,
  fit_str,
  quality_label
)

# ---- Compose result ----

result <- list(
  fit_indices          = fit_indices_result,
  loadings             = loadings_list,
  factor_correlations  = factor_correlations_result,
  residual_variances   = resid_variances,
  modification_indices = mi_result,
  model_syntax         = model_syntax,
  estimator            = estimator_opt,
  n                    = n_obs,
  n_vars               = n_vars,
  n_factors            = n_factors,
  variable_names       = var_names,
  factor_names         = factor_names_vec,
  converged            = did_converge,
  interpretation       = interpretation
)

result
