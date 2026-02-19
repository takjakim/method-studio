# moderation.R - Moderation Analysis (PROCESS Model 1 style) for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   outcome        : list with one element - column name of the outcome (Y) variable
#   predictor      : list with one element - column name of the focal predictor (X) variable
#   moderator      : list with one element - column name of the moderator (W) variable
#   covariates     : optional list of additional covariate column names
#   options        : list with optional named fields:
#                      centering        : character "mean" | "none" (default "none")
#                      probeInteraction : logical (default TRUE)
#                      probeValues      : character "percentile" | "meanSD" (default "meanSD")
#                                         or a numeric vector of three W values
#                      johnsonNeyman    : logical (default TRUE)
#                      bootstrap        : logical (default FALSE) - reserved for future use
#                      nBoot            : integer (default 1000)
#                      ciLevel          : numeric in (0,1) (default 0.95)
#                      interactionPlot  : logical (default TRUE)
#   alpha          : numeric - significance level (default 0.05)
#
#   Column data is injected into the environment by name (same pattern as regression.R).
#   Each column may arrive as a list from JSON; use as.numeric(unlist(x)) to coerce.
#
# Returns a named list `result` with:
#   n, centering_applied,
#   model      : coefficients table, R², adj-R², F, p
#   simple_slopes (when probeInteraction = TRUE)
#   johnson_neyman (when johnsonNeyman = TRUE)
#   interaction_plot (logical - whether a plot was produced)
#   interpretation

# ---- Guard required inputs ----

if (!exists("outcome"))   stop("Variable 'outcome' is required")
if (!exists("predictor")) stop("Variable 'predictor' is required")
if (!exists("moderator")) stop("Variable 'moderator' is required")
if (!exists("alpha"))     alpha <- 0.05

# ---- Resolve options ----

centering         <- "none"
probe_interaction <- TRUE
probe_values_opt  <- "meanSD"
do_jn             <- TRUE
do_bootstrap      <- FALSE
n_boot            <- 1000L
ci_level          <- 0.95
do_plot           <- TRUE

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("centering") && !is.null(centering))               centering         <- as.character(if (is.list(centering)) centering[[1]] else centering)
if (exists("probeInteraction") && !is.null(probeInteraction)) probe_interaction <- as.logical(if (is.list(probeInteraction)) probeInteraction[[1]] else probeInteraction)
if (exists("probeValues") && !is.null(probeValues))           probe_values_opt  <- probeValues
if (exists("johnsonNeyman") && !is.null(johnsonNeyman))       do_jn             <- as.logical(if (is.list(johnsonNeyman)) johnsonNeyman[[1]] else johnsonNeyman)
if (exists("bootstrap") && !is.null(bootstrap))               do_bootstrap      <- as.logical(if (is.list(bootstrap)) bootstrap[[1]] else bootstrap)
if (exists("nBoot") && !is.null(nBoot))                       n_boot            <- as.integer(if (is.list(nBoot)) nBoot[[1]] else nBoot)
if (exists("ciLevel") && !is.null(ciLevel))                   ci_level          <- as.numeric(if (is.list(ciLevel)) ciLevel[[1]] else ciLevel)
if (exists("interactionPlot") && !is.null(interactionPlot))   do_plot           <- as.logical(if (is.list(interactionPlot)) interactionPlot[[1]] else interactionPlot)

# ---- Extract column names ----

outcome_name   <- if (is.list(outcome))   outcome[[1]]   else outcome[1]
predictor_name <- if (is.list(predictor)) predictor[[1]] else predictor[1]
moderator_name <- if (is.list(moderator)) moderator[[1]] else moderator[1]

for (nm in c(outcome_name, predictor_name, moderator_name)) {
  if (!exists(nm)) stop(paste0("Column '", nm, "' not found in data"))
}

covariate_names <- character(0)
if (exists("covariates") && !is.null(covariates) && length(covariates) > 0) {
  covariate_names <- unlist(covariates)
  for (nm in covariate_names) {
    if (!exists(nm)) stop(paste0("Covariate column '", nm, "' not found in data"))
  }
}

