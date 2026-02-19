# process_model8.R - PROCESS Model 8: Moderated Mediation (W moderates a-path AND c'-path)
#
# Model 8: X -> M -> Y, with W moderating BOTH the X->M path (a-path) AND the X->Y direct path (c'-path)
#
#   Path A model:  M  = a1*X + a2*W + a3*X*W + covariates
#   Path B model:  Y  = b*M  + c1'*X + c2'*W + c3'*X*W + covariates
#
#   Conditional indirect effect at W:  (a1 + a3*W) * b
#   Conditional direct  effect at W:   c1' + c3'*W
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome    : list with one element - column name of the outcome variable (Y)
#   predictor  : list with one element - column name of the predictor variable (X)
#   mediator   : list with one element - column name of the mediator variable (M)
#   moderator  : list with one element - column name of the moderator variable (W)
#   covariates : optional list of column names - covariate(s) to control for
#   options    : optional list with named fields:
#                  bootstrap   : logical (default TRUE)
#                  nBoot       : integer (default 5000)
#                  ciLevel     : numeric in (0,1) (default 0.95)
#                  centering   : character "mean" | "none" (default "mean")
#                  probeValues : character "meanSD" | "percentile" (default "meanSD")
#                  standardize : logical (default FALSE)
#
# Returns `result` list:
#   n                      : integer, number of complete cases
#   predictor              : character
#   mediator               : character
#   moderator              : character
#   outcome                : character
#   covariates             : character vector or NULL
#   centering_applied      : logical
#   path_a_model           : coefficients for M ~ X + W + X*W (+ covariates)
#   path_b_model           : coefficients for Y ~ M + X + W + X*W (+ covariates)
#   conditional_indirect   : list at low/mean/high W
#   conditional_direct     : list at low/mean/high W
#   index_of_moderated_mediation : IMM effect + bootstrap CI
#   model_summary          : R-squared for each model
#   ci_level, n_boot
#   interpretation         : narrative summary
#   diagram                : data for frontend visualization

# ---- Input validation ----

if (!exists("outcome"))   stop("Variable 'outcome' is required")
if (!exists("predictor")) stop("Variable 'predictor' is required")
if (!exists("mediator"))  stop("Variable 'mediator' is required")
if (!exists("moderator")) stop("Variable 'moderator' is required")

# ---- Resolve options ----

do_bootstrap <- TRUE
n_boot       <- 5000L
ci_level     <- 0.95
centering    <- "mean"
probe_opt    <- "meanSD"
do_std       <- FALSE

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
if (exists("centering") && !is.null(centering)) {
  centering <- as.character(if (is.list(centering)) centering[[1]] else centering)
}
if (exists("probeValues") && !is.null(probeValues)) {
  probe_opt <- as.character(if (is.list(probeValues)) probeValues[[1]] else probeValues)
}
if (exists("standardize") && !is.null(standardize)) {
  do_std <- as.logical(if (is.list(standardize)) standardize[[1]] else standardize)
}

# ---- Extract variable names ----

outcome_name <- if (is.list(outcome))   outcome[[1]]   else outcome[1]
pred_name    <- if (is.list(predictor)) predictor[[1]] else predictor[1]
med_name     <- if (is.list(mediator))  mediator[[1]]  else mediator[1]
mod_name     <- if (is.list(moderator)) moderator[[1]] else moderator[1]

for (nm in c(outcome_name, pred_name, med_name, mod_name)) {
  if (!exists(nm)) stop(paste0("Column '", nm, "' not found in data"))
}

cov_names <- character(0)
if (exists("covariates") && !is.null(covariates) && length(covariates) > 0) {
  cov_names <- if (is.list(covariates)) unlist(covariates) else as.character(covariates)
  cov_names <- cov_names[nzchar(cov_names)]
  for (cn in cov_names) {
    if (!exists(cn)) stop(paste0("Covariate column '", cn, "' not found in data"))
  }
}

all_col_names <- unique(c(pred_name, med_name, mod_name, outcome_name, cov_names))

# ---- Build data frame ----

df_list <- list()
for (col in all_col_names) {
  raw <- get(col)
  df_list[[col]] <- as.numeric(if (is.list(raw)) unlist(raw) else raw)
}
df_raw   <- as.data.frame(df_list, stringsAsFactors = FALSE)
df_clean <- df_raw[complete.cases(df_raw), , drop = FALSE]
n        <- nrow(df_clean)

