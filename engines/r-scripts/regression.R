# regression.R - Linear Regression implementations for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   dependent    : list with one element - column name of the outcome variable
#   independents : list of column names - predictor variable names
#   options      : list with optional named fields:
#                    includeConstant  : logical (default TRUE)
#                    confidenceLevel  : numeric in (0,1) (default 0.95)
#                    diagnostics      : logical (default TRUE)
#                    vif              : logical (default TRUE)
#   alpha        : numeric - significance level (default 0.05)
#
#   Column data is injected into the environment by name (same pattern as ttest.R).
#   Each column may arrive as a list from JSON; use as.numeric(unlist(x)) to coerce.
#
# Returns a named list with:
#   model_type, formula, n, k,
#   coefficients (data frame: term, estimate, std_error, t_value, p_value, ci_lower, ci_upper),
#   r_squared, adj_r_squared, rmse,
#   f_statistic, f_df1, f_df2, f_p_value,
#   anova_table (data frame),
#   normality_test (Shapiro-Wilk on residuals),
#   interpretation

if (!exists("dependent"))    stop("Variable 'dependent' is required")
if (!exists("independents")) stop("Variable 'independents' is required")
if (!exists("alpha"))        alpha <- 0.05

# ---- Resolve options ----

include_constant <- TRUE
confidence_level <- 0.95
run_diagnostics  <- TRUE

# Read flattened option variables directly
if (exists("includeConstant") && !is.null(includeConstant)) {
  include_constant <- as.logical(if (is.list(includeConstant)) includeConstant[[1]] else includeConstant)
}
if (exists("confidenceLevel") && !is.null(confidenceLevel)) {
  confidence_level <- as.numeric(if (is.list(confidenceLevel)) confidenceLevel[[1]] else confidenceLevel)
}
if (exists("diagnostics") && !is.null(diagnostics)) {
  run_diagnostics <- as.logical(if (is.list(diagnostics)) diagnostics[[1]] else diagnostics)
}

# ---- Extract column names from slot lists ----
# dependent comes as a list with one element: the column name string
dep_name <- if (is.list(dependent)) dependent[[1]] else dependent[1]
if (!exists(dep_name)) stop(paste0("Column '", dep_name, "' not found in data"))

# independents comes as a list of column name strings
if (!is.list(independents)) {
  indep_names <- as.character(independents)
} else {
  indep_names <- unlist(independents)
}

k <- length(indep_names)
if (k == 0) stop("At least one predictor (independent variable) is required")

for (nm in indep_names) {
  if (!exists(nm)) stop(paste0("Column '", nm, "' not found in data"))
}

# ---- Coerce & validate column data ----
# Column data may arrive as lists from JSON; flatten with unlist()

dep_raw <- get(dep_name)
dep_vec <- as.numeric(if (is.list(dep_raw)) unlist(dep_raw) else dep_raw)

# Build data frame
df_data <- data.frame(dep_vec, stringsAsFactors = FALSE)
names(df_data) <- dep_name

for (nm in indep_names) {
  raw_col <- get(nm)
  df_data[[nm]] <- as.numeric(if (is.list(raw_col)) unlist(raw_col) else raw_col)
}

# Listwise deletion
df_clean <- df_data[complete.cases(df_data), ]
n <- nrow(df_clean)

if (n < k + 2) stop(paste0("Insufficient complete observations (n = ", n, ") for ", k, " predictor(s)."))

# ---- Fit model ----

rhs <- paste(indep_names, collapse = " + ")
if (!include_constant) rhs <- paste0("0 + ", rhs)

formula_str <- paste(dep_name, "~", rhs)
model_formula <- as.formula(formula_str)

fit  <- lm(model_formula, data = df_clean)
smry <- summary(fit)

# ---- Coefficients table ----

coef_mat <- coef(smry)                             # estimate, se, t, p
ci_mat   <- confint(fit, level = confidence_level) # lower, upper

coef_df <- data.frame(
  term      = rownames(coef_mat),
  estimate  = coef_mat[, "Estimate"],
  std_error = coef_mat[, "Std. Error"],
  t_value   = coef_mat[, "t value"],
  p_value   = coef_mat[, "Pr(>|t|)"],
  ci_lower  = ci_mat[, 1],
  ci_upper  = ci_mat[, 2],
  row.names = NULL,
  stringsAsFactors = FALSE
)

# ---- Model fit statistics ----

r_squared     <- smry$r.squared
adj_r_squared <- smry$adj.r.squared
rmse          <- smry$sigma

f_stat <- smry$fstatistic
if (!is.null(f_stat)) {
  f_value   <- unname(f_stat["value"])
  f_df1     <- unname(f_stat["numdf"])
  f_df2     <- unname(f_stat["dendf"])
  f_p_value <- pf(f_value, f_df1, f_df2, lower.tail = FALSE)
} else {
  f_value <- NA; f_df1 <- NA; f_df2 <- NA; f_p_value <- NA
}