# ---- Build data frame ----

coerce_col <- function(nm) {
  raw <- get(nm)
  as.numeric(if (is.list(raw)) unlist(raw) else raw)
}

df_data <- data.frame(
  Y = coerce_col(outcome_name),
  X = coerce_col(predictor_name),
  W = coerce_col(moderator_name),
  stringsAsFactors = FALSE
)

for (nm in covariate_names) {
  df_data[[nm]] <- coerce_col(nm)
}

# Listwise deletion
df_clean <- df_data[complete.cases(df_data), ]
n <- nrow(df_clean)

min_obs <- 4 + length(covariate_names)
if (n < min_obs) {
  stop(paste0("Insufficient complete observations (n = ", n, ") for moderation analysis."))
}

# ---- Mean centering ----

centering_applied <- FALSE

if (tolower(centering) == "mean") {
  centering_applied <- TRUE
  x_mean <- mean(df_clean$X)
  w_mean <- mean(df_clean$W)
  df_clean$X <- df_clean$X - x_mean
  df_clean$W <- df_clean$W - w_mean
}

# ---- Create interaction term ----

interaction_name <- paste0(predictor_name, "_x_", moderator_name)
df_clean$XW <- df_clean$X * df_clean$W

# ---- Build and fit moderated regression ----

rhs_terms <- c("X", "W", "XW", covariate_names)
formula_str <- paste("Y ~", paste(rhs_terms, collapse = " + "))
model_formula <- as.formula(formula_str)

fit  <- lm(model_formula, data = df_clean)
smry <- summary(fit)

# ---- Coefficients table ----

coef_mat <- coef(smry)
ci_mat   <- confint(fit, level = ci_level)

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

# Extract key coefficients by position (Intercept, X, W, XW)
b0  <- unname(coef(fit)["(Intercept)"])
b_x <- unname(coef(fit)["X"])
b_w <- unname(coef(fit)["W"])
b_xw <- unname(coef(fit)["XW"])

get_coef_list <- function(term_name) {
  row <- coef_df[coef_df$term == term_name, ]
  if (nrow(row) == 0) return(NULL)
  list(
    coef = row$estimate,
    se   = row$std_error,
    t    = row$t_value,
    p    = row$p_value,
    ci_lower = row$ci_lower,
    ci_upper = row$ci_upper
  )
}

r_squared     <- smry$r.squared
adj_r_squared <- smry$adj.r.squared

f_stat <- smry$fstatistic
if (!is.null(f_stat)) {
  f_value   <- unname(f_stat["value"])
  f_df1     <- unname(f_stat["numdf"])
  f_df2     <- unname(f_stat["dendf"])
  f_p_value <- pf(f_value, f_df1, f_df2, lower.tail = FALSE)
} else {
  f_value <- NA; f_df1 <- NA; f_df2 <- NA; f_p_value <- NA
}

model_out <- list(
  formula    = formula_str,
  coefficients = list(
    intercept   = get_coef_list("(Intercept)"),
    predictor   = get_coef_list("X"),
    moderator   = get_coef_list("W"),
    interaction = get_coef_list("XW")
  ),
  coef_table    = coef_df,
  r_squared     = r_squared,
  adj_r_squared = adj_r_squared,
  f_stat        = if (!is.na(f_value)) f_value else NULL,
  f_df1         = if (!is.na(f_df1)) as.integer(f_df1) else NULL,
  f_df2         = if (!is.na(f_df2)) as.integer(f_df2) else NULL,
  f_p           = if (!is.na(f_p_value)) f_p_value else NULL
)

# ---- Simple slopes (probing the interaction) ----

simple_slopes_out <- NULL