n_min <- length(all_col_names) + 4L
if (n < n_min) {
  stop(paste0(
    "Insufficient complete observations (n = ", n, ") for PROCESS Model 8. ",
    "Need at least ", n_min, " complete cases."
  ))
}

# ---- Standardize if requested ----

if (do_std) {
  df_clean[, all_col_names] <- scale(df_clean[, all_col_names, drop = FALSE])
}

# ---- Mean centering ----

centering_applied <- FALSE
if (tolower(centering) == "mean") {
  centering_applied <- TRUE
  df_clean[[pred_name]] <- df_clean[[pred_name]] - mean(df_clean[[pred_name]])
  df_clean[[mod_name]]  <- df_clean[[mod_name]]  - mean(df_clean[[mod_name]])
}

# ---- Helper functions ----

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

na_to_null <- function(x) if (is.null(x) || (length(x) == 1L && is.na(x))) NULL else x

alpha_tail <- (1 - ci_level) / 2

# ---- Create interaction columns ----

xw_name <- paste0(pred_name, "_x_", mod_name)   # X*W
df_clean[[xw_name]] <- df_clean[[pred_name]] * df_clean[[mod_name]]

# ---- Path A model: M ~ X + W + X*W + covariates ----

a_terms <- c(pred_name, mod_name, xw_name, cov_names)
a_fml   <- as.formula(paste(med_name, "~", build_rhs(a_terms)))
fit_a   <- lm(a_fml, data = df_clean)
smry_a  <- summary(fit_a)

path_a_coefs <- list(
  intercept   = extract_coef(smry_a, "(Intercept)"),
  predictor   = extract_coef(smry_a, pred_name),    # a1
  moderator   = extract_coef(smry_a, mod_name),     # a2
  interaction = extract_coef(smry_a, xw_name)       # a3
)
r2_a     <- smry_a$r.squared
adj_r2_a <- smry_a$adj.r.squared

# ---- Path B model: Y ~ M + X + W + X*W + covariates ----
# b = coef of M; c1' = coef of X; c2' = coef of W; c3' = coef of X*W

b_terms <- c(med_name, pred_name, mod_name, xw_name, cov_names)
b_fml   <- as.formula(paste(outcome_name, "~", build_rhs(b_terms)))
fit_b   <- lm(b_fml, data = df_clean)
smry_b  <- summary(fit_b)

path_b_coefs <- list(
  intercept           = extract_coef(smry_b, "(Intercept)"),
  mediator            = extract_coef(smry_b, med_name),     # b
  predictor           = extract_coef(smry_b, pred_name),    # c1'
  moderator           = extract_coef(smry_b, mod_name),     # c2'
  predictor_x_mod     = extract_coef(smry_b, xw_name)       # c3'
)
r2_b     <- smry_b$r.squared
adj_r2_b <- smry_b$adj.r.squared

# ---- Extract key scalars ----

a1   <- unname(coef(fit_a)[pred_name])   # X coef in M model
a3   <- unname(coef(fit_a)[xw_name])     # X*W coef in M model
b    <- unname(coef(fit_b)[med_name])    # M coef in Y model
c1p  <- unname(coef(fit_b)[pred_name])  # X coef in Y model (c1')
c3p  <- unname(coef(fit_b)[xw_name])    # X*W coef in Y model (c3')

# ---- Probe values for W ----

w_vals <- tryCatch({
  if (probe_opt == "percentile") {
    quantile(df_clean[[mod_name]], probs = c(0.16, 0.50, 0.84), na.rm = TRUE)
  } else {
    w_m  <- mean(df_clean[[mod_name]], na.rm = TRUE)
    w_sd <- sd(df_clean[[mod_name]],   na.rm = TRUE)
    c(low = w_m - w_sd, mean = w_m, high = w_m + w_sd)
  }
}, error = function(e) {
  w_m  <- mean(df_clean[[mod_name]], na.rm = TRUE)
  w_sd <- sd(df_clean[[mod_name]],   na.rm = TRUE)
  c(low = w_m - w_sd, mean = w_m, high = w_m + w_sd)
})

probe_labels <- c("low", "mean", "high")

