# ttest.R - T-test implementations for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   test_type : "one-sample" | "independent" | "paired"
#
#   For one-sample:
#     testVariables : character vector of column names to test
#     + columnar data with those column names present
#     options$testValue : hypothesised mean (default 0)
#
#   For independent:
#     testVariables    : character vector of column names to test
#     groupingVariable : character vector (length 1) with grouping column name
#     + columnar data with those column names present
#     options$group1Value, options$group2Value : values defining the two groups
#
#   For paired:
#     variable1 : character vector (length 1) with first variable name
#     variable2 : character vector (length 1) with second variable name
#     + columnar data with those column names present
#
#   Shared:
#     alpha : significance level (default 0.05)
#
# Returns a named list with:
#   test_type, statistic, df, p_value, significant,
#   ci_lower, ci_upper, ci_level,
#   cohens_d, effect_size_label,
#   means (list), sds (list), ns (list),
#   interpretation

if (!exists("test_type")) stop("Variable 'test_type' is required")
if (!exists("alpha")) alpha <- 0.05

ci_level <- 1 - alpha

# ---- Cohen's d helpers ----

cohens_d_one_sample <- function(x, mu) {
  (mean(x) - mu) / sd(x)
}

cohens_d_independent <- function(x, y) {
  nx <- length(x); ny <- length(y)
  sp <- sqrt(((nx - 1) * var(x) + (ny - 1) * var(y)) / (nx + ny - 2))
  (mean(x) - mean(y)) / sp
}

cohens_d_paired <- function(x, y) {
  d <- x - y
  mean(d) / sd(d)
}

effect_label <- function(d) {
  abs_d <- abs(d)
  if (abs_d < 0.2) {
    "negligible"
  } else if (abs_d < 0.5) {
    "small"
  } else if (abs_d < 0.8) {
    "medium"
  } else {
    "large"
  }
}

# ---- Run test based on type ----

if (test_type == "one-sample") {
  # Get test variable name and data
  if (!exists("testVariables") || length(testVariables) == 0) {
    stop("testVariables is required for one-sample t-test")
  }
  # testVariables comes as a list from JSON, extract first element
  var_name <- if (is.list(testVariables)) testVariables[[1]] else testVariables[1]
  if (!exists(var_name)) stop(paste0("Column '", var_name, "' not found in data"))

  # Column data may come as list from JSON, convert to numeric vector
  x_raw <- get(var_name)
  x <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
  x_valid <- x[!is.na(x)]

  if (length(x_valid) < 2) stop("Test variable must have at least 2 non-missing values")

  # Get hypothesised mean from flattened option variables
  mu <- 0
  if (exists("testValue") && !is.null(testValue)) {
    mu <- as.numeric(if (is.list(testValue)) testValue[[1]] else testValue)
  }

  tt      <- t.test(x_valid, mu = mu, conf.level = ci_level)
  d       <- cohens_d_one_sample(x_valid, mu)

  means   <- list(sample = mean(x_valid), mu = mu)
  sds     <- list(sample = sd(x_valid))
  ns      <- list(sample = length(x_valid))

  interp  <- sprintf(
    "One-sample t-test: t(%s) = %.3f, p %s %.4f. The mean of %s (M = %.3f, SD = %.3f) is %s significantly different from %.3f.",
    round(tt$parameter, 2),
    tt$statistic,
    if (tt$p.value < alpha) "<" else ">=",
    alpha,
    var_name,
    mean(x_valid),
    sd(x_valid),
    if (tt$p.value < alpha) "" else "not",
    mu
  )

} else if (test_type == "independent") {
  # Get test and grouping variables
  if (!exists("testVariables") || length(testVariables) == 0) {
    stop("testVariables is required for independent t-test")
  }
  if (!exists("groupingVariable") || length(groupingVariable) == 0) {
    stop("groupingVariable is required for independent t-test")
  }

  # Variables come as lists from JSON, extract first element
  var_name <- if (is.list(testVariables)) testVariables[[1]] else testVariables[1]
  group_name <- if (is.list(groupingVariable)) groupingVariable[[1]] else groupingVariable[1]

  if (!exists(var_name)) stop(paste0("Column '", var_name, "' not found in data"))
  if (!exists(group_name)) stop(paste0("Grouping column '", group_name, "' not found in data"))

  # Column data may come as list from JSON, convert appropriately
  test_raw <- get(var_name)
  test_data <- as.numeric(if (is.list(test_raw)) unlist(test_raw) else test_raw)
  group_raw <- get(group_name)
  group_data <- if (is.list(group_raw)) unlist(group_raw) else group_raw

  # Get group values from flattened option variables
  g1_val <- 1
  g2_val <- 2
  if (exists("group1Value") && !is.null(group1Value)) {
    g1_val <- if (is.list(group1Value)) group1Value[[1]] else group1Value
  }
  if (exists("group2Value") && !is.null(group2Value)) {
    g2_val <- if (is.list(group2Value)) group2Value[[1]] else group2Value
  }

  # Split data by group
  x_valid <- test_data[group_data == g1_val & !is.na(test_data)]
  y_valid <- test_data[group_data == g2_val & !is.na(test_data)]

  if (length(x_valid) < 2) stop("Group 1 must have at least 2 non-missing values")
  if (length(y_valid) < 2) stop("Group 2 must have at least 2 non-missing values")

  tt      <- t.test(x_valid, y_valid, conf.level = ci_level, var.equal = FALSE)
  d       <- cohens_d_independent(x_valid, y_valid)

  means   <- list(group1 = mean(x_valid), group2 = mean(y_valid))
  sds     <- list(group1 = sd(x_valid),   group2 = sd(y_valid))
  ns      <- list(group1 = length(x_valid), group2 = length(y_valid))

  interp  <- sprintf(
    "Independent samples t-test (Welch): t(%s) = %.3f, p %s %.4f. Group 1 (M = %.3f, SD = %.3f, n = %d) vs Group 2 (M = %.3f, SD = %.3f, n = %d).",
    round(tt$parameter, 2),
    tt$statistic,
    if (tt$p.value < alpha) "<" else ">=",
    alpha,
    mean(x_valid), sd(x_valid), length(x_valid),
    mean(y_valid), sd(y_valid), length(y_valid)
  )

} else if (test_type == "paired") {
  # Get paired variables
  if (!exists("variable1") || length(variable1) == 0) {
    stop("variable1 is required for paired t-test")
  }
  if (!exists("variable2") || length(variable2) == 0) {
    stop("variable2 is required for paired t-test")
  }

  # Variables come as lists from JSON, extract first element
  var1_name <- if (is.list(variable1)) variable1[[1]] else variable1[1]
  var2_name <- if (is.list(variable2)) variable2[[1]] else variable2[1]

  if (!exists(var1_name)) stop(paste0("Column '", var1_name, "' not found in data"))
  if (!exists(var2_name)) stop(paste0("Column '", var2_name, "' not found in data"))

  # Column data may come as list from JSON, convert to numeric vector
  x_raw <- get(var1_name)
  x <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
  y_raw <- get(var2_name)
  y <- as.numeric(if (is.list(y_raw)) unlist(y_raw) else y_raw)

  # Remove pairwise missing
  keep    <- !is.na(x) & !is.na(y)
  x_valid <- x[keep]
  y_valid <- y[keep]

  if (length(x_valid) < 2) stop("At least 2 complete pairs are required")

  tt      <- t.test(x_valid, y_valid, paired = TRUE, conf.level = ci_level)
  d       <- cohens_d_paired(x_valid, y_valid)

  diff_mean <- mean(x_valid - y_valid)
  diff_sd   <- sd(x_valid - y_valid)
  means   <- list(var1 = mean(x_valid), var2 = mean(y_valid), diff = diff_mean)
  sds     <- list(var1 = sd(x_valid),   var2 = sd(y_valid),   diff = diff_sd)
  ns      <- list(pairs = length(x_valid))

  interp  <- sprintf(
    "Paired samples t-test: t(%d) = %.3f, p %s %.4f. Mean difference = %.3f (SD = %.3f, n = %d pairs).",
    as.integer(tt$parameter),
    tt$statistic,
    if (tt$p.value < alpha) "<" else ">=",
    alpha,
    diff_mean, diff_sd, length(x_valid)
  )

} else {
  stop(paste0("Unknown test_type: '", test_type, "'. Use 'one-sample', 'independent', or 'paired'."))
}