if (probe_interaction) {

  # Determine W probe values
  w_vals <- tryCatch({
    if (is.numeric(probe_values_opt)) {
      # User supplied raw numeric vector of length 3 (or will be recycled)
      pv <- as.numeric(probe_values_opt)
      if (length(pv) < 1) stop("probeValues numeric vector is empty")
      pv
    } else if (is.character(probe_values_opt) && probe_values_opt == "percentile") {
      quantile(df_clean$W, probs = c(0.16, 0.50, 0.84), na.rm = TRUE)
    } else {
      # Default: mean ± 1 SD
      w_m  <- mean(df_clean$W, na.rm = TRUE)
      w_sd <- sd(df_clean$W,   na.rm = TRUE)
      c(w_m - w_sd, w_m, w_m + w_sd)
    }
  }, error = function(e) {
    w_m  <- mean(df_clean$W, na.rm = TRUE)
    w_sd <- sd(df_clean$W,   na.rm = TRUE)
    c(w_m - w_sd, w_m, w_m + w_sd)
  })

  # Ensure we have exactly 3 probe values; pad or truncate
  if (length(w_vals) >= 3) {
    w_vals <- w_vals[1:3]
  } else {
    w_m  <- mean(df_clean$W, na.rm = TRUE)
    w_sd <- sd(df_clean$W,   na.rm = TRUE)
    w_vals <- c(w_m - w_sd, w_m, w_m + w_sd)
  }

  probe_labels <- c("low", "mean", "high")

  # Variance-covariance matrix for deriving slope SE
  vcov_mat <- vcov(fit)

  simple_slopes_out <- vector("list", 3)
  names(simple_slopes_out) <- probe_labels

  for (i in seq_along(probe_labels)) {
    w_val <- unname(w_vals[i])

    # Conditional slope of Y on X at W = w_val:
    #   slope = b_x + b_xw * w_val
    slope_est <- b_x + b_xw * w_val

    # SE via delta method:
    #   Var(slope) = Var(b_x) + w_val^2 * Var(b_xw) + 2 * w_val * Cov(b_x, b_xw)
    var_bx  <- vcov_mat["X",  "X"]
    var_bxw <- vcov_mat["XW", "XW"]
    cov_xw  <- vcov_mat["X",  "XW"]
    slope_se  <- sqrt(var_bx + w_val^2 * var_bxw + 2 * w_val * cov_xw)

    t_val    <- slope_est / slope_se
    df_resid <- df.residual(fit)
    p_val    <- 2 * pt(abs(t_val), df = df_resid, lower.tail = FALSE)
    t_crit   <- qt((1 + ci_level) / 2, df = df_resid)
    ci_lo    <- slope_est - t_crit * slope_se
    ci_hi    <- slope_est + t_crit * slope_se

    simple_slopes_out[[probe_labels[i]]] <- list(
      value    = w_val,
      slope    = slope_est,
      se       = slope_se,
      t        = t_val,
      p        = p_val,
      ci_lower = ci_lo,
      ci_upper = ci_hi,
      significant = p_val < alpha
    )
  }
}

# ---- Johnson-Neyman regions of significance ----

jn_out <- NULL

