# multilevel.R - Hierarchical Linear Modeling (HLM) / Multilevel Analysis for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome      : list with one element - column name of the Level-1 outcome variable
#   groupVar     : list with one element - column name of the Level-2 grouping variable
#   level1Preds  : list of column names - Level-1 predictor variable names (may be empty)
#   level2Preds  : list of column names - Level-2 predictor variable names (may be empty)
#   options      : list with optional named fields:
#                    modelType        : character - "null", "random-intercept", "random-slope",
#                                       "cross-level" (default "random-intercept")
#                    centering        : character - "none", "grand-mean", "group-mean"
#                                       (default "none")
#                    randomSlopes     : list of column names to include random slopes for
#                                       (default same as level1Preds)
#                    reml             : logical - use REML estimation (default TRUE)
#                    confidenceLevel  : numeric in (0,1) (default 0.95)
#                    compareModels    : logical - fit and compare null + full models (default TRUE)
#   alpha        : numeric - significance level (default 0.05)
#
# Returns a named list with:
#   model_type, formula_str, n, n_groups, n_level2,
#   icc, variance_components (between/within),
#   fixed_effects (data frame: term, estimate, std_error, t_value, df, p_value, ci_lower, ci_upper),
#   random_effects (list of variance/sd per random term),
#   model_fit (AIC, BIC, logLik, deviance),
#   null_model_fit (if compareModels = TRUE),
#   lrt_result (likelihood ratio test if compareModels = TRUE),
#   interpretation

# ---- Check required packages ----

if (!requireNamespace("lme4", quietly = TRUE)) {
  stop("Package 'lme4' is required. Install with: install.packages('lme4')")
}
if (!requireNamespace("lmerTest", quietly = TRUE)) {
  # lmerTest provides df and p-values for fixed effects via Satterthwaite approximation
  # Fall back gracefully if not available
  has_lmerTest <- FALSE
} else {
  has_lmerTest <- TRUE
}

# Do not attach packages to the global namespace; use namespace-qualified calls instead.

# ---- Validate required inputs ----

if (!exists("outcome"))  stop("Variable 'outcome' is required")
if (!exists("groupVar")) stop("Variable 'groupVar' is required")
if (!exists("alpha"))    alpha <- 0.05

# ---- Resolve options ----

model_type      <- "random-intercept"
centering       <- "none"
random_slopes   <- NULL   # will default to level1Preds after extraction
use_reml        <- TRUE
confidence_level <- 0.95
compare_models  <- TRUE

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("modelType") && !is.null(modelType))             model_type       <- as.character(if (is.list(modelType)) modelType[[1]] else modelType)
if (exists("centering") && !is.null(centering))             centering        <- as.character(if (is.list(centering)) centering[[1]] else centering)
if (exists("randomSlopes") && !is.null(randomSlopes))       random_slopes    <- unlist(randomSlopes)
if (exists("reml") && !is.null(reml))                       use_reml         <- as.logical(if (is.list(reml)) reml[[1]] else reml)
if (exists("confidenceLevel") && !is.null(confidenceLevel)) confidence_level <- as.numeric(if (is.list(confidenceLevel)) confidenceLevel[[1]] else confidenceLevel)
if (exists("compareModels") && !is.null(compareModels))     compare_models   <- as.logical(if (is.list(compareModels)) compareModels[[1]] else compareModels)

# ---- Extract column names ----

outcome_name <- if (is.list(outcome)) outcome[[1]] else outcome[1]
if (!exists(outcome_name)) stop(paste0("Column '", outcome_name, "' not found in data"))

group_name <- if (is.list(groupVar)) groupVar[[1]] else groupVar[1]
if (!exists(group_name)) stop(paste0("Column '", group_name, "' not found in data"))

# Level-1 predictors
if (!exists("level1Preds") || is.null(level1Preds)) {
  l1_names <- character(0)
} else {
  l1_names <- unlist(level1Preds)
}

for (nm in l1_names) {
  if (!exists(nm)) stop(paste0("Level-1 predictor '", nm, "' not found in data"))
}

# Level-2 predictors
if (!exists("level2Preds") || is.null(level2Preds)) {
  l2_names <- character(0)
} else {
  l2_names <- unlist(level2Preds)
}

for (nm in l2_names) {
  if (!exists(nm)) stop(paste0("Level-2 predictor '", nm, "' not found in data"))
}

# Default random slopes = all level-1 predictors
if (is.null(random_slopes)) {
  random_slopes <- l1_names
}

