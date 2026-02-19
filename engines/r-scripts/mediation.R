# mediation.R - Mediation Analysis (PROCESS Model 4 style) for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome    : list with one element - column name of the outcome variable (Y)
#   predictor  : list with one element - column name of the predictor variable (X)
#   mediators  : list of column names - mediator variable name(s) (M)
#   covariates : optional list of column names - covariate(s) to control for
#   <col_name> : each column's data injected as a variable (list from JSON)
#   options    : optional list with named fields:
#                  bootstrap   : logical, use bootstrapping for indirect CI (default TRUE)
#                  nBoot       : integer, number of bootstrap samples (default 5000)
#                  ciLevel     : numeric in (0,1), CI width (default 0.95)
#                  standardize : logical, standardize all variables before analysis (default FALSE)
#                  effectSize  : logical, compute kappa-squared effect size (default TRUE)
#                  totalEffect : logical, include total effect (path c) in output (default TRUE)
#
# Returns `result` list:
#   n              : integer, number of complete cases
#   predictor      : character, predictor name
#   outcome        : character, outcome name
#   mediators      : character vector, mediator name(s)
#   covariates     : character vector or NULL
#   paths          : list of path coefficient summaries (a, b, c, c_prime per mediator)
#   indirect       : list per mediator (effect, boot_se, ci_lower, ci_upper, significant)
#   total_indirect : combined indirect effect across all mediators (parallel mediation)
#   direct         : direct effect c_prime (X -> Y | M)
#   total          : total effect c (X -> Y)
#   model_summary  : R-squared for mediator model(s) and outcome model
#   effect_sizes   : kappa-squared per mediator (if requested)
#   standardized   : logical, whether variables were standardized
#   ci_level       : numeric
#   n_boot         : integer
#   interpretation : character, narrative summary
#
# Dependencies: none beyond base R (boot package used optionally for bootstrapping)

# ---- Input validation ----

if (!exists("outcome"))   stop("Variable 'outcome' is required")
if (!exists("predictor")) stop("Variable 'predictor' is required")
if (!exists("mediators") || length(mediators) == 0) {
  stop("Variable 'mediators' is required and must contain at least one mediator name")
}

# ---- Resolve options ----
# Options are flattened into individual variables by the Rust engine

do_bootstrap <- TRUE
n_boot       <- 5000L
ci_level     <- 0.95
do_std       <- FALSE
do_effect_sz <- TRUE
do_total     <- TRUE

# Read flattened option variables directly
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
if (exists("standardize") && !is.null(standardize)) {
  do_std <- as.logical(if (is.list(standardize)) standardize[[1]] else standardize)
}
if (exists("effectSize") && !is.null(effectSize)) {
  do_effect_sz <- as.logical(if (is.list(effectSize)) effectSize[[1]] else effectSize)
}
if (exists("totalEffect") && !is.null(totalEffect)) {
  do_total <- as.logical(if (is.list(totalEffect)) totalEffect[[1]] else totalEffect)
}

# ---- Extract variable names ----

outcome_name <- if (is.list(outcome)) outcome[[1]] else outcome[1]
if (!exists(outcome_name)) stop(paste0("Column '", outcome_name, "' not found in data"))

pred_name <- if (is.list(predictor)) predictor[[1]] else predictor[1]
if (!exists(pred_name)) stop(paste0("Column '", pred_name, "' not found in data"))

med_names <- if (is.list(mediators)) unlist(mediators) else as.character(mediators)
if (length(med_names) == 0) stop("At least one mediator is required")
for (mn in med_names) {
  if (!exists(mn)) stop(paste0("Mediator column '", mn, "' not found in data"))
}

cov_names <- character(0)
if (exists("covariates") && !is.null(covariates) && length(covariates) > 0) {
  cov_names <- if (is.list(covariates)) unlist(covariates) else as.character(covariates)
  cov_names <- cov_names[nzchar(cov_names)]
  for (cn in cov_names) {
    if (!exists(cn)) stop(paste0("Covariate column '", cn, "' not found in data"))
  }
}

all_col_names <- unique(c(pred_name, med_names, outcome_name, cov_names))

# ---- Build data frame ----

