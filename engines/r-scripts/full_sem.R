# full_sem.R - Full Structural Equation Modeling for Method Studio
#
# Estimates a complete SEM with both a measurement model (latent variables defined
# by indicator items) and a structural model (regression paths between latent variables
# and/or observed variables).
#
# Expected environment variables (set by wrapper.R from request data):
#   factors      : named list mapping latent factor names to their indicator variables
#                  e.g., list(Ability = list("a1","a2","a3"), Perf = list("p1","p2","p3"))
#   paths        : list of structural path definitions, each with:
#                    from : character, predictor (latent or observed variable name)
#                    to   : character, outcome  (latent or observed variable name)
#                    label: optional character, parameter label for constraints/indirect effects
#   <col_name>   : each observed indicator column injected as a variable (list from JSON)
#   options      : optional named list with fields:
#                    estimator    : character, "ML" | "MLR" | "WLSMV" (default "ML")
#                    standardized : logical (default TRUE)
#                    fitIndices   : logical (default TRUE)
#                    indirectEffects: logical, compute labelled indirect effects (default TRUE)
#                    bootstrap    : logical (default FALSE)
#                    nBoot        : integer (default 1000)
#                    ciLevel      : numeric in (0,1) (default 0.95)
#                    missingValues: character, "exclude-listwise" | "fiml" (default "exclude-listwise")
#
# Returns `result` list:
#   fit_indices          : model fit (CFI, TLI, RMSEA, SRMR, chi-sq, AIC, BIC)
#   loadings             : measurement model factor loadings
#   structural_paths     : estimated structural regression paths
#   indirect_effects     : indirect effects among latent variables (if paths exist)
#   total_effects        : direct + indirect totals
#   r_squared            : R^2 for endogenous latent variables
#   factor_correlations  : residual correlations among exogenous latent variables
#   residual_variances   : residual variances for endogenous latent variables
#   model_syntax         : full lavaan model string used
#   n                    : integer, observations used
#   n_factors            : integer, number of latent factors
#   factor_names         : character vector of latent factor names
#   endogenous_latents   : character vector of endogenous latent variable names
#   exogenous_latents    : character vector of exogenous latent variable names
#   estimator            : character, estimator used
#   converged            : logical
#   interpretation       : character, narrative summary
#
# Dependencies: lavaan

# ---- Input validation ----

if (!requireNamespace("lavaan", quietly = TRUE)) {
  stop("Package 'lavaan' is required. Install with install.packages('lavaan').")
}

if (!exists("factors") || length(factors) == 0) {
  stop("Variable 'factors' is required - specify latent factor structure as a named list.")
}

if (!is.list(factors)) {
  stop("'factors' must be a named list mapping factor names to indicator variable lists.")
}

# ---- Resolve inputs ----

factor_names_vec <- names(factors)
if (is.null(factor_names_vec) || any(!nzchar(factor_names_vec))) {
  stop("All entries in 'factors' must have non-empty names.")
}

factor_indicators <- lapply(factors, function(inds) {
  if (is.list(inds)) unlist(inds) else as.character(inds)
})

for (fn in factor_names_vec) {
  if (length(factor_indicators[[fn]]) < 2) {
    stop(paste0("Factor '", fn, "' has fewer than 2 indicators; each factor requires at least 2."))
  }
}

# All unique indicator variable names
all_indicators <- unique(unlist(factor_indicators))

# Structural paths (optional - if not provided, only a CFA is run)
has_paths <- exists("paths") && !is.null(paths) && length(paths) > 0

# ---- Resolve options ----

