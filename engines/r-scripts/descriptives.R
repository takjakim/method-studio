# descriptives.R - Descriptive statistics for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   variables : character vector of column names to analyze
#   + columnar data with those column names present
#
# Returns a named list with stats for each variable

if (!exists("variables") || length(variables) == 0) {
  stop("Variable 'variables' is required - specify column names to analyze")
}

# Variables come as a list from JSON, extract as character vector
var_names <- if (is.list(variables)) unlist(variables) else variables

# Helper functions
calc_mode <- function(v) {
  tbl <- table(v)
  modes <- as.numeric(names(tbl)[tbl == max(tbl)])
  if (length(modes) == 1) modes[1] else modes
}

describe_variable <- function(var_name) {
  if (!exists(var_name)) {
    stop(paste0("Column '", var_name, "' not found in data"))
  }

  # Get data - may come as list from JSON
  x_raw <- get(var_name)
  x_all <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
  x_valid <- x_all[!is.na(x_all)]

  n <- length(x_all)
  n_missing <- sum(is.na(x_all))
  n_valid <- length(x_valid)

  if (n_valid == 0) {
    return(list(
      n = n,
      missing = n_missing,
      mean = NA,
      median = NA,
      std = NA,
      variance = NA,
      se_mean = NA,
      min = NA,
      max = NA,
      range = NA,
      q1 = NA,
      q3 = NA,
      iqr = NA,
      skewness = NA,
      kurtosis = NA
    ))
  }

  # Central tendency
  x_mean <- mean(x_valid)
  x_median <- median(x_valid)

  # Dispersion
  x_sd <- if (n_valid > 1) sd(x_valid) else 0
  x_var <- if (n_valid > 1) var(x_valid) else 0
  x_min <- min(x_valid)
  x_max <- max(x_valid)
  x_range <- x_max - x_min
  x_se <- if (n_valid > 0) x_sd / sqrt(n_valid) else 0

  # Quartiles
  quarts <- quantile(x_valid, probs = c(0.25, 0.75))
  x_q1 <- quarts[1]
  x_q3 <- quarts[2]
  x_iqr <- IQR(x_valid)

  # Shape
  if (requireNamespace("psych", quietly = TRUE) && n_valid >= 3) {
    x_skewness <- psych::skew(x_valid)
    x_kurtosis <- if (n_valid >= 4) psych::kurtosi(x_valid) else NA
  } else {
    # Fallback: manual calculation
    if (n_valid >= 3) {
      m3 <- mean((x_valid - x_mean)^3)
      x_skewness <- m3 / x_sd^3
    } else {
      x_skewness <- NA
    }
    if (n_valid >= 4) {
      m4 <- mean((x_valid - x_mean)^4)
      x_kurtosis <- (m4 / x_sd^4) - 3
    } else {
      x_kurtosis <- NA
    }
  }

  list(
    n = n_valid,
    missing = n_missing,
    mean = round(x_mean, 6),
    median = round(x_median, 6),
    std = round(x_sd, 6),
    variance = round(x_var, 6),
    se_mean = round(x_se, 6),
    min = round(x_min, 6),
    max = round(x_max, 6),
    range = round(x_range, 6),
    q1 = round(unname(x_q1), 6),
    q3 = round(unname(x_q3), 6),
    iqr = round(x_iqr, 6),
    skewness = if (!is.na(x_skewness)) round(x_skewness, 6) else NA,
    kurtosis = if (!is.na(x_kurtosis)) round(x_kurtosis, 6) else NA
  )
}

# Process each variable
stats_out <- list()
for (var_name in var_names) {
  stats_out[[var_name]] <- describe_variable(var_name)
}

# Create histogram for first variable
if (length(var_names) > 0) {
  first_var <- var_names[1]
  x_raw <- get(first_var)
  x_data <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
  x_valid <- x_data[!is.na(x_data)]

  if (length(x_valid) > 0) {
    hist(x_valid,
         main = paste("Distribution of", first_var),
         xlab = first_var,
         col = "#4C72B0",
         border = "white",
         probability = TRUE)
    if (length(x_valid) > 1) {
      lines(density(x_valid), col = "#DD8452", lwd = 2)
    }
  }
}

# Compose result
result <- list(
  variables = var_names,
  stats = stats_out
)

result