df_list <- list()
for (col in all_col_names) {
  raw <- get(col)
  df_list[[col]] <- as.numeric(if (is.list(raw)) unlist(raw) else raw)
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

# Listwise deletion
df_clean <- df_raw[complete.cases(df_raw), , drop = FALSE]
n <- nrow(df_clean)

n_min <- length(all_col_names) + 2L
if (n < n_min) {
  stop(paste0(
    "Insufficient complete observations (n = ", n, ") for this mediation model. ",
    "Need at least ", n_min, " complete cases."
  ))
}

# ---- Standardize if requested ----

if (do_std) {
  df_clean[, all_col_names] <- scale(df_clean[, all_col_names, drop = FALSE])
}

# ---- Helper: extract path coefficient from lm summary ----

extract_coef <- function(model_summary, term_name) {
  ct <- model_summary$coefficients
  if (!term_name %in% rownames(ct)) {
    return(list(coef = NA_real_, se = NA_real_, t = NA_real_, p = NA_real_))
  }
  list(
    coef = unname(ct[term_name, "Estimate"]),
    se   = unname(ct[term_name, "Std. Error"]),
    t    = unname(ct[term_name, "t value"]),
    p    = unname(ct[term_name, "Pr(>|t|)"])
  )
}

# ---- Helper: build RHS formula string ----

build_rhs <- function(terms) {
  paste(terms, collapse = " + ")
}

# ---- Run mediation paths ----

alpha_tail <- (1 - ci_level) / 2

# Storage
paths_out      <- list()
indirect_out   <- list()
r2_mediators   <- list()
effect_sz_out  <- list()

# --- Total effect: X -> Y (path c) ---
total_rhs    <- build_rhs(c(pred_name, cov_names))
total_fml    <- as.formula(paste(outcome_name, "~", total_rhs))
fit_total    <- lm(total_fml, data = df_clean)
smry_total   <- summary(fit_total)
path_c       <- extract_coef(smry_total, pred_name)

# --- Direct effect: X -> Y | M1, M2, ... (path c') ---
direct_rhs   <- build_rhs(c(pred_name, med_names, cov_names))
direct_fml   <- as.formula(paste(outcome_name, "~", direct_rhs))
fit_direct   <- lm(direct_fml, data = df_clean)
smry_direct  <- summary(fit_direct)
path_c_prime <- extract_coef(smry_direct, pred_name)
r2_y         <- smry_direct$r.squared
adj_r2_y     <- smry_direct$adj.r.squared

# --- Per-mediator paths a and b ---
for (mn in med_names) {
  # Path a: X -> M (controlling for covariates)
  a_rhs  <- build_rhs(c(pred_name, cov_names))
  a_fml  <- as.formula(paste(mn, "~", a_rhs))
  fit_a  <- lm(a_fml, data = df_clean)
  smry_a <- summary(fit_a)
  path_a <- extract_coef(smry_a, pred_name)

  r2_mediators[[mn]] <- list(
    r_squared     = smry_a$r.squared,
    adj_r_squared = smry_a$adj.r.squared
  )

  # Path b: M -> Y | X (from the direct-effect model already fitted)
  path_b <- extract_coef(smry_direct, mn)

  # Product-of-coefficients indirect effect estimate
  indirect_est <- path_a$coef * path_b$coef

  # --- Bootstrap CI for indirect effect ---
  boot_se  <- NA_real_
  ci_lower <- NA_real_
  ci_upper <- NA_real_

  if (do_bootstrap) {
    set.seed(20240101L)

    boot_indirect <- tryCatch({
      # Capture mn, pred_name, cov_names, outcome_name in local scope
      local_mn       <- mn
      local_pred     <- pred_name
      local_cov      <- cov_names
      local_outcome  <- outcome_name

      boot_fn <- function(data, indices) {
        d <- data[indices, , drop = FALSE]

        a_r  <- build_rhs(c(local_pred, local_cov))
        fa   <- tryCatch(lm(as.formula(paste(local_mn, "~", a_r)), data = d), error = function(e) NULL)
        if (is.null(fa)) return(NA_real_)
        coef_a <- tryCatch(coef(fa)[local_pred], error = function(e) NA_real_)

        all_m <- med_names  # full mediator list for direct model
        dir_r <- build_rhs(c(local_pred, all_m, local_cov))
        fd    <- tryCatch(lm(as.formula(paste(local_outcome, "~", dir_r)), data = d), error = function(e) NULL)
        if (is.null(fd)) return(NA_real_)
        coef_b <- tryCatch(coef(fd)[local_mn], error = function(e) NA_real_)

        unname(coef_a * coef_b)
      }

      if (requireNamespace("boot", quietly = TRUE)) {
        bo <- boot::boot(data = df_clean, statistic = boot_fn, R = n_boot)
        bo$t[, 1]
      } else {
        # Manual bootstrap without the boot package
        vapply(seq_len(n_boot), function(i) {
          idx <- sample.int(n, replace = TRUE)
          boot_fn(df_clean, idx)
        }, numeric(1L))
      }
    }, error = function(e) {
      warning(paste0("Bootstrapping failed for mediator '", mn, "': ", e$message))
      NULL
    })

    if (!is.null(boot_indirect)) {
      valid_boots <- boot_indirect[is.finite(boot_indirect)]
      if (length(valid_boots) >= 10L) {
        boot_se  <- sd(valid_boots)
        ci_lower <- quantile(valid_boots, alpha_tail,   names = FALSE)
        ci_upper <- quantile(valid_boots, 1 - alpha_tail, names = FALSE)
      }
    }
  } else {
    # Sobel SE approximation: sqrt(b^2*se_a^2 + a^2*se_b^2)
    sobel_se <- sqrt(
      path_b$coef^2 * path_a$se^2 +
      path_a$coef^2 * path_b$se^2
    )
    z_crit   <- qnorm(1 - alpha_tail)
    boot_se  <- sobel_se
    ci_lower <- indirect_est - z_crit * sobel_se
    ci_upper <- indirect_est + z_crit * sobel_se
  }

  is_significant <- if (!is.na(ci_lower) && !is.na(ci_upper)) {
    !(ci_lower <= 0 && ci_upper >= 0)
  } else {
    NA
  }

  paths_out[[mn]] <- list(
    a       = path_a,
    b       = path_b,
    c       = path_c,
    c_prime = path_c_prime
  )

  indirect_out[[mn]] <- list(
    effect      = indirect_est,
    boot_se     = if (is.na(boot_se)) NULL else boot_se,
    ci_lower    = if (is.na(ci_lower)) NULL else ci_lower,
    ci_upper    = if (is.na(ci_upper)) NULL else ci_upper,
    significant = is_significant
  )

  # --- Effect size: kappa-squared (Preacher & Kelley, 2011) ---
  if (do_effect_sz) {
    kappa_sq <- tryCatch({
      # kappa^2 = indirect / max possible indirect
      # Upper bound approximation: product of max(|a|)*max(|b|)
      # Simplified: indirect / (sqrt(var(X)*var(M)) style; use ratio to total SS)
      var_x  <- var(df_clean[[pred_name]])
      var_m  <- var(df_clean[[mn]])
      var_y  <- var(df_clean[[outcome_name]])
      # Preacher & Kelley kappa^2 = ab / (max ab), where max ab involves
      # the squared correlations; use the practical approximation:
      r_xm   <- cor(df_clean[[pred_name]], df_clean[[mn]])
      r_my   <- cor(df_clean[[mn]], df_clean[[outcome_name]])
      r_xy   <- cor(df_clean[[pred_name]], df_clean[[outcome_name]])
      # Upper bound of indirect: path_a_max * path_b_max
      # Using standardized coefficients for the bound
      a_std  <- path_a$coef * sqrt(var_x) / sqrt(var_m)
      b_std  <- path_b$coef * sqrt(var_m) / sqrt(var_y)
      ind_std <- a_std * b_std
      # Max possible: bounded by |r_xm| * sqrt(1 - r_xm^2) in both directions
      max_ind <- abs(r_xm) * sqrt(1 - r_xm^2) * sign(ind_std)
      kq <- if (abs(max_ind) > 1e-10) min(abs(ind_std / max_ind), 1.0) else NA_real_
      kq
    }, error = function(e) NA_real_)

    kappa_interp <- if (!is.na(kappa_sq)) {
      if (kappa_sq < 0.01) "negligible" else if (kappa_sq < 0.09) "small" else if (kappa_sq < 0.25) "medium" else "large"
    } else {
      "unavailable"
    }

    effect_sz_out[[mn]] <- list(
      kappa_squared  = if (!is.na(kappa_sq)) round(kappa_sq, 4) else NULL,
      interpretation = kappa_interp
    )
  }
}

# ---- Total indirect effect (sum across mediators for parallel mediation) ----

total_indirect_est <- sum(vapply(indirect_out, function(x) {
  if (is.null(x$effect) || !is.finite(x$effect)) 0 else x$effect
}, numeric(1L)))

# Combined bootstrap distribution for total indirect (if bootstrapped)
total_indirect_ci_lower <- NULL
total_indirect_ci_upper <- NULL
total_indirect_boot_se  <- NULL

if (do_bootstrap && length(med_names) > 1L) {
  set.seed(20240102L)
  total_boot <- tryCatch({
    all_m <- med_names
    boot_total_fn <- function(data, indices) {
      d <- data[indices, , drop = FALSE]
      total_ab <- 0
      for (bm in all_m) {
        a_r  <- build_rhs(c(pred_name, cov_names))
        fa   <- tryCatch(lm(as.formula(paste(bm, "~", a_r)), data = d), error = function(e) NULL)
        if (is.null(fa)) next
        ca <- tryCatch(coef(fa)[pred_name], error = function(e) NA_real_)
        dir_r <- build_rhs(c(pred_name, all_m, cov_names))
        fd    <- tryCatch(lm(as.formula(paste(outcome_name, "~", dir_r)), data = d), error = function(e) NULL)
        if (is.null(fd)) next
        cb <- tryCatch(coef(fd)[bm], error = function(e) NA_real_)
        if (is.finite(ca) && is.finite(cb)) total_ab <- total_ab + ca * cb
      }
      unname(total_ab)
    }

    if (requireNamespace("boot", quietly = TRUE)) {
      bo2 <- boot::boot(data = df_clean, statistic = boot_total_fn, R = n_boot)
      bo2$t[, 1]
    } else {
      vapply(seq_len(n_boot), function(i) {
        idx <- sample.int(n, replace = TRUE)
        boot_total_fn(df_clean, idx)
      }, numeric(1L))
    }
  }, error = function(e) NULL)

  if (!is.null(total_boot)) {
    valid <- total_boot[is.finite(total_boot)]
    if (length(valid) >= 10L) {
      total_indirect_boot_se  <- sd(valid)
      total_indirect_ci_lower <- quantile(valid, alpha_tail,     names = FALSE)
      total_indirect_ci_upper <- quantile(valid, 1 - alpha_tail, names = FALSE)
    }
  }
} else if (length(med_names) == 1L) {
  # Single mediator: reuse per-mediator CI as the total
  single <- indirect_out[[med_names[1]]]
  total_indirect_boot_se  <- single$boot_se
  total_indirect_ci_lower <- single$ci_lower
  total_indirect_ci_upper <- single$ci_upper
}

total_indirect_sig <- if (!is.null(total_indirect_ci_lower) && !is.null(total_indirect_ci_upper)) {
  !(total_indirect_ci_lower <= 0 && total_indirect_ci_upper >= 0)
} else {
  NA
}

# ---- Model summary ----

model_summary <- list(
  r_squared_y     = r2_y,
  adj_r_squared_y = adj_r2_y,
  r_squared_m     = r2_mediators
)

# ---- Interpretation ----

n_med   <- length(med_names)
ci_pct  <- ci_level * 100
method  <- if (do_bootstrap) paste0("bias-corrected bootstrap (B = ", n_boot, ")") else "Sobel z-approximation"

sig_meds <- med_names[vapply(med_names, function(mn) {
  isTRUE(indirect_out[[mn]]$significant)
}, logical(1L))]

med_list_str <- paste(med_names, collapse = ", ")
sig_str <- if (length(sig_meds) == 0) {
  "None of the indirect effects were significant"
} else if (length(sig_meds) == n_med) {
  paste0("All ", n_med, " indirect effect(s) via ", paste(sig_meds, collapse = ", "), " were significant")
} else {
  paste0("Significant indirect effect(s) via: ", paste(sig_meds, collapse = ", "))
}

path_c_dir   <- if (!is.na(path_c$coef) && path_c$coef > 0) "positive" else "negative"
path_c_p_cmp <- if (!is.na(path_c$p) && path_c$p < (1 - ci_level)) "<" else ">="
direct_p_cmp <- if (!is.na(path_c_prime$p) && path_c_prime$p < (1 - ci_level)) "<" else ">="

interp_parts <- c(
  sprintf(
    "Mediation analysis (PROCESS Model 4 style) tested whether the effect of '%s' on '%s' was mediated by %s.",
    pred_name, outcome_name,
    if (n_med == 1) paste0("'", med_names[1], "'") else paste0(n_med, " mediators (", med_list_str, ")")
  ),
  sprintf(
    "N = %d complete cases used. Indirect effects estimated via %s with %.0f%% CIs.",
    n, method, ci_pct
  ),
  sprintf(
    "Total effect (path c): b = %.3f, SE = %.3f, p %s %.4f.",
    if (is.na(path_c$coef)) 0 else path_c$coef,
    if (is.na(path_c$se))   0 else path_c$se,
    path_c_p_cmp,
    1 - ci_level
  ),
  sprintf(
    "Direct effect (path c'): b = %.3f, SE = %.3f, p %s %.4f.",
    if (is.na(path_c_prime$coef)) 0 else path_c_prime$coef,
    if (is.na(path_c_prime$se))   0 else path_c_prime$se,
    direct_p_cmp,
    1 - ci_level
  ),
  paste0(sig_str, ".")
)

interpretation <- paste(interp_parts, collapse = " ")

# ---- Compose diagram data for frontend visualization ----

# Build p-values map for diagram
diagram_pvalues <- list(
  a      = if (!is.na(paths_out[[med_names[1]]]$a$p)) paths_out[[med_names[1]]]$a$p else NULL,
  b      = if (!is.na(paths_out[[med_names[1]]]$b$p)) paths_out[[med_names[1]]]$b$p else NULL,
  c      = if (!is.na(path_c$p)) path_c$p else NULL,
  cPrime = if (!is.na(path_c_prime$p)) path_c_prime$p else NULL
)

# Build confidence intervals map
diagram_ci <- list()
if (!is.null(indirect_out[[med_names[1]]]$ci_lower) && !is.null(indirect_out[[med_names[1]]]$ci_upper)) {
  # Note: a*b indirect CI, but we can also provide individual path CIs if computed
  diagram_ci$indirect <- c(indirect_out[[med_names[1]]]$ci_lower, indirect_out[[med_names[1]]]$ci_upper)
}

diagram <- list(
  modelType = "mediation",
  variables = list(
    x = pred_name,
    y = outcome_name,
    m = med_names[1]  # Use first mediator for simple diagram
  ),
  coefficients = list(
    a      = if (!is.na(paths_out[[med_names[1]]]$a$coef)) paths_out[[med_names[1]]]$a$coef else NULL,
    b      = if (!is.na(paths_out[[med_names[1]]]$b$coef)) paths_out[[med_names[1]]]$b$coef else NULL,
    c      = if (!is.na(path_c$coef)) path_c$coef else NULL,
    cPrime = if (!is.na(path_c_prime$coef)) path_c_prime$coef else NULL
  ),
  pValues    = diagram_pvalues,
  confidence = if (length(diagram_ci) > 0) diagram_ci else NULL
)

# ---- Compose result ----

result <- list(
  n              = n,
  predictor      = pred_name,
  outcome        = outcome_name,
  mediators      = med_names,
  covariates     = if (length(cov_names) > 0) cov_names else NULL,
  paths          = paths_out,
  indirect       = indirect_out,
  total_indirect = list(
    effect      = total_indirect_est,
    boot_se     = total_indirect_boot_se,
    ci_lower    = total_indirect_ci_lower,
    ci_upper    = total_indirect_ci_upper,
    significant = total_indirect_sig
  ),
  direct = list(
    effect = path_c_prime$coef,
    se     = path_c_prime$se,
    t      = path_c_prime$t,
    p      = path_c_prime$p
  ),
  total = if (do_total) list(
    effect = path_c$coef,
    se     = path_c$se,
    t      = path_c$t,
    p      = path_c$p
  ) else NULL,
  model_summary  = model_summary,
  effect_sizes   = if (do_effect_sz) effect_sz_out else NULL,
  standardized   = do_std,
  ci_level       = ci_level,
  n_boot         = if (do_bootstrap) n_boot else NULL,
  interpretation = interpretation,
  diagram        = diagram
)

result
