# correlation.R - Correlation analysis for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   variables : character vector (or list) of numeric variable names to correlate
#   + columnar data with those column names present as individual variables
#   options$method         : "pearson" | "spearman" | "kendall" (default: "pearson")
#   options$twoTailed      : logical, two-tailed p-values (default: TRUE)
#   options$flagSignificant: logical, flag significant pairs (default: TRUE)
#   options$alpha          : significance threshold (default: 0.05)
#
# Returns a named list with:
#   method, variables, n_variables,
#   correlation_matrix  (variable x variable, correlation coefficients),
#   pvalue_matrix       (variable x variable, p-values),
#   n_matrix            (variable x variable, pairwise n),
#   significant_pairs   (list of pairs with r, p, and flag)
#
# Visualization: correlation heatmap
#
# Dependencies: none beyond base R (uses stats::cor.test pairwise)

if (!exists("variables") || length(variables) == 0) {
  stop("Variable 'variables' is required - specify column names to correlate")
}

# Variables come as a list from JSON, extract as character vector
var_names <- if (is.list(variables)) unlist(variables) else variables

# Read flattened option variables directly.
# NOTE: Check for injected option variables *before* assigning local defaults,
# because exists() on a variable that was just assigned always returns TRUE.
method <- if (exists("method") && !is.null(get("method"))) {
  as.character(if (is.list(method)) method[[1]] else method)
} else {
  "pearson"
}

two_tailed <- if (exists("twoTailed") && !is.null(get("twoTailed"))) {
  as.logical(if (is.list(twoTailed)) twoTailed[[1]] else twoTailed)
} else {
  TRUE
}

flag_significant <- if (exists("flagSignificant") && !is.null(get("flagSignificant"))) {
  as.logical(if (is.list(flagSignificant)) flagSignificant[[1]] else flagSignificant)
} else {
  TRUE
}

alpha <- if (exists("alpha") && !is.null(get("alpha"))) {
  as.numeric(if (is.list(alpha)) alpha[[1]] else alpha)
} else {
  0.05
}

# Validate method
valid_methods <- c("pearson", "spearman", "kendall")
if (!(method %in% valid_methods)) {
  stop(paste("method must be one of:", paste(valid_methods, collapse = ", ")))
}

# Filter to variables that exist in the environment as individual column variables
available_vars <- Filter(function(v) exists(v), var_names)
if (length(available_vars) < 2) {
  stop("At least two numeric variables are required for correlation analysis")
}

# Build a data frame from the individually-injected column variables.
# Each column arrives as an R list from JSON; unlist() converts to a vector.
df_sub <- as.data.frame(
  lapply(available_vars, function(v) {
    x_raw <- get(v)
    as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
  }),
  stringsAsFactors = FALSE
)
names(df_sub) <- available_vars

n_vars <- length(available_vars)

# ---------------------------------------------------------------------------
# Pairwise correlation using cor.test for r, p-value, and n
# ---------------------------------------------------------------------------

alt_hyp <- if (two_tailed) "two.sided" else "greater"

r_matrix <- matrix(NA_real_, nrow = n_vars, ncol = n_vars,
                   dimnames = list(available_vars, available_vars))
p_matrix <- matrix(NA_real_, nrow = n_vars, ncol = n_vars,
                   dimnames = list(available_vars, available_vars))
n_matrix <- matrix(NA_integer_, nrow = n_vars, ncol = n_vars,
                   dimnames = list(available_vars, available_vars))

diag(r_matrix) <- 1
diag(p_matrix) <- NA_real_

significant_pairs <- list()