estimator_opt   <- "ML"
do_std          <- TRUE
do_fit          <- TRUE
do_indirect     <- TRUE
do_bootstrap    <- FALSE
n_boot          <- 1000L
ci_level        <- 0.95
missing_opt     <- "exclude-listwise"

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("estimator") && !is.null(estimator)) {
  estimator_opt <- toupper(if (is.list(estimator)) estimator[[1]] else estimator)
}
if (exists("standardized") && !is.null(standardized)) {
  do_std <- as.logical(if (is.list(standardized)) standardized[[1]] else standardized)
}
if (exists("fitIndices") && !is.null(fitIndices)) {
  do_fit <- as.logical(if (is.list(fitIndices)) fitIndices[[1]] else fitIndices)
}
if (exists("indirectEffects") && !is.null(indirectEffects)) {
  do_indirect <- as.logical(if (is.list(indirectEffects)) indirectEffects[[1]] else indirectEffects)
}
if (exists("bootstrap") && !is.null(bootstrap)) {
  do_bootstrap <- as.logical(if (is.list(bootstrap)) bootstrap[[1]] else bootstrap)
}
if (exists("nBoot") && !is.null(nBoot)) {
  n_boot <- as.integer(if (is.list(nBoot)) nBoot[[1]] else nBoot)
  if (n_boot < 100L) n_boot <- 100L
}
if (exists("ciLevel") && !is.null(ciLevel)) {
  ci_level <- as.numeric(if (is.list(ciLevel)) ciLevel[[1]] else ciLevel)
  if (is.na(ci_level) || ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
}
if (exists("missingValues") && !is.null(missingValues)) {
  missing_opt <- if (is.list(missingValues)) missingValues[[1]] else missingValues
}

valid_estimators <- c("ML", "MLR", "WLSMV", "ULS", "DWLS", "GLS", "WLS")
if (!estimator_opt %in% valid_estimators) {
  warning(paste0("Unknown estimator '", estimator_opt, "'; defaulting to 'ML'."))
  estimator_opt <- "ML"
}

lavaan_missing <- if (missing_opt == "fiml") "ml" else "listwise"

# ---- Build data frame from injected indicator columns ----

df_list <- list()
for (vn in all_indicators) {
  if (!exists(vn)) stop(paste0("Indicator column '", vn, "' not found in data"))
  raw <- get(vn)
  df_list[[vn]] <- as.numeric(if (is.list(raw)) unlist(raw) else raw)
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

if (lavaan_missing == "listwise") {
  df <- df_raw[complete.cases(df_raw), , drop = FALSE]
} else {
  df <- df_raw
}

n_obs <- nrow(df)
if (n_obs < length(all_indicators) + 1L) {
  stop(paste0(
    "Insufficient observations (n = ", n_obs, ") for ", length(all_indicators),
    " indicator variables. Need at least ", length(all_indicators) + 1L, " complete cases."
  ))
}

# ---- Build structural path map ----

# Parse structural paths to identify which latent variables are endogenous
endo_latents <- character(0)
exo_latents  <- character(0)

struct_path_map <- list()  # outcome -> vector of predictors

if (has_paths) {
  path_list <- if (is.list(paths)) paths else list(paths)
  for (p in path_list) {
    from_v <- if (is.list(p$from)) p$from[[1]] else as.character(p$from)
    to_v   <- if (is.list(p$to))   p$to[[1]]   else as.character(p$to)
    if (!nzchar(from_v) || !nzchar(to_v)) next
    struct_path_map[[to_v]] <- unique(c(struct_path_map[[to_v]], from_v))
    endo_latents <- unique(c(endo_latents, to_v))
  }
  all_path_vars <- unique(c(unlist(struct_path_map), names(struct_path_map)))
  exo_latents   <- setdiff(all_path_vars, endo_latents)
}

# ---- Build lavaan model syntax ----

# Measurement model: factor =~ indicator1 + indicator2 + ...
measurement_lines <- vapply(factor_names_vec, function(fn) {
  inds <- factor_indicators[[fn]]
  paste0(fn, " =~ ", paste(inds, collapse = " + "))
}, character(1L))

# Structural model: endogenous ~ exogenous + ...
structural_lines <- character(0)
if (has_paths && length(struct_path_map) > 0) {
  structural_lines <- vapply(names(struct_path_map), function(outcome) {
    predictors <- struct_path_map[[outcome]]
    paste0(outcome, " ~ ", paste(predictors, collapse = " + "))
  }, character(1L))
}

# Combine measurement + structural parts
model_syntax <- paste(
  c(measurement_lines, structural_lines),
  collapse = "\n"
)

# ---- Fit the SEM ----

fit_args <- list(
  model     = model_syntax,
  data      = df,
  estimator = estimator_opt,
  missing   = lavaan_missing
)

if (do_bootstrap) {
  fit_args$se        <- "bootstrap"
  fit_args$bootstrap <- n_boot
  set.seed(20240301L)
}

sem_fit <- tryCatch(
  do.call(lavaan::sem, fit_args),
  error = function(e) {
    if (estimator_opt %in% c("WLSMV", "DWLS", "WLS")) {
      warning(paste0("Estimator '", estimator_opt, "' failed; retrying with 'ML': ", e$message))
      tryCatch(
        lavaan::sem(model_syntax, data = df, estimator = "ML", missing = lavaan_missing),
        error = function(e2) stop(paste0("Full SEM fitting failed: ", e2$message))
      )
    } else {
      stop(paste0("Full SEM fitting failed: ", e$message))
    }
  }
)

did_converge <- lavaan::lavInspect(sem_fit, "converged")

# ---- Extract parameter estimates ----

pe_all <- tryCatch(
  lavaan::parameterEstimates(
    sem_fit,
    ci           = TRUE,
    level        = ci_level,
    standardized = do_std
  ),
  error = function(e) lavaan::parameterEstimates(sem_fit, ci = FALSE, standardized = FALSE)
)

# ---- Fit indices ----

fit_indices_result <- NULL

if (do_fit) {
  fm_raw <- tryCatch(
    lavaan::fitMeasures(sem_fit, c(
      "chisq", "df", "pvalue",
      "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper",
      "srmr", "aic", "bic", "npar"
    )),
    error = function(e) NULL
  )

  if (!is.null(fm_raw)) {
    fm <- as.list(fm_raw)
    safe_fm <- function(nm) {
      v <- fm[[nm]]; if (is.null(v) || is.na(v)) NULL else round(unname(v), 4)
    }
    fit_indices_result <- list(
      chi_square   = safe_fm("chisq"),
      df           = if (!is.null(fm$df) && !is.na(fm$df)) as.integer(fm$df) else NULL,
      p_value      = safe_fm("pvalue"),
      CFI          = safe_fm("cfi"),
      TLI          = safe_fm("tli"),
      RMSEA        = safe_fm("rmsea"),
      RMSEA_lower  = safe_fm("rmsea.ci.lower"),
      RMSEA_upper  = safe_fm("rmsea.ci.upper"),
      SRMR         = safe_fm("srmr"),
      AIC          = safe_fm("aic"),
      BIC          = safe_fm("bic"),
      n_parameters = if (!is.null(fm$npar) && !is.na(fm$npar)) as.integer(fm$npar) else NULL
    )
  }
}

# ---- Factor loadings (measurement model, op == "=~") ----

pe_loadings <- pe_all[pe_all$op == "=~", , drop = FALSE]

loadings_list <- lapply(seq_len(nrow(pe_loadings)), function(i) {
  row <- pe_loadings[i, ]
  entry <- list(
    factor    = as.character(row$lhs),
    indicator = as.character(row$rhs),
    estimate  = round(row$est, 4),
    se        = round(row$se,  4)
  )
  if (!is.null(row$z)      && !is.na(row$z))      entry$z       <- round(row$z, 4)
  if (!is.null(row$pvalue) && !is.na(row$pvalue))  entry$p_value <- round(row$pvalue, 6)
  if (!is.null(row$ci.lower) && !is.na(row$ci.lower)) entry$ci_lower <- round(row$ci.lower, 4)
  if (!is.null(row$ci.upper) && !is.na(row$ci.upper)) entry$ci_upper <- round(row$ci.upper, 4)
  if (do_std && "std.all" %in% names(row) && !is.na(row$std.all)) {
    entry$std_loading <- round(row$std.all, 4)
  }
  entry
})

# ---- Structural paths (op == "~") ----

pe_struct <- pe_all[pe_all$op == "~", , drop = FALSE]

structural_paths_list <- lapply(seq_len(nrow(pe_struct)), function(i) {
  row <- pe_struct[i, ]
  entry <- list(
    from     = as.character(row$rhs),
    to       = as.character(row$lhs),
    estimate = round(row$est, 4),
    se       = round(row$se,  4)
  )
  if (!is.null(row$z)        && !is.na(row$z))        entry$z         <- round(row$z, 4)
  if (!is.null(row$pvalue)   && !is.na(row$pvalue))   entry$p_value   <- round(row$pvalue, 6)
  if (!is.null(row$ci.lower) && !is.na(row$ci.lower)) entry$ci_lower  <- round(row$ci.lower, 4)
  if (!is.null(row$ci.upper) && !is.na(row$ci.upper)) entry$ci_upper  <- round(row$ci.upper, 4)
  if (do_std && "std.all" %in% names(row) && !is.na(row$std.all)) {
    entry$std_estimate <- round(row$std.all, 4)
  }
  entry
})

# ---- Factor correlations (exogenous latent covariances, op == "~~") ----

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
        factor1    = as.character(row$lhs),
        factor2    = as.character(row$rhs),
        covariance = round(row$est, 4),
        se         = round(row$se,  4)
      )
      if (!is.null(row$pvalue) && !is.na(row$pvalue)) entry$p_value <- round(row$pvalue, 6)
      if (do_std && "std.all" %in% names(row) && !is.na(row$std.all)) {
        entry$correlation <- round(row$std.all, 4)
      }
      entry
    })
  }
}

