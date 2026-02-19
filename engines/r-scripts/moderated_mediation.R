# moderated_mediation.R - Moderated Mediation Analysis (PROCESS Model 7/14 style)
#
# Model 7: X -> M -> Y, with W moderating the X -> M path (first-stage moderation)
# Model 14: X -> M -> Y, with W moderating the M -> Y path (second-stage moderation)
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome    : list with one element - column name of the outcome variable (Y)
#   predictor  : list with one element - column name of the predictor variable (X)
#   mediator   : list with one element - column name of the mediator variable (M)
#   moderator  : list with one element - column name of the moderator variable (W)
#   covariates : optional list of column names - covariate(s) to control for
#   options    : optional list with named fields:
#                  model         : character "7" (first-stage) or "14" (second-stage), default "7"
#                  bootstrap     : logical, use bootstrapping for indirect CI (default TRUE)
#                  nBoot         : integer, number of bootstrap samples (default 5000)
#                  ciLevel       : numeric in (0,1), CI width (default 0.95)
#                  centering     : character "mean" | "none" (default "mean")
#                  probeValues   : character "meanSD" | "percentile" (default "meanSD")
#                  standardize   : logical, standardize variables before analysis (default FALSE)
#
# Returns `result` list:
#   n                  : integer, number of complete cases
#   model_type         : character "7" or "14"
#   predictor          : character
#   mediator           : character
#   moderator          : character
#   outcome            : character
#   covariates         : character vector or NULL
#   centering_applied  : logical
#   path_a_model       : model coefficients for M ~ X + W + X*W (+ covariates)
#   path_b_model       : model coefficients for Y ~ X + M + W (+ interaction for model 14) (+ covariates)
#   conditional_indirect : list of conditional indirect effects at W probe values
#   index_of_moderated_mediation : effect, boot_se, ci_lower, ci_upper, significant
#   direct             : direct effect of X on Y
#   model_summary      : R-squared for each model
#   ci_level           : numeric
#   n_boot             : integer or NULL
#   interpretation     : character, narrative summary
#
# Dependencies: none beyond base R

# ---- Input validation ----

if (!exists("outcome"))   stop("Variable 'outcome' is required")
if (!exists("predictor")) stop("Variable 'predictor' is required")
if (!exists("mediator"))  stop("Variable 'mediator' is required")
if (!exists("moderator")) stop("Variable 'moderator' is required")

# ---- Resolve options ----