if (do_jn) {
  jn_out <- tryCatch({

    # The effect of X on Y is significant when:
    #   |t_slope| > t_crit
    # which means:
    #   (b_x + b_xw * W)^2 / Var(slope) > t_crit^2
    #
    # Let a = b_xw^2 - t_crit^2 * var_bxw
    #     b = 2 * b_x * b_xw - 2 * t_crit^2 * cov_xw
    #     c = b_x^2 - t_crit^2 * var_bx
    # Solve quadratic: a*W^2 + b*W + c = 0

    df_resid <- df.residual(fit)
    t_crit   <- qt((1 + ci_level) / 2, df = df_resid)

    vcov_mat <- vcov(fit)
    var_bx   <- vcov_mat["X",  "X"]
    var_bxw  <- vcov_mat["XW", "XW"]
    cov_xw   <- vcov_mat["X",  "XW"]

    qa <- b_xw^2       - t_crit^2 * var_bxw
    qb <- 2 * b_x * b_xw - 2 * t_crit^2 * cov_xw
    qc <- b_x^2        - t_crit^2 * var_bx

    discriminant <- qb^2 - 4 * qa * qc

    jn_result <- list(
      lower_bound        = NA_real_,
      upper_bound        = NA_real_,
      percent_in_region  = NA_real_,
      note               = NULL
    )

    if (is.na(discriminant) || qa == 0) {
      jn_result$note <- "Quadratic has no finite solution; interaction may be negligible."
    } else if (discriminant < 0) {
      jn_result$note <- "No real roots: the effect of X on Y is either always or never significant across W."
    } else {
      root1 <- (-qb - sqrt(discriminant)) / (2 * qa)
      root2 <- (-qb + sqrt(discriminant)) / (2 * qa)
      jn_lower <- min(root1, root2)
      jn_upper <- max(root1, root2)

      # Determine which region is significant by testing a point inside
      w_mid   <- (jn_lower + jn_upper) / 2
      slope_mid <- b_x + b_xw * w_mid
      se_mid    <- sqrt(var_bx + w_mid^2 * var_bxw + 2 * w_mid * cov_xw)
      t_mid     <- slope_mid / se_mid
      mid_is_sig <- abs(t_mid) > t_crit

      # Percent of sample W values in the significant region
      w_vec <- df_clean$W
      if (mid_is_sig) {
        in_region <- w_vec >= jn_lower & w_vec <= jn_upper
        jn_result$lower_bound <- jn_lower
        jn_result$upper_bound <- jn_upper
        jn_result$note <- "X -> Y is significant between lower_bound and upper_bound."
      } else {
        in_region <- w_vec < jn_lower | w_vec > jn_upper
        jn_result$lower_bound <- jn_lower
        jn_result$upper_bound <- jn_upper
        jn_result$note <- "X -> Y is significant outside the range [lower_bound, upper_bound]."
      }
      jn_result$percent_in_region <- 100 * mean(in_region)
    }

    jn_result

  }, error = function(e) {
    list(
      lower_bound       = NA_real_,
      upper_bound       = NA_real_,
      percent_in_region = NA_real_,
      note              = paste("Johnson-Neyman analysis failed:", conditionMessage(e))
    )
  })
}

# ---- Interaction plot ----

plot_produced <- FALSE

if (do_plot) {
  tryCatch({
    w_m  <- mean(df_clean$W, na.rm = TRUE)
    w_sd <- sd(df_clean$W,   na.rm = TRUE)
    w_levels <- c(w_m - w_sd, w_m, w_m + w_sd)
    w_labels  <- c(
      paste0(moderator_name, " \u2212 1 SD"),
      paste0(moderator_name, " Mean"),
      paste0(moderator_name, " + 1 SD")
    )

    x_range <- seq(min(df_clean$X, na.rm = TRUE),
                   max(df_clean$X, na.rm = TRUE),
                   length.out = 100)

    # Predicted Y for each W level across X range (covariates fixed at mean)
    cov_means <- sapply(covariate_names, function(nm) mean(df_data[[nm]], na.rm = TRUE))

    palette_lines <- c("#C44E52", "#4C72B0", "#55A868")

    par(mar = c(5, 4, 4, 8), xpd = TRUE)
    plot(
      x    = range(x_range),
      y    = range(b0 + (b_x + b_xw * range(w_levels)) * range(x_range) + b_w * range(w_levels)),
      type = "n",
      xlab = predictor_name,
      ylab = outcome_name,
      main = paste("Interaction:", predictor_name, "\u00d7", moderator_name)
    )

    for (j in seq_along(w_levels)) {
      w_j    <- w_levels[j]
      y_pred <- b0 + b_x * x_range + b_w * w_j + b_xw * x_range * w_j
      if (length(cov_means) > 0) {
        cov_contrib <- sum(coef(fit)[covariate_names] * cov_means, na.rm = TRUE)
        y_pred <- y_pred + cov_contrib
      }
      lines(x_range, y_pred,
            col = palette_lines[j],
            lwd = 2,
            lty = j)
    }

    legend(
      x      = "topright",
      inset  = c(-0.35, 0),
      legend = w_labels,
      col    = palette_lines,
      lwd    = 2,
      lty    = seq_along(w_levels),
      bty    = "n",
      cex    = 0.85
    )

    par(mar = c(5, 4, 4, 2) + 0.1, xpd = FALSE)
    plot_produced <- TRUE

  }, error = function(e) {
    warning(paste("Interaction plot failed:", conditionMessage(e)))
  })
}