# ---- Residual variances for endogenous latent variables ----

residual_variances_result <- NULL

pe_resid_lv <- pe_all[
  pe_all$op == "~~" &
  pe_all$lhs == pe_all$rhs &
  pe_all$lhs %in% endo_latents,
  , drop = FALSE
]

if (nrow(pe_resid_lv) > 0) {
  residual_variances_result <- list()
  for (i in seq_len(nrow(pe_resid_lv))) {
    row   <- pe_resid_lv[i, ]
    vname <- as.character(row$lhs)
    entry <- list(estimate = round(row$est, 4), se = round(row$se, 4))
    if (!is.null(row$pvalue) && !is.na(row$pvalue)) entry$p_value <- round(row$pvalue, 6)
    if (do_std && "std.all" %in% names(row) && !is.na(row$std.all)) {
      entry$std_residual <- round(row$std.all, 4)
    }
    residual_variances_result[[vname]] <- entry
  }
}

# ---- R-squared for endogenous latent variables ----

r_squared_result <- tryCatch({
  r2_raw <- lavaan::lavInspect(sem_fit, "r2")
  if (is.null(r2_raw) || length(r2_raw) == 0) return(NULL)
  r2_list <- as.list(r2_raw)
  # Keep only endogenous latent variables (and endogenous observed if any)
  relevant <- names(r2_list)[names(r2_list) %in% c(endo_latents, names(struct_path_map))]
  if (length(relevant) == 0) r2_list else r2_list[relevant]
}, error = function(e) NULL)