# ---- Conditional indirect effect function ----
# indirect(W) = (a1 + a3*W) * b

cond_indirect_fn <- function(w_val) {
  (a1 + a3 * w_val) * b
}

# ---- Conditional direct effect function ----
# direct(W) = c1' + c3'*W

cond_direct_fn <- function(w_val) {
  c1p + c3p * w_val
}

# ---- Bootstrap helper ----

run_bootstrap_model8 <- function(w_val, seed_offset = 0L) {
  if (!do_bootstrap) return(list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_))

  set.seed(20240101L + seed_offset)

  local_pred    <- pred_name
  local_med     <- med_name
  local_mod     <- mod_name
  local_outcome <- outcome_name
  local_cov     <- cov_names
  local_xw      <- xw_name
  local_w_val   <- w_val

  boot_fn <- function(data, indices) {
    d <- data[indices, , drop = FALSE]
    d[[local_xw]] <- d[[local_pred]] * d[[local_mod]]

    a_r  <- build_rhs(c(local_pred, local_mod, local_xw, local_cov))
    fa   <- tryCatch(lm(as.formula(paste(local_med, "~", a_r)), data = d), error = function(e) NULL)
    if (is.null(fa)) return(NA_real_)
    ba1  <- tryCatch(coef(fa)[local_pred], error = function(e) NA_real_)
    ba3  <- tryCatch(coef(fa)[local_xw],   error = function(e) NA_real_)

    b_r  <- build_rhs(c(local_med, local_pred, local_mod, local_xw, local_cov))
    fb   <- tryCatch(lm(as.formula(paste(local_outcome, "~", b_r)), data = d), error = function(e) NULL)
    if (is.null(fb)) return(NA_real_)
    bb   <- tryCatch(coef(fb)[local_med],  error = function(e) NA_real_)

    unname((ba1 + ba3 * local_w_val) * bb)
  }

  boot_vals <- tryCatch({
    if (requireNamespace("boot", quietly = TRUE)) {
      bo <- boot::boot(data = df_clean, statistic = boot_fn, R = n_boot)
      bo$t[, 1]
    } else {
      vapply(seq_len(n_boot), function(i) {
        idx <- sample.int(n, replace = TRUE)
        boot_fn(df_clean, idx)
      }, numeric(1L))
    }
  }, error = function(e) {
    warning(paste0("Bootstrap failed at W=", round(w_val, 3), ": ", e$message))
    NULL
  })

  if (!is.null(boot_vals)) {
    valid <- boot_vals[is.finite(boot_vals)]
    if (length(valid) >= 10L) {
      return(list(
        boot_se  = sd(valid),
        ci_lower = quantile(valid, alpha_tail,       names = FALSE),
        ci_upper = quantile(valid, 1 - alpha_tail,   names = FALSE)
      ))
    }
  }
  list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_)
}

# ---- Compute conditional indirect effects ----

cond_indirect_out <- vector("list", 3)
names(cond_indirect_out) <- probe_labels

for (i in seq_along(probe_labels)) {
  w_val   <- unname(w_vals[i])
  ie_est  <- cond_indirect_fn(w_val)
  ci_info <- run_bootstrap_model8(w_val, seed_offset = as.integer(i))

  sig <- if (!is.na(ci_info$ci_lower) && !is.na(ci_info$ci_upper)) {
    !(ci_info$ci_lower <= 0 && ci_info$ci_upper >= 0)
  } else {
    NA
  }

  cond_indirect_out[[probe_labels[i]]] <- list(
    w_value     = w_val,
    w_label     = probe_labels[i],
    effect      = ie_est,
    boot_se     = na_to_null(ci_info$boot_se),
    ci_lower    = na_to_null(ci_info$ci_lower),
    ci_upper    = na_to_null(ci_info$ci_upper),
    significant = sig
  )
}

# ---- Compute conditional direct effects (no bootstrap needed - from regression) ----

cond_direct_out <- vector("list", 3)
names(cond_direct_out) <- probe_labels

