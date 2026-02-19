# serial_mediation.R - Serial Mediation Analysis (PROCESS Model 6 style) for Method Studio
#
# Model 6: X -> M1 -> M2 -> Y (two sequential mediators)
#
# Indirect paths:
#   Specific 1: X -> M1 -> Y       (a1 * b1)
#   Specific 2: X -> M2 -> Y       (a2 * b2)
#   Serial:     X -> M1 -> M2 -> Y (a1 * d21 * b2)
#   Total indirect: sum of specific 1 + specific 2 + serial
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome    : list with one element - column name of the outcome variable (Y)
#   predictor  : list with one element - column name of the predictor variable (X)
#   mediator1  : list with one element - column name of the first mediator (M1)
#   mediator2  : list with one element - column name of the second mediator (M2)
#   covariates : optional list of column names - covariate(s) to control for
#   options    : optional list with named fields:
#                  bootstrap   : logical, use bootstrapping for indirect CI (default TRUE)
#                  nBoot       : integer, number of bootstrap samples (default 5000)
#                  ciLevel     : numeric in (0,1), CI width (default 0.95)
#                  standardize : logical, standardize all variables before analysis (default FALSE)
#                  effectSize  : logical, compute effect size (default TRUE)
#                  totalEffect : logical, include total effect (path c) in output (default TRUE)
#
# Returns `result` list:
#   n              : integer, number of complete cases
#   predictor      : character
#   mediator1      : character
#   mediator2      : character
#   outcome        : character
#   covariates     : character vector or NULL
#   paths          : named list of path coefficients (a1, a2, d21, b1, b2, c, c_prime)
#   indirect       : named list with specific1, specific2, serial, total
#   direct         : direct effect of X on Y (c_prime)
#   total          : total effect of X on Y (c)
#   model_summary  : R-squared for M1, M2, and Y models
#   standardized   : logical
#   ci_level       : numeric
#   n_boot         : integer or NULL
#   interpretation : character, narrative summary
#
# Dependencies: none beyond base R

# ---- Input validation ----

if (!exists("outcome"))   stop("Variable 'outcome' is required")
if (!exists("predictor")) stop("Variable 'predictor' is required")
if (!exists("mediator1")) stop("Variable 'mediator1' is required")
if (!exists("mediator2")) stop("Variable 'mediator2' is required")

# ---- Resolve options ----

do_bootstrap <- TRUE
n_boot       <- 5000L
ci_level     <- 0.95
do_std       <- FALSE
do_effect_sz <- TRUE
do_total     <- TRUE

# Read flattened option variables directly (Rust engine injects each option as its own variable)
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

outcome_name <- if (is.list(outcome))   outcome[[1]]   else outcome[1]
pred_name    <- if (is.list(predictor)) predictor[[1]] else predictor[1]
m1_name      <- if (is.list(mediator1)) mediator1[[1]] else mediator1[1]
m2_name      <- if (is.list(mediator2)) mediator2[[1]] else mediator2[1]

if (!exists(outcome_name)) stop(paste0("Column '", outcome_name, "' not found in data"))
if (!exists(pred_name))    stop(paste0("Column '", pred_name, "' not found in data"))
if (!exists(m1_name))      stop(paste0("Column '", m1_name, "' not found in data"))
if (!exists(m2_name))      stop(paste0("Column '", m2_name, "' not found in data"))
if (m1_name == m2_name)    stop("mediator1 and mediator2 must be different variables")

cov_names <- character(0)
if (exists("covariates") && !is.null(covariates) && length(covariates) > 0) {
  cov_names <- if (is.list(covariates)) unlist(covariates) else as.character(covariates)
  cov_names <- cov_names[nzchar(cov_names)]
  for (cn in cov_names) {
    if (!exists(cn)) stop(paste0("Covariate column '", cn, "' not found in data"))
  }
}

all_col_names <- unique(c(pred_name, m1_name, m2_name, outcome_name, cov_names))

# ---- Build data frame ----