# ---- Build data frame ----

all_vars <- unique(c(outcome_name, group_name, l1_names, l2_names))
df_data <- data.frame(stringsAsFactors = FALSE)

for (nm in all_vars) {
  raw_col <- get(nm)
  if (nm == group_name) {
    # Keep grouping variable as character/factor
    df_data[[nm]] <- as.character(if (is.list(raw_col)) unlist(raw_col) else raw_col)
  } else {
    df_data[[nm]] <- as.numeric(if (is.list(raw_col)) unlist(raw_col) else raw_col)
  }
}

# Convert group to factor
df_data[[group_name]] <- as.factor(df_data[[group_name]])

# Listwise deletion
df_clean <- df_data[complete.cases(df_data), ]
n        <- nrow(df_clean)
n_groups <- nlevels(df_clean[[group_name]])

if (n < 10) stop(paste0("Insufficient complete observations (n = ", n, ") for multilevel analysis."))
if (n_groups < 2) stop("Grouping variable must have at least 2 groups.")

# ---- Centering ----

centered_vars <- list()

if (centering != "none" && length(l1_names) > 0) {
  for (nm in l1_names) {
    if (centering == "grand-mean") {
      gm <- mean(df_clean[[nm]], na.rm = TRUE)
      df_clean[[paste0(nm, "_c")]] <- df_clean[[nm]] - gm
      centered_vars[[nm]] <- list(method = "grand-mean", center = gm)
    } else if (centering == "group-mean") {
      group_means <- tapply(df_clean[[nm]], df_clean[[group_name]], mean, na.rm = TRUE)
      df_clean[[paste0(nm, "_c")]] <- df_clean[[nm]] - group_means[df_clean[[group_name]]]
      centered_vars[[nm]] <- list(method = "group-mean", center = as.list(group_means))
    }
  }
  # Replace predictor names with centered versions
  l1_names_model <- paste0(l1_names, "_c")
  if (length(random_slopes) > 0) {
    random_slopes_model <- paste0(random_slopes, "_c")
  } else {
    random_slopes_model <- character(0)
  }
} else {
  l1_names_model <- l1_names
  random_slopes_model <- random_slopes
}

# ---- Build formula ----

# Fixed effects part
fixed_preds <- c(l1_names_model, l2_names)

# Cross-level interactions: each l1 pred x each l2 pred
cross_level_terms <- character(0)
if (model_type == "cross-level" && length(l1_names_model) > 0 && length(l2_names) > 0) {
  for (l1p in l1_names_model) {
    for (l2p in l2_names) {
      cross_level_terms <- c(cross_level_terms, paste0(l1p, ":", l2p))
    }
  }
}

all_fixed <- unique(c(fixed_preds, cross_level_terms))
fixed_rhs <- if (length(all_fixed) > 0) paste(all_fixed, collapse = " + ") else "1"

# Random effects part
random_part <- switch(
  model_type,
  "null" = paste0("(1|", group_name, ")"),
  "random-intercept" = paste0("(1|", group_name, ")"),
  "random-slope" = {
    if (length(random_slopes_model) > 0) {
      slope_str <- paste(random_slopes_model, collapse = " + ")
      paste0("(", slope_str, "|", group_name, ")")
    } else {
      paste0("(1|", group_name, ")")
    }
  },
  "cross-level" = {
    if (length(random_slopes_model) > 0) {
      slope_str <- paste(random_slopes_model, collapse = " + ")
      paste0("(", slope_str, "|", group_name, ")")
    } else {
      paste0("(1|", group_name, ")")
    }
  },
  paste0("(1|", group_name, ")")
)

# Override fixed for null model
if (model_type == "null") {
  fixed_rhs <- "1"
  all_fixed <- character(0)
}

formula_str <- paste0(outcome_name, " ~ ", fixed_rhs, " + ", random_part)
model_formula <- as.formula(formula_str)

# ---- Fit model ----

fit <- tryCatch(
  if (has_lmerTest) {
    lmerTest::lmer(model_formula, data = df_clean, REML = use_reml)
  } else {
    lme4::lmer(model_formula, data = df_clean, REML = use_reml)
  },
  error = function(e) stop(paste0("Model fitting failed: ", conditionMessage(e)))
)

# Check convergence
conv_warnings <- fit@optinfo$conv$lme4$messages
converged <- is.null(conv_warnings) || length(conv_warnings) == 0

# ---- Null model for ICC and model comparison ----