# ---- Interpretation ----

interaction_row <- coef_df[coef_df$term == "XW", ]
int_sig  <- nrow(interaction_row) > 0 && interaction_row$p_value < alpha
int_p    <- if (nrow(interaction_row) > 0) interaction_row$p_value else NA
int_coef <- if (nrow(interaction_row) > 0) interaction_row$estimate else NA

interp_parts <- c(
  sprintf(
    "Moderated regression (PROCESS Model 1 style): F(%s, %s) = %s, p %s %.4f.",
    if (!is.na(f_df1)) as.integer(f_df1) else "?",
    if (!is.na(f_df2)) as.integer(f_df2) else "?",
    if (!is.na(f_value)) sprintf("%.3f", f_value) else "?",
    if (!is.na(f_p_value) && f_p_value < alpha) "<" else ">=",
    alpha
  ),
  sprintf(
    "The model explains %.1f%% of variance in %s (R\u00b2 = %.3f, adj. R\u00b2 = %.3f).",
    r_squared * 100, outcome_name, r_squared, adj_r_squared
  ),
  if (!is.na(int_sig) && int_sig) {
    sprintf(
      "The interaction term %s \u00d7 %s is statistically significant (b = %.3f, p = %.4f), indicating that %s moderates the effect of %s on %s.",
      predictor_name, moderator_name, int_coef, int_p, moderator_name, predictor_name, outcome_name
    )
  } else {
    sprintf(
      "The interaction term %s \u00d7 %s is not statistically significant (b = %.3f, p = %.4f).",
      predictor_name, moderator_name,
      if (!is.na(int_coef)) int_coef else 0,
      if (!is.na(int_p)) int_p else 1
    )
  }
)

if (centering_applied) {
  interp_parts <- c(interp_parts,
    paste0("Variables were mean-centered prior to analysis (X and W centered at their means)."))
}

interpretation <- paste(interp_parts, collapse = " ")

# ---- Compose result ----

# Extract main effect and interaction coefficients/p-values for diagram
main_effect_row  <- coef_df[coef_df$term == "X",  ]
interaction_row2 <- coef_df[coef_df$term == "XW", ]

main_effect_coef <- if (nrow(main_effect_row)  > 0 && !is.na(main_effect_row$estimate[1]))  main_effect_row$estimate[1]  else NULL
main_effect_p    <- if (nrow(main_effect_row)  > 0 && !is.na(main_effect_row$p_value[1]))   main_effect_row$p_value[1]   else NULL
interaction_coef <- if (nrow(interaction_row2) > 0 && !is.na(interaction_row2$estimate[1])) interaction_row2$estimate[1] else NULL
interaction_p    <- if (nrow(interaction_row2) > 0 && !is.na(interaction_row2$p_value[1]))  interaction_row2$p_value[1]  else NULL

diagram <- list(
  modelType = "moderation",
  variables = list(
    x = predictor_name,
    y = outcome_name,
    w = moderator_name
  ),
  coefficients = list(
    c           = main_effect_coef,
    interaction = interaction_coef
  ),
  pValues = list(
    c           = main_effect_p,
    interaction = interaction_p
  )
)

result <- list(
  n                  = n,
  centering_applied  = centering_applied,
  predictor_name     = predictor_name,
  moderator_name     = moderator_name,
  outcome_name       = outcome_name,
  interaction_term   = interaction_name,
  model              = model_out,
  simple_slopes      = simple_slopes_out,
  johnson_neyman     = jn_out,
  interaction_plot   = plot_produced,
  interpretation     = interpretation,
  diagram            = diagram
)

result