for (i in seq_len(n_vars)) {
  for (j in seq_len(n_vars)) {
    if (i == j) {
      # Diagonal: n for each variable
      n_matrix[i, j] <- sum(!is.na(df_sub[[available_vars[i]]]))
      next
    }

    xi <- df_sub[[available_vars[i]]]
    xj <- df_sub[[available_vars[j]]]

    # Complete pairs
    complete_idx <- !is.na(xi) & !is.na(xj)
    n_pair <- sum(complete_idx)
    n_matrix[i, j] <- n_pair

    if (n_pair < 3) {
      # Not enough observations for cor.test
      r_matrix[i, j] <- NA_real_
      p_matrix[i, j] <- NA_real_
      next
    }

    ct <- tryCatch(
      cor.test(xi[complete_idx], xj[complete_idx],
               method      = method,
               alternative = alt_hyp),
      error = function(e) NULL
    )

    if (is.null(ct)) {
      r_matrix[i, j] <- NA_real_
      p_matrix[i, j] <- NA_real_
    } else {
      r_matrix[i, j] <- ct$estimate
      p_matrix[i, j] <- ct$p.value

      # Record significant pairs (upper triangle only to avoid duplicates)
      if (i < j && flag_significant && !is.na(ct$p.value) && ct$p.value < alpha) {
        significant_pairs[[length(significant_pairs) + 1]] <- list(
          var1      = available_vars[i],
          var2      = available_vars[j],
          r         = round(ct$estimate, 4),
          p         = round(ct$p.value, 4),
          n         = n_pair,
          significant = TRUE
        )
      }
    }
  }
}

# Convert matrices to nested lists for JSON serialisation
matrix_to_list <- function(m) {
  lapply(seq_len(nrow(m)), function(i) {
    row_vals <- as.list(m[i, ])
    names(row_vals) <- colnames(m)
    row_vals
  })
}

# ---------------------------------------------------------------------------
# Visualization: correlation heatmap
# ---------------------------------------------------------------------------

# Color palette: blue (negative) -> white (zero) -> red (positive)
cor_palette <- colorRampPalette(c("#2166AC", "#F7F7F7", "#B2182B"))(101)
col_breaks  <- seq(-1, 1, length.out = 102)

# Map r values to colors
r_colors <- matrix("white", nrow = n_vars, ncol = n_vars,
                   dimnames = dimnames(r_matrix))

for (i in seq_len(n_vars)) {
  for (j in seq_len(n_vars)) {
    val <- r_matrix[i, j]
    if (!is.na(val)) {
      idx <- findInterval(val, col_breaks, rightmost.closed = TRUE)
      idx <- max(1, min(101, idx))
      r_colors[i, j] <- cor_palette[idx]
    }
  }
}

# Draw heatmap using base graphics
old_mar <- par(mar = c(6, 6, 4, 2))
plot(0, 0, type = "n",
     xlim = c(0.5, n_vars + 0.5),
     ylim = c(0.5, n_vars + 0.5),
     xaxt = "n", yaxt = "n",
     xlab = "", ylab = "",
     main = paste("Correlation Matrix (", method, ")", sep = ""))

axis(1, at = seq_len(n_vars), labels = available_vars, las = 2, cex.axis = 0.85)
axis(2, at = seq_len(n_vars), labels = rev(available_vars), las = 2, cex.axis = 0.85)

for (i in seq_len(n_vars)) {
  for (j in seq_len(n_vars)) {
    rect(j - 0.5, n_vars - i + 0.5,
         j + 0.5, n_vars - i + 1.5,
         col = r_colors[i, j], border = "white")
    val <- r_matrix[i, j]
    if (!is.na(val)) {
      text_col <- if (abs(val) > 0.6) "white" else "black"
      text(j, n_vars - i + 1, labels = sprintf("%.2f", val),
           cex = 0.75, col = text_col)
      # Mark significant cells (i != j) with asterisk
      if (i != j && !is.na(p_matrix[i, j]) && p_matrix[i, j] < alpha) {
        text(j + 0.35, n_vars - i + 1.3, labels = "*",
             cex = 0.9, col = text_col)
      }
    }
  }
}
par(old_mar)

# ---------------------------------------------------------------------------
# Compose result
# ---------------------------------------------------------------------------

result <- list(
  method               = method,
  two_tailed           = two_tailed,
  alpha                = alpha,
  variables            = available_vars,
  n_variables          = n_vars,
  correlation_matrix   = matrix_to_list(round(r_matrix, 4)),
  pvalue_matrix        = matrix_to_list(round(p_matrix, 4)),
  n_matrix             = matrix_to_list(n_matrix),
  significant_pairs    = significant_pairs
)

result