model_type    <- "7"
do_bootstrap  <- TRUE
n_boot        <- 5000L
ci_level      <- 0.95
centering     <- "mean"
probe_opt     <- "meanSD"
do_std        <- FALSE

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("model") && !is.null(model)) {
  model_type <- as.character(if (is.list(model)) model[[1]] else model)
  if (!model_type %in% c("7", "14")) model_type <- "7"
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

outcome_name  <- if (is.list(outcome))   outcome[[1]]   else outcome[1]
pred_name     <- if (is.list(predictor)) predictor[[1]] else predictor[1]
med_name      <- if (is.list(mediator))  mediator[[1]]  else mediator[1]
mod_name      <- if (is.list(moderator)) moderator[[1]] else moderator[1]

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

n_min <- length(all_col_names) + 3L
if (n < n_min) {
  stop(paste0(
    "Insufficient complete observations (n = ", n, ") for moderated mediation. ",
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

# ---- Interaction column names ----

xw_name <- paste0(pred_name, "_x_", mod_name)   # X*W (used in path a for model 7)
mw_name <- paste0(med_name,  "_x_", mod_name)   # M*W (used in path b for model 14)

df_clean[[xw_name]] <- df_clean[[pred_name]] * df_clean[[mod_name]]
df_clean[[mw_name]] <- df_clean[[med_name]]  * df_clean[[mod_name]]

# ---- Path A model: M ~ X + W + X*W (+ covariates) ----

# Model 7: interaction on X -> M path; Model 14: no interaction on X -> M path
if (model_type == "7") {
  a_terms <- c(pred_name, mod_name, xw_name, cov_names)
} else {
  a_terms <- c(pred_name, mod_name, cov_names)
}

a_fml  <- as.formula(paste(med_name, "~", build_rhs(a_terms)))
fit_a  <- lm(a_fml, data = df_clean)
smry_a <- summary(fit_a)

path_a_coefs <- list(
  intercept   = extract_coef(smry_a, "(Intercept)"),
  predictor   = extract_coef(smry_a, pred_name),
  moderator   = extract_coef(smry_a, mod_name),
  interaction = if (model_type == "7") extract_coef(smry_a, xw_name) else NULL
)
r2_a       <- smry_a$r.squared
adj_r2_a   <- smry_a$adj.r.squared

# ---- Path B model: Y ~ X + M + W (+ M*W for model 14) (+ covariates) ----

if (model_type == "14") {
  b_terms <- c(pred_name, med_name, mod_name, mw_name, cov_names)
} else {
  b_terms <- c(pred_name, med_name, mod_name, cov_names)
}

b_fml  <- as.formula(paste(outcome_name, "~", build_rhs(b_terms)))
fit_b  <- lm(b_fml, data = df_clean)
smry_b <- summary(fit_b)

path_b_coefs <- list(
  intercept   = extract_coef(smry_b, "(Intercept)"),
  predictor   = extract_coef(smry_b, pred_name),
  mediator    = extract_coef(smry_b, med_name),
  moderator   = extract_coef(smry_b, mod_name),
  interaction = if (model_type == "14") extract_coef(smry_b, mw_name) else NULL
)
r2_b       <- smry_b$r.squared
adj_r2_b   <- smry_b$adj.r.squared

# Direct effect: coefficient of X in path B model
direct_eff <- extract_coef(smry_b, pred_name)

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

# ---- Compute conditional indirect effects at each W value ----
#
# Model 7: a(W) = b_x + b_xw * W;  b = fixed (coef of M in Y model)
#          indirect(W) = a(W) * b
#
# Model 14: a = fixed (coef of X in M model);  b(W) = b_m + b_mw * W
#           indirect(W) = a * b(W)

b_x_in_a  <- unname(coef(fit_a)[pred_name])
b_xw      <- if (model_type == "7") unname(coef(fit_a)[xw_name]) else 0
b_m_in_b  <- unname(coef(fit_b)[med_name])
b_mw      <- if (model_type == "14") unname(coef(fit_b)[mw_name]) else 0

cond_indirect_fn <- function(w_val) {
  if (model_type == "7") {
    a_w <- b_x_in_a + b_xw * w_val
    b_w <- b_m_in_b
  } else {
    a_w <- b_x_in_a
    b_w <- b_m_in_b + b_mw * w_val
  }
  a_w * b_w
}

# ---- Bootstrap CI for conditional indirect effects ----

run_bootstrap <- function(w_val, seed_offset = 0L) {
  boot_se  <- NA_real_
  ci_lower <- NA_real_
  ci_upper <- NA_real_

  if (!do_bootstrap) return(list(boot_se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_))

  set.seed(20240101L + seed_offset)
  boot_vals <- tryCatch({
    local_pred     <- pred_name
    local_med      <- med_name
    local_mod      <- mod_name
    local_outcome  <- outcome_name
    local_cov      <- cov_names
    local_model    <- model_type
    local_xw       <- xw_name
    local_mw       <- mw_name
    local_w_val    <- w_val

    boot_fn <- function(data, indices) {
      d <- data[indices, , drop = FALSE]
      # Recreate interaction columns on bootstrapped data
      d[[local_xw]] <- d[[local_pred]] * d[[local_mod]]
      d[[local_mw]] <- d[[local_med]]  * d[[local_mod]]

      if (local_model == "7") {
        a_r <- build_rhs(c(local_pred, local_mod, local_xw, local_cov))
      } else {
        a_r <- build_rhs(c(local_pred, local_mod, local_cov))
      }
      fa <- tryCatch(lm(as.formula(paste(local_med, "~", a_r)), data = d), error = function(e) NULL)
      if (is.null(fa)) return(NA_real_)
      bxa <- tryCatch(coef(fa)[local_pred], error = function(e) NA_real_)
      bxwa <- if (local_model == "7") tryCatch(coef(fa)[local_xw], error = function(e) NA_real_) else 0

      if (local_model == "14") {
        b_r <- build_rhs(c(local_pred, local_med, local_mod, local_mw, local_cov))
      } else {
        b_r <- build_rhs(c(local_pred, local_med, local_mod, local_cov))
      }
      fb <- tryCatch(lm(as.formula(paste(local_outcome, "~", b_r)), data = d), error = function(e) NULL)
      if (is.null(fb)) return(NA_real_)
      bmb <- tryCatch(coef(fb)[local_med], error = function(e) NA_real_)
      bmwb <- if (local_model == "14") tryCatch(coef(fb)[local_mw], error = function(e) NA_real_) else 0

      if (local_model == "7") {
        a_w <- bxa + bxwa * local_w_val
        b_w <- bmb
      } else {
        a_w <- bxa
        b_w <- bmb + bmwb * local_w_val
      }
      unname(a_w * b_w)
    }

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
      boot_se  <- sd(valid)
      ci_lower <- quantile(valid, alpha_tail,       names = FALSE)
      ci_upper <- quantile(valid, 1 - alpha_tail,   names = FALSE)
    }
  }
  list(boot_se = boot_se, ci_lower = ci_lower, ci_upper = ci_upper)
}

cond_indirect_out <- vector("list", 3)
names(cond_indirect_out) <- probe_labels

for (i in seq_along(probe_labels)) {
  w_val   <- unname(w_vals[i])
  ie_est  <- cond_indirect_fn(w_val)
  ci_info <- run_bootstrap(w_val, seed_offset = as.integer(i))

  sig <- if (!is.na(ci_info$ci_lower) && !is.na(ci_info$ci_upper)) {
    !(ci_info$ci_lower <= 0 && ci_info$ci_upper >= 0)
  } else {
    NA
  }

  cond_indirect_out[[probe_labels[i]]] <- list(
    w_value     = w_val,
    w_label     = probe_labels[i],
    effect      = ie_est,
    boot_se     = if (is.na(ci_info$boot_se)) NULL else ci_info$boot_se,
    ci_lower    = if (is.na(ci_info$ci_lower)) NULL else ci_info$ci_lower,
    ci_upper    = if (is.na(ci_info$ci_upper)) NULL else ci_info$ci_upper,
    significant = sig
  )
}

# ---- Index of Moderated Mediation (IMM) ----
#
# For Model 7: IMM = b_xw * b_m  (product of interaction coef on a-path and b coef)
# For Model 14: IMM = b_x_a * b_mw  (product of a coef and interaction coef on b-path)
# Bootstrap CI for IMM

imm_est <- if (model_type == "7") b_xw * b_m_in_b else b_x_in_a * b_mw

imm_boot_se  <- NA_real_
imm_ci_lower <- NA_real_
imm_ci_upper <- NA_real_

if (do_bootstrap) {
  set.seed(20240110L)
  imm_boots <- tryCatch({
    local_pred    <- pred_name
    local_med     <- med_name
    local_mod     <- mod_name
    local_outcome <- outcome_name
    local_cov     <- cov_names
    local_model   <- model_type
    local_xw      <- xw_name
    local_mw      <- mw_name

    imm_fn <- function(data, indices) {
      d <- data[indices, , drop = FALSE]
      d[[local_xw]] <- d[[local_pred]] * d[[local_mod]]
      d[[local_mw]] <- d[[local_med]]  * d[[local_mod]]

      if (local_model == "7") {
        a_r <- build_rhs(c(local_pred, local_mod, local_xw, local_cov))
      } else {
        a_r <- build_rhs(c(local_pred, local_mod, local_cov))
      }
      fa <- tryCatch(lm(as.formula(paste(local_med, "~", a_r)), data = d), error = function(e) NULL)
      if (is.null(fa)) return(NA_real_)

      if (local_model == "14") {
        b_r <- build_rhs(c(local_pred, local_med, local_mod, local_mw, local_cov))
      } else {
        b_r <- build_rhs(c(local_pred, local_med, local_mod, local_cov))
      }
      fb <- tryCatch(lm(as.formula(paste(local_outcome, "~", b_r)), data = d), error = function(e) NULL)
      if (is.null(fb)) return(NA_real_)

      if (local_model == "7") {
        bxw_b <- tryCatch(coef(fa)[local_xw], error = function(e) NA_real_)
        bm_b  <- tryCatch(coef(fb)[local_med], error = function(e) NA_real_)
        unname(bxw_b * bm_b)
      } else {
        bx_b  <- tryCatch(coef(fa)[local_pred], error = function(e) NA_real_)
        bmw_b <- tryCatch(coef(fb)[local_mw],   error = function(e) NA_real_)
        unname(bx_b * bmw_b)
      }
    }

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

model_label <- if (model_type == "7") {
  paste0("Model 7 (", mod_name, " moderates ", pred_name, " -> ", med_name, " path)")
} else {
  paste0("Model 14 (", mod_name, " moderates ", med_name, " -> ", outcome_name, " path)")
}

sig_w_labels <- probe_labels[vapply(probe_labels, function(lbl) isTRUE(cond_indirect_out[[lbl]]$significant), logical(1L))]

interp_parts <- c(
  sprintf(
    "Moderated mediation analysis (%s) tested whether the indirect effect of '%s' on '%s' through '%s' was moderated by '%s'.",
    model_label, pred_name, outcome_name, med_name, mod_name
  ),
  sprintf(
    "N = %d complete cases. Conditional indirect effects estimated via %s at %.0f%% CI.",
    n, method, ci_pct
  ),
  if (length(sig_w_labels) == 0) {
    "None of the conditional indirect effects were significant."
  } else {
    sprintf(
      "Significant conditional indirect effects at %s W values: %s.",
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
  } else {
    NULL
  }
)

interpretation <- paste(interp_parts[!sapply(interp_parts, is.null)], collapse = " ")

# ---- Diagram data for frontend visualization ----

na_to_null <- function(x) if (is.null(x) || (length(x) == 1L && is.na(x))) NULL else x

a_path_coef        <- path_a_coefs$predictor$coef
a_path_p           <- path_a_coefs$predictor$p
b_path_coef        <- path_b_coefs$mediator$coef
b_path_p           <- path_b_coefs$mediator$p
direct_effect_coef <- direct_eff$coef
direct_effect_p    <- direct_eff$p

if (model_type == "7") {
  interaction_coef <- if (!is.null(path_a_coefs$interaction)) path_a_coefs$interaction$coef else NA_real_
  interaction_p    <- if (!is.null(path_a_coefs$interaction)) path_a_coefs$interaction$p    else NA_real_
} else {
  interaction_coef <- if (!is.null(path_b_coefs$interaction)) path_b_coefs$interaction$coef else NA_real_
  interaction_p    <- if (!is.null(path_b_coefs$interaction)) path_b_coefs$interaction$p    else NA_real_
}

diagram <- list(
  modelType = "moderated-mediation",
  variables = list(
    x = pred_name,
    y = outcome_name,
    m = med_name,
    w = mod_name
  ),
  coefficients = list(
    a           = na_to_null(a_path_coef),
    b           = na_to_null(b_path_coef),
    cPrime      = na_to_null(direct_effect_coef),
    interaction = na_to_null(interaction_coef)
  ),
  pValues = list(
    a           = na_to_null(a_path_p),
    b           = na_to_null(b_path_p),
    cPrime      = na_to_null(direct_effect_p),
    interaction = na_to_null(interaction_p)
  )
)

# ---- Compose result ----

result <- list(
  n                  = n,
  model_type         = model_type,
  predictor          = pred_name,
  mediator           = med_name,
  moderator          = mod_name,
  outcome            = outcome_name,
  covariates         = if (length(cov_names) > 0) cov_names else NULL,
  centering_applied  = centering_applied,
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
  index_of_moderated_mediation = list(
    effect      = imm_est,
    boot_se     = if (is.na(imm_boot_se)) NULL else imm_boot_se,
    ci_lower    = if (is.na(imm_ci_lower)) NULL else imm_ci_lower,
    ci_upper    = if (is.na(imm_ci_upper)) NULL else imm_ci_upper,
    significant = imm_sig
  ),
  direct = list(
    effect = direct_eff$coef,
    se     = direct_eff$se,
    t      = direct_eff$t,
    p      = direct_eff$p
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
