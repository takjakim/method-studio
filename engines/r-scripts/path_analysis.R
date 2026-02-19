# path_analysis.R - Path Analysis using lavaan for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   model          : character string - lavaan model syntax (e.g. "y ~ x1 + x2\nx2 ~ x1")
#                    OR omit and supply structured input below
#
#   Structured input (used when `model` is not provided):
#   endogenous     : list of column names - dependent/endogenous variable(s)
#   exogenous      : list of column names - independent/exogenous variable(s)
#   paths          : list of path definitions, each a list with:
#                      from : character, predictor variable name
#                      to   : character, outcome variable name
#
#   Column data is injected into the environment by name (same pattern as mediation.R).
#   Each column may arrive as a list from JSON; use as.numeric(unlist(x)) to coerce.
#
#   options        : list with optional named fields:
#                      estimator   : character, lavaan estimator (default "ML")
#                                    e.g. "ML", "MLR", "MLM", "GLS", "WLS", "WLSMV"
#                      standardized: logical, return standardized coefficients (default TRUE)
#                      bootstrap   : logical, use bootstrapping for indirect effects (default FALSE)
#                      nBoot       : integer, number of bootstrap resamples (default 1000)
#                      ciLevel     : numeric in (0,1), CI width (default 0.95)
#                      missing     : character, missing data handling (default "listwise")
#                                    e.g. "listwise", "ml" (full-information ML)
#
# Returns `result` list:
#   n                 : integer, number of complete cases used
#   model_syntax      : character, lavaan model syntax used
#   estimator         : character, estimator used
#   path_coefficients : list of direct path estimates (unstandardized and standardized)
#   indirect_effects  : list of indirect effects (if any mediated paths exist)
#   total_effects     : list of total effects per variable pair
#   fit_indices       : model fit statistics (chi-sq, CFI, TLI, RMSEA, SRMR, AIC, BIC)
#   r_squared         : named list of R^2 for each endogenous variable
#   residual_variances: named list of residual variances for endogenous variables
#   diagram           : list with nodes and edges for visualization
#   interpretation    : character, narrative summary
#
# Dependencies: lavaan

# ---- Input validation ----

if (!requireNamespace("lavaan", quietly = TRUE)) {
  stop("Package 'lavaan' is required but not installed. Please install it with: install.packages('lavaan')")
}

has_model_syntax <- exists("model") && !is.null(model) && nchar(trimws(
  if (is.list(model)) model[[1]] else model[1]
)) > 0

has_structured   <- exists("paths") && !is.null(paths) && length(paths) > 0

if (!has_model_syntax && !has_structured) {
  stop("Either 'model' (lavaan syntax string) or 'paths' (structured path list) must be provided")
}

# ---- Resolve options ----