for (i in seq_along(probe_labels)) {
  w_val  <- unname(w_vals[i])
  de_est <- cond_direct_fn(w_val)

  # SE of conditional direct effect: sqrt(Var(c1') + w^2*Var(c3') + 2w*Cov(c1',c3'))
  vcov_b  <- vcov(fit_b)
  idx_c1p <- which(names(coef(fit_b)) == pred_name)
  idx_c3p <- which(names(coef(fit_b)) == xw_name)
  de_se   <- tryCatch({
    v_c1p <- vcov_b[idx_c1p, idx_c1p]
    v_c3p <- vcov_b[idx_c3p, idx_c3p]
    cov_c  <- vcov_b[idx_c1p, idx_c3p]
    sqrt(v_c1p + w_val^2 * v_c3p + 2 * w_val * cov_c)
  }, error = function(e) NA_real_)

  de_t <- if (!is.na(de_se) && de_se > 0) de_est / de_se else NA_real_
  de_p <- if (!is.na(de_t)) 2 * pt(-abs(de_t), df = n - length(coef(fit_b))) else NA_real_

  cond_direct_out[[probe_labels[i]]] <- list(
    w_value = w_val,
    w_label = probe_labels[i],
    effect  = de_est,
    se      = na_to_null(de_se),
    t       = na_to_null(de_t),
    p       = na_to_null(de_p)
  )
}

# ---- Index of Moderated Mediation (IMM) ----
# IMM = a3 * b  (the slope of the indirect effect as a function of W)

imm_est      <- a3 * b
imm_boot_se  <- NA_real_
imm_ci_lower <- NA_real_
imm_ci_upper <- NA_real_

if (do_bootstrap) {
  set.seed(20240110L)

  local_pred    <- pred_name
  local_med     <- med_name
  local_mod     <- mod_name
  local_outcome <- outcome_name
  local_cov     <- cov_names
  local_xw      <- xw_name

  imm_fn <- function(data, indices) {
    d <- data[indices, , drop = FALSE]
    d[[local_xw]] <- d[[local_pred]] * d[[local_mod]]

    a_r  <- build_rhs(c(local_pred, local_mod, local_xw, local_cov))
    fa   <- tryCatch(lm(as.formula(paste(local_med, "~", a_r)), data = d), error = function(e) NULL)
    if (is.null(fa)) return(NA_real_)
    ba3  <- tryCatch(coef(fa)[local_xw], error = function(e) NA_real_)

    b_r  <- build_rhs(c(local_med, local_pred, local_mod, local_xw, local_cov))
    fb   <- tryCatch(lm(as.formula(paste(local_outcome, "~", b_r)), data = d), error = function(e) NULL)
    if (is.null(fb)) return(NA_real_)
    bb   <- tryCatch(coef(fb)[local_med], error = function(e) NA_real_)

    unname(ba3 * bb)
  }

  imm_boots <- tryCatch({
    if (requireNamespace("boot", quietly = TRUE)) {
      bo_imm <- boot::boot(data = df_clean, statistic = imm_fn, R = n_boot)
      bo_imm$t[, 1]
    } else {
      vapply(seq_len(n_boot), function(i) {
        idx <- sample.int(n, replace = TRUE)
        imm_fn(df_clean, idx)
      }, numeric(1L))
    }
  }, error = function(e) {
    warning(paste0("IMM bootstrap failed: ", e$message))
    NULL
  })

  if (!is.null(imm_boots)) {
    valid_imm <- imm_boots[is.finite(imm_boots)]
    if (length(valid_imm) >= 10L) {
      imm_boot_se  <- sd(valid_imm)
      imm_ci_lower <- quantile(valid_imm, alpha_tail,       names = FALSE)
      imm_ci_upper <- quantile(valid_imm, 1 - alpha_tail,   names = FALSE)
    }
  }
}

imm_sig <- if (!is.na(imm_ci_lower) && !is.na(imm_ci_upper)) {
  !(imm_ci_lower <= 0 && imm_ci_upper >= 0)
} else {
  NA
}

# ---- Interpretation ----

ci_pct  <- ci_level * 100
method  <- if (do_bootstrap) paste0("bias-corrected bootstrap (B = ", n_boot, ")") else "no bootstrap"

sig_w_labels <- probe_labels[vapply(probe_labels, function(lbl) {
  isTRUE(cond_indirect_out[[lbl]]$significant)
}, logical(1L))]