df_list <- list()
for (col in all_col_names) {
  raw <- get(col)
  df_list[[col]] <- as.numeric(if (is.list(raw)) unlist(raw) else raw)
}
df_raw   <- as.data.frame(df_list, stringsAsFactors = FALSE)
df_clean <- df_raw[complete.cases(df_raw), , drop = FALSE]
n        <- nrow(df_clean)

n_min <- length(all_col_names) + 3L
if (n < n_min) {
  stop(paste0(
    "Insufficient complete observations (n = ", n, ") for serial mediation. ",
    "Need at least ", n_min, " complete cases."
  ))
}

# ---- Standardize if requested ----

if (do_std) {
  df_clean[, all_col_names] <- scale(df_clean[, all_col_names, drop = FALSE])
}

# ---- Helper: extract coefficient from lm summary ----

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

build_rhs <- function(terms) paste(terms, collapse = " + ")

alpha_tail <- (1 - ci_level) / 2

# ---- Fit the three regression models ----

# Model 1: M1 ~ X (+ covariates) — yields path a1
m1_fml  <- as.formula(paste(m1_name, "~", build_rhs(c(pred_name, cov_names))))
fit_m1  <- lm(m1_fml, data = df_clean)
smry_m1 <- summary(fit_m1)
path_a1 <- extract_coef(smry_m1, pred_name)
r2_m1   <- smry_m1$r.squared
adj_r2_m1 <- smry_m1$adj.r.squared

# Model 2: M2 ~ X + M1 (+ covariates) — yields path a2 (X->M2) and d21 (M1->M2)
m2_fml  <- as.formula(paste(m2_name, "~", build_rhs(c(pred_name, m1_name, cov_names))))
fit_m2  <- lm(m2_fml, data = df_clean)
smry_m2 <- summary(fit_m2)
path_a2  <- extract_coef(smry_m2, pred_name)   # X -> M2 (controlling for M1)
path_d21 <- extract_coef(smry_m2, m1_name)     # M1 -> M2 (d21)
r2_m2    <- smry_m2$r.squared
adj_r2_m2 <- smry_m2$adj.r.squared

# Model 3: Y ~ X + M1 + M2 (+ covariates) — yields paths b1, b2, c_prime
y_fml   <- as.formula(paste(outcome_name, "~", build_rhs(c(pred_name, m1_name, m2_name, cov_names))))
fit_y   <- lm(y_fml, data = df_clean)
smry_y  <- summary(fit_y)
path_b1      <- extract_coef(smry_y, m1_name)      # M1 -> Y
path_b2      <- extract_coef(smry_y, m2_name)      # M2 -> Y
path_c_prime <- extract_coef(smry_y, pred_name)    # X -> Y | M1, M2 (direct, c')
r2_y    <- smry_y$r.squared
adj_r2_y <- smry_y$adj.r.squared

# Total effect: Y ~ X (+ covariates) — path c
total_fml  <- as.formula(paste(outcome_name, "~", build_rhs(c(pred_name, cov_names))))
fit_total  <- lm(total_fml, data = df_clean)
smry_total <- summary(fit_total)
path_c     <- extract_coef(smry_total, pred_name)

# ---- Point estimates for indirect effects ----

# Specific indirect 1: X -> M1 -> Y  (a1 * b1)
ie_specific1 <- path_a1$coef * path_b1$coef

# Specific indirect 2: X -> M2 -> Y  (a2 * b2)
ie_specific2 <- path_a2$coef * path_b2$coef

# Serial indirect:     X -> M1 -> M2 -> Y  (a1 * d21 * b2)
ie_serial    <- path_a1$coef * path_d21$coef * path_b2$coef

# Total indirect
ie_total_indirect <- ie_specific1 + ie_specific2 + ie_serial

# ---- Bootstrap CI for all indirect effects ----