# ---- Visualisation ----

if (test_type == "one-sample") {
  hist(x_valid,
       main  = paste("One-Sample T-Test:", var_name, "vs", round(mu, 3)),
       xlab  = var_name,
       col   = "#4C72B0",
       border = "white")
  abline(v = mu, col = "#DD8452", lwd = 2, lty = 2)
  legend("topright", legend = paste0("mu = ", round(mu, 3)),
         col = "#DD8452", lty = 2, lwd = 2, bty = "n")

} else if (test_type == "independent") {
  boxplot(list(`Group 1` = x_valid, `Group 2` = y_valid),
          main   = "Independent Samples T-Test",
          ylab   = var_name,
          col    = c("#4C72B0", "#DD8452"),
          border = c("#2c4f80", "#b05e30"),
          notch  = FALSE)
  stripchart(list(`Group 1` = x_valid, `Group 2` = y_valid),
             vertical = TRUE, method = "jitter",
             add = TRUE, pch = 20, col = c("#2c4f8088", "#b05e3088"))

} else if (test_type == "paired") {
  n_pairs <- length(x_valid)
  plot(
    x = rep(1, n_pairs), y = x_valid,
    xlim = c(0.5, 2.5), ylim = range(c(x_valid, y_valid)),
    pch = 20, col = "#4C72B088",
    xaxt = "n", xlab = "", ylab = "Value",
    main = "Paired Samples T-Test"
  )
  points(rep(2, n_pairs), y_valid, pch = 20, col = "#DD845288")
  for (i in seq_len(n_pairs)) {
    col <- if (x_valid[i] > y_valid[i]) "#4C72B044" else "#DD845244"
    lines(c(1, 2), c(x_valid[i], y_valid[i]), col = col)
  }
  axis(1, at = c(1, 2), labels = c(var1_name, var2_name))
  points(c(1, 2), c(mean(x_valid), mean(y_valid)),
         pch = 18, cex = 2, col = c("#4C72B0", "#DD8452"))
}

# ---- Compose result ----

result <- list(
  test_type          = test_type,
  statistic          = unname(tt$statistic),
  df                 = unname(tt$parameter),
  p_value            = tt$p.value,
  significant        = tt$p.value < alpha,
  ci_lower           = tt$conf.int[1],
  ci_upper           = tt$conf.int[2],
  ci_level           = ci_level,
  cohens_d           = d,
  effect_size_label  = effect_label(d),
  means              = means,
  sds                = sds,
  ns                 = ns,
  interpretation     = interp
)

result