null_formula_str  <- paste0(outcome_name, " ~ 1 + (1|", group_name, ")")
null_model_formula <- as.formula(null_formula_str)

fit_null <- tryCatch(
  lme4::lmer(null_model_formula, data = df_clean, REML = FALSE),
  error = function(e) NULL
)

# ---- ICC from null model ----

icc_value <- NA
var_between <- NA
var_within  <- NA

if (!is.null(fit_null)) {
  vc_null <- as.data.frame(lme4::VarCorr(fit_null))
  tau00   <- vc_null$vcov[vc_null$grp == group_name & is.na(vc_null$var2)]
  sigma2  <- attr(lme4::VarCorr(fit_null), "sc")^2
  if (length(tau00) > 0 && !is.na(tau00)) {
    var_between <- tau00
    var_within  <- sigma2
    icc_value   <- tau00 / (tau00 + sigma2)
  }
}

# ---- Fixed effects table ----

smry <- summary(fit)
coef_mat <- coef(smry)

if (has_lmerTest && inherits(fit, "lmerModLmerTest")) {
  # lmerTest adds df column and p-value
  term_names <- rownames(coef_mat)
  est  <- coef_mat[, "Estimate"]
  se   <- coef_mat[, "Std. Error"]
  tv   <- coef_mat[, "t value"]
  df_v <- if ("df" %in% colnames(coef_mat)) coef_mat[, "df"] else rep(NA_real_, length(est))
  pv   <- if ("Pr(>|t|)" %in% colnames(coef_mat)) coef_mat[, "Pr(>|t|)"] else rep(NA_real_, length(est))
} else {
  term_names <- rownames(coef_mat)
  est  <- coef_mat[, "Estimate"]
  se   <- coef_mat[, "Std. Error"]
  tv   <- coef_mat[, "t value"]
  df_v <- rep(NA_real_, length(est))
  pv   <- rep(NA_real_, length(est))
}

# Confidence intervals via Wald approximation
ci_half <- qnorm(1 - (1 - confidence_level) / 2) * se
ci_lower <- est - ci_half
ci_upper <- est + ci_half

fixed_df <- data.frame(
  term      = term_names,
  estimate  = est,
  std_error = se,
  t_value   = tv,
  df        = df_v,
  p_value   = pv,
  ci_lower  = ci_lower,
  ci_upper  = ci_upper,
  row.names = NULL,
  stringsAsFactors = FALSE
)

# ---- Random effects variance components ----

vc_full <- as.data.frame(lme4::VarCorr(fit))
residual_sigma2 <- attr(lme4::VarCorr(fit), "sc")^2

re_list <- list()
for (i in seq_len(nrow(vc_full))) {
  grp <- vc_full$grp[i]
  var1 <- if (is.na(vc_full$var1[i])) "intercept" else vc_full$var1[i]
  var2 <- if (is.na(vc_full$var2[i])) NA else vc_full$var2[i]
  vcov_val <- vc_full$vcov[i]
  sdcor_val <- vc_full$sdcor[i]

  key <- if (!is.na(var2)) {
    paste0(grp, ".", var1, ".", var2)
  } else {
    paste0(grp, ".", var1)
  }

  re_list[[key]] <- list(
    group     = grp,
    term1     = var1,
    term2     = if (!is.na(var2)) var2 else NULL,
    variance  = vcov_val,
    sd_or_cor = sdcor_val
  )
}

# Add residual
re_list[["Residual"]] <- list(
  group    = "Residual",
  term1    = NA,
  term2    = NULL,
  variance = residual_sigma2,
  sd_or_cor = sqrt(residual_sigma2)
)

# ---- Model fit statistics ----

fit_ml <- if (use_reml) {
  tryCatch(lme4::refitML(fit), error = function(e) NULL)
} else {
  fit
}

if (!is.null(fit_ml)) {
  aic_val    <- AIC(fit_ml)
  bic_val    <- BIC(fit_ml)
  loglik_val <- logLik(fit_ml)
  dev_val    <- -2 * as.numeric(loglik_val)
} else {
  aic_val    <- AIC(fit)
  bic_val    <- BIC(fit)
  loglik_val <- logLik(fit)
  dev_val    <- -2 * as.numeric(loglik_val)
}

model_fit <- list(
  AIC      = aic_val,
  BIC      = bic_val,
  logLik   = as.numeric(loglik_val),
  deviance = dev_val,
  REML     = use_reml
)

# ---- Null model fit statistics for comparison ----

null_model_fit <- NULL
lrt_result     <- NULL