boot_result <- function(seed_val, path_fn) {
  if (!do_bootstrap) {
    return(list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_))
  }

  set.seed(seed_val)
  boots <- tryCatch({
    local_pred    <- pred_name
    local_m1      <- m1_name
    local_m2      <- m2_name
    local_outcome <- outcome_name
    local_cov     <- cov_names

    fn <- function(data, indices) {
      d <- data[indices, , drop = FALSE]

      fa1 <- tryCatch(lm(as.formula(paste(local_m1, "~",
                    build_rhs(c(local_pred, local_cov)))), data = d), error = function(e) NULL)
      fa2 <- tryCatch(lm(as.formula(paste(local_m2, "~",
                    build_rhs(c(local_pred, local_m1, local_cov)))), data = d), error = function(e) NULL)
      fy  <- tryCatch(lm(as.formula(paste(local_outcome, "~",
                    build_rhs(c(local_pred, local_m1, local_m2, local_cov)))), data = d), error = function(e) NULL)

      if (is.null(fa1) || is.null(fa2) || is.null(fy)) return(NA_real_)

      ca1  <- tryCatch(coef(fa1)[local_pred], error = function(e) NA_real_)
      ca2  <- tryCatch(coef(fa2)[local_pred], error = function(e) NA_real_)
      cd21 <- tryCatch(coef(fa2)[local_m1],   error = function(e) NA_real_)
      cb1  <- tryCatch(coef(fy)[local_m1],    error = function(e) NA_real_)
      cb2  <- tryCatch(coef(fy)[local_m2],    error = function(e) NA_real_)

      path_fn(ca1, ca2, cd21, cb1, cb2)
    }

    if (requireNamespace("boot", quietly = TRUE)) {
      bo <- boot::boot(data = df_clean, statistic = fn, R = n_boot)
      bo$t[, 1]
    } else {
      vapply(seq_len(n_boot), function(i) {
        idx <- sample.int(n, replace = TRUE)
        fn(df_clean, idx)
      }, numeric(1L))
    }
  }, error = function(e) {
    warning(paste0("Bootstrap failed: ", e$message))
    NULL
  })

  if (is.null(boots)) return(list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_))

  valid <- boots[is.finite(boots)]
  if (length(valid) < 10L) return(list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_))

  list(
    boot_se  = sd(valid),
    ci_lower = quantile(valid, alpha_tail,       names = FALSE),
    ci_upper = quantile(valid, 1 - alpha_tail,   names = FALSE)
  )
}

make_indirect <- function(est, ci_info) {
  sig <- if (!is.na(ci_info$ci_lower) && !is.na(ci_info$ci_upper)) {
    !(ci_info$ci_lower <= 0 && ci_info$ci_upper >= 0)
  } else {
    NA
  }
  list(
    effect      = est,
    boot_se     = if (is.na(ci_info$boot_se)) NULL else ci_info$boot_se,
    ci_lower    = if (is.na(ci_info$ci_lower)) NULL else ci_info$ci_lower,
    ci_upper    = if (is.na(ci_info$ci_upper)) NULL else ci_info$ci_upper,
    significant = sig
  )
}

ci_s1 <- boot_result(20240201L, function(ca1, ca2, cd21, cb1, cb2) unname(ca1 * cb1))
ci_s2 <- boot_result(20240202L, function(ca1, ca2, cd21, cb1, cb2) unname(ca2 * cb2))
ci_sr <- boot_result(20240203L, function(ca1, ca2, cd21, cb1, cb2) unname(ca1 * cd21 * cb2))
ci_tt <- boot_result(20240204L, function(ca1, ca2, cd21, cb1, cb2) unname(ca1 * cb1 + ca2 * cb2 + ca1 * cd21 * cb2))

indirect_out <- list(
  specific1 = make_indirect(ie_specific1, ci_s1),
  specific2 = make_indirect(ie_specific2, ci_s2),
  serial    = make_indirect(ie_serial,    ci_sr),
  total     = make_indirect(ie_total_indirect, ci_tt)
)

# ---- Interpretation ----

ci_pct  <- ci_level * 100
method  <- if (do_bootstrap) paste0("bias-corrected bootstrap (B = ", n_boot, ")") else "no bootstrap"