# ---- ANOVA table ----

anova_out <- anova(fit)
anova_df  <- as.data.frame(anova_out)
anova_df  <- data.frame(
  term    = rownames(anova_df),
  df      = anova_df[["Df"]],
  ss      = anova_df[["Sum Sq"]],
  ms      = anova_df[["Mean Sq"]],
  f_value = anova_df[["F value"]],
  p_value = anova_df[["Pr(>F)"]],
  row.names = NULL,
  stringsAsFactors = FALSE
)

# ---- Normality test on residuals (Shapiro-Wilk) ----

resids <- residuals(fit)
norm_test_result <- NULL
if (length(resids) >= 3 && length(resids) <= 5000) {
  sw <- shapiro.test(resids)
  norm_test_result <- list(
    method    = sw$method,
    statistic = unname(sw$statistic),
    p_value   = sw$p.value,
    normal    = sw$p.value >= alpha
  )
}

# ---- Diagnostic plots ----

if (run_diagnostics) {
  par(mfrow = c(2, 2), mar = c(4, 4, 3, 1))

  # 1. Residuals vs Fitted
  plot(fitted(fit), resids,
       main = "Residuals vs Fitted",
       xlab = "Fitted values",
       ylab = "Residuals",
       pch  = 20, col = "#4C72B088")
  abline(h = 0, col = "#DD8452", lwd = 2, lty = 2)
  lines(lowess(fitted(fit), resids), col = "#C44E52", lwd = 1.5)

  # 2. Normal Q-Q
  qqnorm(resids,
         main = "Normal Q-Q",
         pch  = 20, col = "#4C72B088")
  qqline(resids, col = "#DD8452", lwd = 2)

  # 3. Scale-Location
  sqrt_abs_resids <- sqrt(abs(resids))
  plot(fitted(fit), sqrt_abs_resids,
       main = "Scale-Location",
       xlab = "Fitted values",
       ylab = expression(sqrt("|Residuals|")),
       pch  = 20, col = "#4C72B088")
  lines(lowess(fitted(fit), sqrt_abs_resids), col = "#C44E52", lwd = 1.5)

  # 4. Residuals vs Leverage
  hat_vals   <- hatvalues(fit)
  std_resids <- rstandard(fit)
  plot(hat_vals, std_resids,
       main = "Residuals vs Leverage",
       xlab = "Leverage",
       ylab = "Standardised Residuals",
       pch  = 20, col = "#4C72B088")
  abline(h = c(-2, 0, 2), col = "#DD8452", lwd = c(1.5, 2, 1.5), lty = c(2, 2, 2))

  par(mfrow = c(1, 1))
}

# ---- Interpretation ----

model_type <- if (k == 1) "simple" else "multiple"

sig_preds <- coef_df$term[coef_df$p_value < alpha & coef_df$term != "(Intercept)"]
n_sig     <- length(sig_preds)

interp <- sprintf(
  paste0(
    "%s linear regression: F(%d, %d) = %.3f, p %s %.4f. ",
    "The model explains %.1f%% of variance (R\u00b2 = %.3f, adj. R\u00b2 = %.3f, RMSE = %.3f). ",
    "%d of %d predictor(s) %s significant at \u03b1 = %.2f."
  ),
  if (model_type == "simple") "Simple" else "Multiple",
  if (!is.na(f_df1)) as.integer(f_df1) else k,
  if (!is.na(f_df2)) as.integer(f_df2) else (n - k - as.integer(include_constant)),
  if (!is.na(f_value)) f_value else 0,
  if (!is.na(f_p_value) && f_p_value < alpha) "<" else ">=",
  alpha,
  r_squared * 100,
  r_squared,
  adj_r_squared,
  rmse,
  n_sig, k,
  if (n_sig == 1) "is" else "are"
)

# ---- Compose result ----

result <- list(
  model_type       = model_type,
  formula          = formula_str,
  n                = n,
  k                = k,
  coefficients     = coef_df,
  r_squared        = r_squared,
  adj_r_squared    = adj_r_squared,
  rmse             = rmse,
  f_statistic      = if (!is.na(f_value)) f_value else NULL,
  f_df1            = if (!is.na(f_df1)) as.integer(f_df1) else NULL,
  f_df2            = if (!is.na(f_df2)) as.integer(f_df2) else NULL,
  f_p_value        = if (!is.na(f_p_value)) f_p_value else NULL,
  anova_table      = anova_df,
  normality_test   = norm_test_result,
  confidence_level = confidence_level,
  alpha            = alpha,
  interpretation   = interp
)

result