estimator_opt  <- "ML"
do_std         <- TRUE
do_bootstrap   <- FALSE
n_boot         <- 1000L
ci_level       <- 0.95
missing_opt    <- "listwise"

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("estimator") && !is.null(estimator)) {
  estimator_opt <- toupper(as.character(if (is.list(estimator)) estimator[[1]] else estimator))
}
if (exists("standardized") && !is.null(standardized)) {
  do_std <- as.logical(if (is.list(standardized)) standardized[[1]] else standardized)
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
  if (ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
}
if (exists("missing") && !is.null(missing)) {
  missing_opt <- tolower(as.character(if (is.list(missing)) missing[[1]] else missing))
}

# ---- Build lavaan model syntax ----

if (has_model_syntax) {
  model_syntax <- trimws(if (is.list(model)) model[[1]] else model[1])
} else {
  # Structured input: build model syntax from endogenous/exogenous/paths

  endo_names <- if (exists("endogenous") && !is.null(endogenous)) {
    if (is.list(endogenous)) unlist(endogenous) else as.character(endogenous)
  } else {
    character(0)
  }

  exo_names <- if (exists("exogenous") && !is.null(exogenous)) {
    if (is.list(exogenous)) unlist(exogenous) else as.character(exogenous)
  } else {
    character(0)
  }

  # Collect paths into a named list: outcome -> vector of predictors
  path_map <- list()

  path_list <- if (is.list(paths)) paths else list(paths)
  for (p in path_list) {
    from_var <- if (is.list(p$from)) p$from[[1]] else as.character(p$from)
    to_var   <- if (is.list(p$to))   p$to[[1]]   else as.character(p$to)
    if (!nzchar(from_var) || !nzchar(to_var)) next
    path_map[[to_var]] <- unique(c(path_map[[to_var]], from_var))
  }

  if (length(path_map) == 0) {
    stop("No valid paths found in the 'paths' input. Each path needs 'from' and 'to' fields.")
  }

  syntax_lines <- vapply(names(path_map), function(outcome_var) {
    preds <- path_map[[outcome_var]]
    paste0(outcome_var, " ~ ", paste(preds, collapse = " + "))
  }, character(1L))

  model_syntax <- paste(syntax_lines, collapse = "\n")
}

# ---- Parse model syntax to identify variables ----

parse_model_variables <- function(syntax) {
  lines <- strsplit(syntax, "\n")[[1]]
  lines <- trimws(lines)
  lines <- lines[nzchar(lines) & !grepl("^#", lines)]

  endo <- character(0)
  all_vars <- character(0)

  for (line in lines) {
    # Handle regression lines: lhs ~ rhs
    if (grepl("~", line) && !grepl("~~", line)) {
      parts <- strsplit(line, "~")[[1]]
      if (length(parts) >= 2) {
        lhs <- trimws(parts[1])
        rhs <- trimws(paste(parts[-1], collapse = "~"))
        # LHS may have label syntax like "y ~"
        lhs_var <- gsub("\\*.*$", "", lhs)
        lhs_var <- trimws(lhs_var)
        if (nzchar(lhs_var)) {
          endo <- unique(c(endo, lhs_var))
          all_vars <- unique(c(all_vars, lhs_var))
        }
        # RHS predictors
        rhs_terms <- strsplit(rhs, "\\+")[[1]]
        for (term in rhs_terms) {
          # Strip labels like "a*x1"
          var_part <- trimws(gsub(".*\\*", "", trimws(term)))
          # Strip numeric-only (e.g. intercept = 1)
          if (nzchar(var_part) && !grepl("^[0-9.]+$", var_part)) {
            all_vars <- unique(c(all_vars, var_part))
          }
        }
      }
    }
  }

  exo <- setdiff(all_vars, endo)
  list(endogenous = endo, exogenous = exo, all = all_vars)
}

model_vars <- parse_model_variables(model_syntax)
endo_vars  <- model_vars$endogenous
exo_vars   <- model_vars$exogenous
all_vars   <- model_vars$all

if (length(all_vars) == 0) {
  stop("Could not identify any variables from the model syntax. Check the syntax format.")
}

# ---- Build data frame ----

coerce_col <- function(nm) {
  if (!exists(nm)) stop(paste0("Column '", nm, "' not found in the data"))
  raw <- get(nm)
  as.numeric(if (is.list(raw)) unlist(raw) else raw)
}

df_list <- list()
for (v in all_vars) {
  df_list[[v]] <- coerce_col(v)
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

# Listwise deletion for minimal n check; actual missing handling passed to lavaan
df_complete <- df_raw[complete.cases(df_raw), , drop = FALSE]
n_complete   <- nrow(df_complete)
n_total      <- nrow(df_raw)

n_min <- length(all_vars) + 2L
if (n_complete < n_min) {
  stop(paste0(
    "Insufficient complete observations (n = ", n_complete, ") for path analysis with ",
    length(all_vars), " variable(s). Need at least ", n_min, " complete cases."
  ))
}

# Use df_raw when FIML is requested, otherwise use complete cases
use_df <- if (missing_opt == "ml") df_raw else df_complete
n      <- if (missing_opt == "ml") n_total else n_complete

# ---- Fit lavaan model ----

lavaan_missing <- if (missing_opt == "ml") "ml" else "listwise"

fit_args <- list(
  model   = model_syntax,
  data    = use_df,
  estimator = estimator_opt,
  missing = lavaan_missing
)

if (do_bootstrap) {
  fit_args$se      <- "bootstrap"
  fit_args$bootstrap <- n_boot
  set.seed(20240201L)
}

fit <- tryCatch(
  do.call(lavaan::sem, fit_args),
  error = function(e) {
    stop(paste0("lavaan model fitting failed: ", conditionMessage(e)))
  }
)

# ---- Extract path coefficients (parameter estimates) ----

pe <- lavaan::parameterEstimates(
  fit,
  standardized = do_std,
  ci           = TRUE,
  level        = ci_level
)

# Regression paths only (op == "~")
reg_rows <- pe[pe$op == "~", ]

path_coefficients <- vector("list", nrow(reg_rows))
for (i in seq_len(nrow(reg_rows))) {
  row <- reg_rows[i, ]
  entry <- list(
    from         = row$rhs,
    to           = row$lhs,
    estimate     = row$est,
    se           = row$se,
    z            = if ("z" %in% names(row)) row$z else row$est / row$se,
    p_value      = row$pvalue,
    ci_lower     = row$ci.lower,
    ci_upper     = row$ci.upper
  )
  if (do_std && "std.all" %in% names(row)) {
    entry$std_estimate <- row$std.all
  }
  if (do_std && "std.lv" %in% names(row)) {
    entry$std_lv <- row$std.lv
  }
  path_coefficients[[i]] <- entry
}

# ---- Extract indirect effects ----
# Only present when model has labelled indirect effects or mediated paths exist

indirect_effects <- NULL

tryCatch({
  # Detect possible mediated paths: X -> M -> Y
  # Where M is in both endo_vars and appears as predictor of another endo var
  mediators_detected <- character(0)
  for (e_var in endo_vars) {
    preds_of_e <- reg_rows$rhs[reg_rows$lhs == e_var]
    for (p in preds_of_e) {
      if (p %in% endo_vars) {
        mediators_detected <- unique(c(mediators_detected, p))
      }
    }
  }

  if (length(mediators_detected) > 0) {
    # Build a model with labelled indirect paths and re-fit for indirect effects
    # Collect: X -> M (a paths) and M -> Y (b paths)
    indirect_list <- list()

    for (med in mediators_detected) {
      # Predictors of mediator (exogenous sources)
      x_vars_for_med <- reg_rows$rhs[reg_rows$lhs == med]
      x_vars_for_med <- x_vars_for_med[x_vars_for_med %in% exo_vars]

      # Outcomes of mediator
      y_vars_for_med <- reg_rows$lhs[reg_rows$rhs == med]
      y_vars_for_med <- y_vars_for_med[y_vars_for_med %in% endo_vars]
      y_vars_for_med <- setdiff(y_vars_for_med, med)

      for (x_var in x_vars_for_med) {
        for (y_var in y_vars_for_med) {
          a_coef <- reg_rows$est[reg_rows$lhs == med    & reg_rows$rhs == x_var]
          b_coef <- reg_rows$est[reg_rows$lhs == y_var  & reg_rows$rhs == med]

          if (length(a_coef) == 1 && length(b_coef) == 1) {
            indirect_est <- a_coef * b_coef

            entry <- list(
              from      = x_var,
              through   = med,
              to        = y_var,
              a_coef    = a_coef,
              b_coef    = b_coef,
              estimate  = indirect_est
            )

            if (do_std) {
              a_std <- if ("std.all" %in% names(reg_rows)) {
                reg_rows$std.all[reg_rows$lhs == med   & reg_rows$rhs == x_var]
              } else NA_real_
              b_std <- if ("std.all" %in% names(reg_rows)) {
                reg_rows$std.all[reg_rows$lhs == y_var & reg_rows$rhs == med]
              } else NA_real_
              if (length(a_std) == 1 && length(b_std) == 1) {
                entry$std_estimate <- a_std * b_std
              }
            }

            # Bootstrap CI if bootstrapping was used
            if (do_bootstrap) {
              boot_ci <- tryCatch({
                set.seed(20240202L)
                boot_samples <- vapply(seq_len(n_boot), function(i) {
                  idx  <- sample.int(nrow(use_df), replace = TRUE)
                  bd   <- use_df[idx, , drop = FALSE]
                  bfit <- tryCatch(
                    lavaan::sem(model_syntax, data = bd, estimator = estimator_opt,
                                missing = lavaan_missing),
                    error = function(e) NULL
                  )
                  if (is.null(bfit) || !lavaan::lavInspect(bfit, "converged")) return(NA_real_)
                  bpe  <- lavaan::parameterEstimates(bfit)
                  ba   <- bpe$est[bpe$op == "~" & bpe$lhs == med   & bpe$rhs == x_var]
                  bb   <- bpe$est[bpe$op == "~" & bpe$lhs == y_var & bpe$rhs == med]
                  if (length(ba) != 1 || length(bb) != 1) return(NA_real_)
                  unname(ba * bb)
                }, numeric(1L))

                valid <- boot_samples[is.finite(boot_samples)]
                if (length(valid) >= 10L) {
                  alpha_tail <- (1 - ci_level) / 2
                  list(
                    boot_se  = sd(valid),
                    ci_lower = quantile(valid, alpha_tail,     names = FALSE),
                    ci_upper = quantile(valid, 1 - alpha_tail, names = FALSE)
                  )
                } else NULL
              }, error = function(e) NULL)

              if (!is.null(boot_ci)) {
                entry$boot_se  <- boot_ci$boot_se
                entry$ci_lower <- boot_ci$ci_lower
                entry$ci_upper <- boot_ci$ci_upper
                entry$significant <- !(boot_ci$ci_lower <= 0 && boot_ci$ci_upper >= 0)
              }
            }

            indirect_list <- c(indirect_list, list(entry))
          }
        }
      }
    }

    if (length(indirect_list) > 0) {
      indirect_effects <- indirect_list
    }
  }
}, error = function(e) {
  warning(paste0("Indirect effect computation failed: ", conditionMessage(e)))
})

# ---- Total effects ----

total_effects <- NULL

tryCatch({
  # Compute total effects manually: direct + sum(indirect)
  te_list <- list()

  # Direct effects
  for (i in seq_len(nrow(reg_rows))) {
    from_v <- reg_rows$rhs[i]
    to_v   <- reg_rows$lhs[i]
    pair_key <- paste0(from_v, "->", to_v)
    direct_val <- reg_rows$est[i]

    # Sum matching indirect effects
    indirect_sum <- 0
    if (!is.null(indirect_effects)) {
      for (ie in indirect_effects) {
        if (ie$from == from_v && ie$to == to_v) {
          indirect_sum <- indirect_sum + ie$estimate
        }
      }
    }

    te_list[[pair_key]] <- list(
      from           = from_v,
      to             = to_v,
      direct         = direct_val,
      indirect       = if (indirect_sum != 0) indirect_sum else NULL,
      total          = direct_val + indirect_sum
    )

    if (do_std && "std.all" %in% names(reg_rows)) {
      std_direct <- reg_rows$std.all[i]
      std_indirect <- 0
      if (!is.null(indirect_effects)) {
        for (ie in indirect_effects) {
          if (ie$from == from_v && ie$to == to_v && !is.null(ie$std_estimate)) {
            std_indirect <- std_indirect + ie$std_estimate
          }
        }
      }
      te_list[[pair_key]]$std_direct   <- std_direct
      te_list[[pair_key]]$std_indirect <- if (std_indirect != 0) std_indirect else NULL
      te_list[[pair_key]]$std_total    <- std_direct + std_indirect
    }
  }

  # Indirect-only effects (X -> Y with no direct path, only through mediator)
  if (!is.null(indirect_effects)) {
    for (ie in indirect_effects) {
      pair_key <- paste0(ie$from, "->", ie$to)
      if (is.null(te_list[[pair_key]])) {
        # No direct effect exists for this pair
        te_list[[pair_key]] <- list(
          from     = ie$from,
          to       = ie$to,
          direct   = 0,
          indirect = ie$estimate,
          total    = ie$estimate
        )
        if (!is.null(ie$std_estimate)) {
          te_list[[pair_key]]$std_direct   <- 0
          te_list[[pair_key]]$std_indirect <- ie$std_estimate
          te_list[[pair_key]]$std_total    <- ie$std_estimate
        }
      } else {
        # Accumulate into existing entry
        existing <- te_list[[pair_key]]
        prev_ind <- if (is.null(existing$indirect)) 0 else existing$indirect
        te_list[[pair_key]]$indirect <- prev_ind + ie$estimate
        te_list[[pair_key]]$total    <- existing$direct + te_list[[pair_key]]$indirect
      }
    }
  }

  total_effects <- unname(te_list)
}, error = function(e) {
  warning(paste0("Total effects computation failed: ", conditionMessage(e)))
})

# ---- Model fit indices ----

fit_measures_raw <- tryCatch(
  lavaan::fitMeasures(fit, c(
    "chisq", "df", "pvalue",
    "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.pvalue",
    "srmr", "aic", "bic", "npar"
  )),
  error = function(e) {
    warning(paste0("Fit measures extraction failed: ", conditionMessage(e)))
    NULL
  }
)

fit_indices <- if (!is.null(fit_measures_raw)) {
  fm <- as.list(fit_measures_raw)
  list(
    chi_square        = if (!is.na(fm$chisq))          fm$chisq          else NULL,
    df                = if (!is.na(fm$df))              as.integer(fm$df) else NULL,
    p_value           = if (!is.na(fm$pvalue))          fm$pvalue         else NULL,
    cfi               = if (!is.na(fm$cfi))             fm$cfi            else NULL,
    tli               = if (!is.na(fm$tli))             fm$tli            else NULL,
    rmsea             = if (!is.na(fm$rmsea))           fm$rmsea          else NULL,
    rmsea_ci_lower    = if (!is.na(fm$rmsea.ci.lower))  fm$rmsea.ci.lower else NULL,
    rmsea_ci_upper    = if (!is.na(fm$rmsea.ci.upper))  fm$rmsea.ci.upper else NULL,
    rmsea_p_close     = if (!is.na(fm$rmsea.pvalue))    fm$rmsea.pvalue   else NULL,
    srmr              = if (!is.na(fm$srmr))            fm$srmr           else NULL,
    aic               = if (!is.na(fm$aic))             fm$aic            else NULL,
    bic               = if (!is.na(fm$bic))             fm$bic            else NULL,
    n_parameters      = if (!is.na(fm$npar))            as.integer(fm$npar) else NULL,
    fit_interpretation = {
      cfi_val   <- if (!is.null(fm$cfi) && !is.na(fm$cfi)) fm$cfi else NA
      rmsea_val <- if (!is.null(fm$rmsea) && !is.na(fm$rmsea)) fm$rmsea else NA
      srmr_val  <- if (!is.null(fm$srmr) && !is.na(fm$srmr)) fm$srmr else NA
      df_val    <- if (!is.null(fm$df) && !is.na(fm$df)) as.integer(fm$df) else 0L

      if (df_val == 0L) {
        "Model is just-identified (saturated); fit is perfect by definition."
      } else {
        cfi_ok   <- !is.na(cfi_val)   && cfi_val   >= 0.95
        rmsea_ok <- !is.na(rmsea_val) && rmsea_val <= 0.06
        srmr_ok  <- !is.na(srmr_val)  && srmr_val  <= 0.08

        n_ok <- sum(c(cfi_ok, rmsea_ok, srmr_ok), na.rm = TRUE)
        if (n_ok == 3) "Good fit (CFI >= .95, RMSEA <= .06, SRMR <= .08)" else
        if (n_ok == 2) "Adequate fit (2 of 3 primary indices in acceptable range)" else
        if (n_ok == 1) "Marginal fit (only 1 of 3 primary indices in acceptable range)" else
        "Poor fit (none of CFI, RMSEA, SRMR in acceptable range)"
      }
    }
  )
} else {
  NULL
}

# ---- R-squared for endogenous variables ----

r_squared <- tryCatch({
  r2_raw <- lavaan::lavInspect(fit, "r2")
  if (is.null(r2_raw) || length(r2_raw) == 0) {
    NULL
  } else {
    r2_list <- as.list(r2_raw)
    lapply(r2_list, function(v) if (is.finite(v)) v else NULL)
  }
}, error = function(e) NULL)

# ---- Residual variances for endogenous variables ----

residual_variances <- tryCatch({
  var_rows <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% endo_vars, ]
  if (nrow(var_rows) == 0) {
    NULL
  } else {
    rv_list <- list()
    for (i in seq_len(nrow(var_rows))) {
      vname <- var_rows$lhs[i]
      rv_list[[vname]] <- list(
        estimate = var_rows$est[i],
        se       = if (!is.na(var_rows$se[i]))   var_rows$se[i]   else NULL,
        p_value  = if (!is.na(var_rows$pvalue[i])) var_rows$pvalue[i] else NULL,
        ci_lower = if (!is.na(var_rows$ci.lower[i])) var_rows$ci.lower[i] else NULL,
        ci_upper = if (!is.na(var_rows$ci.upper[i])) var_rows$ci.upper[i] else NULL
      )
    }
    rv_list
  }
}, error = function(e) NULL)

# ---- Model diagram data ----

diagram <- tryCatch({
  # Nodes: one per variable, with type metadata
  nodes <- lapply(all_vars, function(v) {
    var_type <- if (v %in% endo_vars) "endogenous" else "exogenous"
    list(
      id    = v,
      label = v,
      type  = var_type
    )
  })

  # Edges: one per regression path, with coefficient
  edges <- lapply(seq_len(nrow(reg_rows)), function(i) {
    row  <- reg_rows[i, ]
    edge <- list(
      from      = row$rhs,
      to        = row$lhs,
      estimate  = row$est,
      p_value   = row$pvalue,
      significant = !is.na(row$pvalue) && row$pvalue < 0.05
    )
    if (do_std && "std.all" %in% names(row)) {
      edge$std_estimate <- row$std.all
    }
    edge
  })

  # Also add exogenous covariances as curved edges if present in model
  cov_rows <- pe[pe$op == "~~" & pe$lhs != pe$rhs, ]
  cov_edges <- lapply(seq_len(nrow(cov_rows)), function(i) {
    row <- cov_rows[i, ]
    list(
      from      = row$lhs,
      to        = row$rhs,
      estimate  = row$est,
      p_value   = if (!is.na(row$pvalue)) row$pvalue else NULL,
      type      = "covariance"
    )
  })

  list(
    nodes = nodes,
    edges = c(edges, cov_edges)
  )
}, error = function(e) {
  warning(paste0("Diagram data generation failed: ", conditionMessage(e)))
  NULL
})

# ---- Interpretation ----

n_paths <- length(path_coefficients)
n_endo  <- length(endo_vars)
n_exo   <- length(exo_vars)

sig_paths <- vapply(path_coefficients, function(p) {
  !is.null(p$p_value) && !is.na(p$p_value) && p$p_value < 0.05
}, logical(1L))
n_sig_paths <- sum(sig_paths, na.rm = TRUE)

fit_interp_str <- if (!is.null(fit_indices) && !is.null(fit_indices$fit_interpretation)) {
  fit_indices$fit_interpretation
} else {
  "Fit indices unavailable"
}

r2_interp_parts <- character(0)
if (!is.null(r_squared)) {
  for (v in names(r_squared)) {
    r2_val <- r_squared[[v]]
    if (!is.null(r2_val) && is.finite(r2_val)) {
      r2_interp_parts <- c(r2_interp_parts,
        sprintf("%s: R\u00b2 = %.3f (%.1f%% variance explained)", v, r2_val, r2_val * 100)
      )
    }
  }
}

indirect_interp_str <- if (!is.null(indirect_effects) && length(indirect_effects) > 0) {
  n_sig_ind <- sum(vapply(indirect_effects, function(ie) {
    isTRUE(ie$significant)
  }, logical(1L)))
  sprintf(
    " %d indirect effect(s) identified; %d significant via bootstrapping.",
    length(indirect_effects), n_sig_ind
  )
} else {
  ""
}

interp_parts <- c(
  sprintf(
    "Path analysis using lavaan (estimator: %s). N = %d. Model: %d endogenous variable(s) (%s), %d exogenous variable(s) (%s).",
    estimator_opt, n, n_endo, paste(endo_vars, collapse = ", "),
    n_exo, if (length(exo_vars) > 0) paste(exo_vars, collapse = ", ") else "none"
  ),
  sprintf(
    "%d of %d direct path(s) statistically significant (p < .05).%s",
    n_sig_paths, n_paths, indirect_interp_str
  ),
  fit_interp_str,
  if (length(r2_interp_parts) > 0) paste("Variance explained:", paste(r2_interp_parts, collapse = "; ")) else NULL
)

interpretation <- paste(interp_parts[!sapply(interp_parts, is.null)], collapse = " ")

# ---- Compose result ----

result <- list(
  n                  = n,
  model_syntax       = model_syntax,
  estimator          = estimator_opt,
  endogenous_vars    = endo_vars,
  exogenous_vars     = exo_vars,
  path_coefficients  = path_coefficients,
  indirect_effects   = indirect_effects,
  total_effects      = total_effects,
  fit_indices        = fit_indices,
  r_squared          = r_squared,
  residual_variances = residual_variances,
  diagram            = diagram,
  standardized       = do_std,
  bootstrap          = do_bootstrap,
  n_boot             = if (do_bootstrap) n_boot else NULL,
  ci_level           = ci_level,
  interpretation     = interpretation
)

result