interp_parts <- c(
  sprintf(
    "PROCESS Model 8 moderated mediation tested whether the indirect effect of '%s' on '%s' through '%s' was moderated by '%s', with '%s' also moderating the direct effect.",
    pred_name, outcome_name, med_name, mod_name, mod_name
  ),
  sprintf(
    "N = %d complete cases. Conditional indirect effects estimated via %s at %.0f%% CI.",
    n, method, ci_pct
  ),
  if (length(sig_w_labels) == 0) {
    "None of the conditional indirect effects were significant."
  } else {
    sprintf(
      "Significant conditional indirect effects at %s W value(s): %s.",
      length(sig_w_labels), paste(sig_w_labels, collapse = ", ")
    )
  },
  if (!is.na(imm_sig)) {
    sprintf(
      "Index of moderated mediation = %.4f; %s CI [%.4f, %.4f]; %s.",
      imm_est,
      paste0(ci_pct, "%"),
      if (is.na(imm_ci_lower)) NA else imm_ci_lower,
      if (is.na(imm_ci_upper)) NA else imm_ci_upper,
      if (isTRUE(imm_sig)) "significant" else "not significant"
    )
  } else NULL
)

interpretation <- paste(interp_parts[!sapply(interp_parts, is.null)], collapse = " ")

# ---- Diagram data for frontend visualization ----

diagram <- list(
  modelType = "process-model-8",
  variables = list(
    x = pred_name,
    y = outcome_name,
    m = med_name,
    w = mod_name
  ),
  coefficients = list(
    a1          = na_to_null(path_a_coefs$predictor$coef),
    a2          = na_to_null(path_a_coefs$moderator$coef),
    a3          = na_to_null(path_a_coefs$interaction$coef),
    b           = na_to_null(path_b_coefs$mediator$coef),
    c1Prime     = na_to_null(path_b_coefs$predictor$coef),
    c2Prime     = na_to_null(path_b_coefs$moderator$coef),
    c3Prime     = na_to_null(path_b_coefs$predictor_x_mod$coef)
  ),
  pValues = list(
    a1          = na_to_null(path_a_coefs$predictor$p),
    a2          = na_to_null(path_a_coefs$moderator$p),
    a3          = na_to_null(path_a_coefs$interaction$p),
    b           = na_to_null(path_b_coefs$mediator$p),
    c1Prime     = na_to_null(path_b_coefs$predictor$p),
    c2Prime     = na_to_null(path_b_coefs$moderator$p),
    c3Prime     = na_to_null(path_b_coefs$predictor_x_mod$p)
  ),
  conditionalIndirect = lapply(cond_indirect_out, function(x) list(
    w       = x$w_value,
    label   = x$w_label,
    effect  = x$effect,
    ciLower = x$ci_lower,
    ciUpper = x$ci_upper
  )),
  conditionalDirect = lapply(cond_direct_out, function(x) list(
    w      = x$w_value,
    label  = x$w_label,
    effect = x$effect
  ))
)

# ---- Compose result ----

result <- list(
  n                    = n,
  model_number         = 8L,
  predictor            = pred_name,
  mediator             = med_name,
  moderator            = mod_name,
  outcome              = outcome_name,
  covariates           = if (length(cov_names) > 0) cov_names else NULL,
  centering_applied    = centering_applied,
  path_a_model = list(
    formula       = deparse(a_fml),
    coefficients  = path_a_coefs,
    r_squared     = r2_a,
    adj_r_squared = adj_r2_a
  ),
  path_b_model = list(
    formula       = deparse(b_fml),
    coefficients  = path_b_coefs,
    r_squared     = r2_b,
    adj_r_squared = adj_r2_b
  ),
  conditional_indirect = cond_indirect_out,
  conditional_direct   = cond_direct_out,
  index_of_moderated_mediation = list(
    effect      = imm_est,
    boot_se     = na_to_null(imm_boot_se),
    ci_lower    = na_to_null(imm_ci_lower),
    ci_upper    = na_to_null(imm_ci_upper),
    significant = imm_sig
  ),
  model_summary = list(
    r_squared_a     = r2_a,
    adj_r_squared_a = adj_r2_a,
    r_squared_b     = r2_b,
    adj_r_squared_b = adj_r2_b
  ),
  ci_level       = ci_level,
  n_boot         = if (do_bootstrap) n_boot else NULL,
  interpretation = interpretation,
  diagram        = diagram
)

result