# ---- Indirect and total effects among latent variables ----

indirect_effects_result <- NULL
total_effects_result    <- NULL

if (has_paths && do_indirect && length(pe_struct) > 0 && nrow(pe_struct) > 0) {
  tryCatch({
    # Identify mediating latent variables: appear as both predictor and outcome
    med_candidates <- intersect(pe_struct$rhs, pe_struct$lhs)
    # Only latent variables as mediators
    med_latents <- intersect(med_candidates, factor_names_vec)

    if (length(med_latents) > 0) {
      indirect_list <- list()

      for (med in med_latents) {
        x_vars_for_med <- pe_struct$rhs[pe_struct$lhs == med]
        y_vars_for_med <- pe_struct$lhs[pe_struct$rhs == med]
        y_vars_for_med <- setdiff(y_vars_for_med, med)

        for (x_var in x_vars_for_med) {
          for (y_var in y_vars_for_med) {
            a_row <- pe_struct[pe_struct$lhs == med    & pe_struct$rhs == x_var, ]
            b_row <- pe_struct[pe_struct$lhs == y_var  & pe_struct$rhs == med,   ]

            if (nrow(a_row) == 1 && nrow(b_row) == 1) {
              ind_est <- a_row$est * b_row$est
              entry <- list(
                from     = x_var,
                through  = med,
                to       = y_var,
                a_coef   = round(a_row$est, 4),
                b_coef   = round(b_row$est, 4),
                estimate = round(ind_est, 4)
              )
              if (do_std && "std.all" %in% names(a_row)) {
                a_std <- a_row$std.all; b_std <- b_row$std.all
                if (!is.na(a_std) && !is.na(b_std)) {
                  entry$std_estimate <- round(a_std * b_std, 4)
                }
              }
              indirect_list <- c(indirect_list, list(entry))
            }
          }
        }
      }

      if (length(indirect_list) > 0) indirect_effects_result <- indirect_list
    }

    # Total effects: direct + indirect per pair
    te_map <- list()
    for (i in seq_len(nrow(pe_struct))) {
      from_v   <- pe_struct$rhs[i]
      to_v     <- pe_struct$lhs[i]
      pair_key <- paste0(from_v, "->", to_v)
      direct_val <- pe_struct$est[i]
      ind_sum    <- 0
      if (!is.null(indirect_effects_result)) {
        for (ie in indirect_effects_result) {
          if (ie$from == from_v && ie$to == to_v) ind_sum <- ind_sum + ie$estimate
        }
      }
      entry <- list(
        from     = from_v,
        to       = to_v,
        direct   = round(direct_val, 4),
        indirect = if (ind_sum != 0) round(ind_sum, 4) else NULL,
        total    = round(direct_val + ind_sum, 4)
      )
      if (do_std && "std.all" %in% names(pe_struct)) {
        std_d <- pe_struct$std.all[i]
        std_i <- 0
        if (!is.null(indirect_effects_result)) {
          for (ie in indirect_effects_result) {
            if (ie$from == from_v && ie$to == to_v && !is.null(ie$std_estimate)) {
              std_i <- std_i + ie$std_estimate
            }
          }
        }
        if (!is.na(std_d)) {
          entry$std_direct   <- round(std_d, 4)
          entry$std_indirect <- if (std_i != 0) round(std_i, 4) else NULL
          entry$std_total    <- round(std_d + std_i, 4)
        }
      }
      te_map[[pair_key]] <- entry
    }

    if (length(te_map) > 0) total_effects_result <- unname(te_map)

  }, error = function(e) {
    warning(paste0("Indirect/total effects computation failed: ", e$message))
  })
}