if (compare_models && !is.null(fit_null) && model_type != "null") {
  null_aic    <- AIC(fit_null)
  null_bic    <- BIC(fit_null)
  null_loglik <- logLik(fit_null)
  null_dev    <- -2 * as.numeric(null_loglik)

  null_model_fit <- list(
    AIC      = null_aic,
    BIC      = null_bic,
    logLik   = as.numeric(null_loglik),
    deviance = null_dev
  )

  # LRT: compare null vs. full model (both ML-fitted)
  fit_ml_for_lrt <- if (!is.null(fit_ml)) fit_ml else tryCatch(lme4::refitML(fit), error = function(e) fit)

  lrt <- tryCatch(
    anova(fit_null, fit_ml_for_lrt),
    error = function(e) NULL
  )

  if (!is.null(lrt)) {
    lrt_df  <- as.data.frame(lrt)
    chi_sq  <- lrt_df$Chisq[2]
    lrt_df_val <- lrt_df$Df[2]
    lrt_p   <- lrt_df$`Pr(>Chisq)`[2]

    lrt_result <- list(
      chi_square = chi_sq,
      df         = lrt_df_val,
      p_value    = lrt_p,
      significant = (!is.na(lrt_p) && lrt_p < alpha)
    )
  }
}

# ---- Variance components summary ----

variance_components <- list(
  between_group = var_between,
  within_group  = var_within,
  total         = if (!is.na(var_between) && !is.na(var_within)) var_between + var_within else NA
)

# ---- Interpretation ----

icc_pct <- if (!is.na(icc_value)) round(icc_value * 100, 1) else NA

n_sig_fixed <- if (all(is.na(fixed_df$p_value))) {
  NA
} else {
  sum(!is.na(fixed_df$p_value) &
      fixed_df$p_value < alpha &
      fixed_df$term != "(Intercept)")
}

model_type_label <- switch(
  model_type,
  "null"             = "Null (unconditional)",
  "random-intercept" = "Random Intercept",
  "random-slope"     = "Random Slope",
  "cross-level"      = "Cross-Level Interaction",
  model_type
)

interp_parts <- character(0)

if (!is.na(icc_value)) {
  icc_desc <- if (icc_value < 0.05) "negligible" else
    if (icc_value < 0.10) "small" else
    if (icc_value < 0.25) "moderate" else "substantial"
  interp_parts <- c(interp_parts,
    sprintf("ICC = %.3f (%.1f%% of variance is between-groups; %s clustering effect)",
            icc_value, icc_pct, icc_desc))
}

if (!is.na(n_sig_fixed) && model_type != "null") {
  interp_parts <- c(interp_parts,
    sprintf("%d of %d fixed effect(s) (excl. intercept) significant at alpha = %.2f",
            n_sig_fixed,
            sum(fixed_df$term != "(Intercept)"),
            alpha))
}

if (!is.null(lrt_result)) {
  sig_word <- if (isTRUE(lrt_result$significant)) "significantly" else "did not significantly"
  interp_parts <- c(interp_parts,
    sprintf("Full model %s improved fit over null model: chi2(%d) = %.3f, p %s %.4f",
            sig_word,
            lrt_result$df,
            lrt_result$chi_square,
            if (isTRUE(lrt_result$significant)) "<" else ">=",
            alpha))
}

if (!converged) {
  interp_parts <- c(interp_parts,
    "WARNING: Model may not have converged. Interpret results with caution.")
}

interpretation <- paste0(
  model_type_label, " HLM: ",
  if (length(interp_parts) > 0) paste(interp_parts, collapse = ". ") else "model fitted successfully."
)

# ---- Centering summary ----

centering_summary <- NULL
if (length(centered_vars) > 0) {
  centering_summary <- list(
    method    = centering,
    variables = names(centered_vars)
  )
}

# ---- Compose result ----

result <- list(
  model_type          = model_type,
  model_type_label    = model_type_label,
  formula_str         = formula_str,
  n                   = n,
  n_groups            = n_groups,
  converged           = converged,
  icc                 = if (!is.na(icc_value)) icc_value else NULL,
  variance_components = variance_components,
  fixed_effects       = fixed_df,
  random_effects      = re_list,
  model_fit           = model_fit,
  null_model_fit      = null_model_fit,
  lrt_result          = lrt_result,
  centering           = centering,
  centering_summary   = centering_summary,
  confidence_level    = confidence_level,
  alpha               = alpha,
  interpretation      = interpretation
)

result