path_descriptions <- c(
  sprintf("Specific 1 (X->M1->Y, a1*b1 = %.4f)", ie_specific1),
  sprintf("Specific 2 (X->M2->Y, a2*b2 = %.4f)", ie_specific2),
  sprintf("Serial (X->M1->M2->Y, a1*d21*b2 = %.4f)", ie_serial)
)

sig_paths <- c(
  if (isTRUE(indirect_out$specific1$significant)) "Specific 1 (X->M1->Y)" else NULL,
  if (isTRUE(indirect_out$specific2$significant)) "Specific 2 (X->M2->Y)" else NULL,
  if (isTRUE(indirect_out$serial$significant))    "Serial (X->M1->M2->Y)" else NULL
)

interp_parts <- c(
  sprintf(
    "Serial mediation analysis (PROCESS Model 6) tested whether '%s' affects '%s' sequentially through '%s' then '%s'.",
    pred_name, outcome_name, m1_name, m2_name
  ),
  sprintf(
    "N = %d complete cases. Three indirect paths estimated via %s at %.0f%% CI: %s.",
    n, method, ci_pct, paste(path_descriptions, collapse = "; ")
  ),
  sprintf(
    "Total indirect effect = %.4f (95%% CI: [%s, %s]).",
    ie_total_indirect,
    if (!is.null(indirect_out$total$ci_lower)) sprintf("%.4f", indirect_out$total$ci_lower) else "NA",
    if (!is.null(indirect_out$total$ci_upper)) sprintf("%.4f", indirect_out$total$ci_upper) else "NA"
  ),
  if (length(sig_paths) == 0) {
    "None of the indirect paths were individually significant."
  } else {
    paste0("Significant indirect paths: ", paste(sig_paths, collapse = "; "), ".")
  }
)

interpretation <- paste(interp_parts, collapse = " ")

# ---- Diagram data ----

na_to_null <- function(x) if (is.na(x)) NULL else x

diagram <- list(
  modelType = "serial-mediation",
  variables = list(
    x  = pred_name,
    y  = outcome_name,
    m1 = m1_name,
    m2 = m2_name
  ),
  coefficients = list(
    a1     = na_to_null(path_a1$coef),      # X -> M1
    a2     = na_to_null(path_d21$coef),     # M1 -> M2 (serial link)
    b1     = na_to_null(path_b1$coef),      # M1 -> Y (direct)
    b2     = na_to_null(path_b2$coef),      # M2 -> Y
    cPrime = na_to_null(path_c_prime$coef)  # X -> Y direct
  ),
  pValues = list(
    a1     = na_to_null(path_a1$p),
    a2     = na_to_null(path_d21$p),
    b1     = na_to_null(path_b1$p),
    b2     = na_to_null(path_b2$p),
    cPrime = na_to_null(path_c_prime$p)
  )
)

# ---- Compose result ----

result <- list(
  n          = n,
  predictor  = pred_name,
  mediator1  = m1_name,
  mediator2  = m2_name,
  outcome    = outcome_name,
  covariates = if (length(cov_names) > 0) cov_names else NULL,
  paths = list(
    a1       = path_a1,      # X -> M1
    a2       = path_a2,      # X -> M2 (controlling for M1)
    d21      = path_d21,     # M1 -> M2
    b1       = path_b1,      # M1 -> Y
    b2       = path_b2,      # M2 -> Y
    c        = path_c,       # X -> Y (total effect)
    c_prime  = path_c_prime  # X -> Y (direct effect, controlling for M1, M2)
  ),
  indirect = indirect_out,
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
  model_summary = list(
    r_squared_m1     = r2_m1,
    adj_r_squared_m1 = adj_r2_m1,
    r_squared_m2     = r2_m2,
    adj_r_squared_m2 = adj_r2_m2,
    r_squared_y      = r2_y,
    adj_r_squared_y  = adj_r2_y
  ),
  standardized   = do_std,
  ci_level       = ci_level,
  n_boot         = if (do_bootstrap) n_boot else NULL,
  interpretation = interpretation,
  diagram        = diagram
)

result