# ---- Interpretation ----

fit_q <- function(fit) {
  if (is.null(fit)) return("unavailable")
  cfi_ok   <- !is.null(fit$CFI)   && !is.na(fit$CFI)   && fit$CFI   >= 0.95
  rmsea_ok <- !is.null(fit$RMSEA) && !is.na(fit$RMSEA) && fit$RMSEA <= 0.06
  srmr_ok  <- !is.null(fit$SRMR)  && !is.na(fit$SRMR)  && fit$SRMR  <= 0.08
  n_ok <- sum(c(cfi_ok, rmsea_ok, srmr_ok))
  if (n_ok == 3) "good" else if (n_ok == 2) "adequate" else if (n_ok == 1) "marginal" else "poor"
}

fit_quality <- fit_q(fit_indices_result)

fit_str <- if (!is.null(fit_indices_result)) {
  parts <- character(0)
  if (!is.null(fit_indices_result$chi_square) && !is.null(fit_indices_result$df)) {
    parts <- c(parts, sprintf("chi2(%d) = %.2f", fit_indices_result$df, fit_indices_result$chi_square))
  }
  if (!is.null(fit_indices_result$CFI))   parts <- c(parts, sprintf("CFI = %.3f",   fit_indices_result$CFI))
  if (!is.null(fit_indices_result$RMSEA)) parts <- c(parts, sprintf("RMSEA = %.3f", fit_indices_result$RMSEA))
  if (!is.null(fit_indices_result$SRMR))  parts <- c(parts, sprintf("SRMR = %.3f",  fit_indices_result$SRMR))
  paste(parts, collapse = "; ")
} else "Fit indices not computed"

n_sig_struct <- if (length(structural_paths_list) > 0) {
  sum(vapply(structural_paths_list, function(p) {
    !is.null(p$p_value) && !is.na(p$p_value) && p$p_value < 0.05
  }, logical(1L)))
} else 0L

r2_str <- ""
if (!is.null(r_squared_result) && length(r_squared_result) > 0) {
  r2_parts <- vapply(names(r_squared_result), function(v) {
    val <- r_squared_result[[v]]
    if (!is.null(val) && is.finite(val)) sprintf("%s: R\u00b2=%.3f", v, val) else ""
  }, character(1L))
  r2_parts <- r2_parts[nzchar(r2_parts)]
  if (length(r2_parts) > 0) r2_str <- paste0(" Variance explained: ", paste(r2_parts, collapse = "; "), ".")
}

interpretation <- sprintf(
  paste0(
    "Full SEM with %d latent factor(s) (%s) and %d indicator variable(s). ",
    "%s estimator, N = %d. ",
    "%s",
    "Structural model: %d path(s), %d significant (p < .05). ",
    "Fit: %s [%s].%s"
  ),
  n_factors,
  paste(factor_names_vec, collapse = ", "),
  length(all_indicators),
  estimator_opt,
  n_obs,
  if (did_converge) "" else "WARNING: model did not converge. ",
  length(structural_paths_list),
  n_sig_struct,
  fit_str,
  fit_quality,
  r2_str
)

# ---- Compose result ----

result <- list(
  fit_indices          = fit_indices_result,
  loadings             = loadings_list,
  structural_paths     = structural_paths_list,
  indirect_effects     = indirect_effects_result,
  total_effects        = total_effects_result,
  r_squared            = r_squared_result,
  factor_correlations  = factor_correlations_result,
  residual_variances   = residual_variances_result,
  model_syntax         = model_syntax,
  n                    = n_obs,
  n_factors            = n_factors,
  factor_names         = factor_names_vec,
  endogenous_latents   = endo_latents,
  exogenous_latents    = exo_latents,
  all_indicators       = all_indicators,
  estimator            = estimator_opt,
  converged            = did_converge,
  standardized         = do_std,
  bootstrap            = do_bootstrap,
  n_boot               = if (do_bootstrap) n_boot else NULL,
  ci_level             = ci_level,
  interpretation       = interpretation
)

result
