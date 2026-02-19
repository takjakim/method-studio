# anova.R - One-Way ANOVA implementation for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   dependentVariable : list (length 1) of column name strings — the outcome variable slot
#   groupingVariable  : list (length 1) of column name strings — the grouping/factor slot
#   + columnar data with those column names present as bare variables
#
#   options$postHocTest      : "tukey" | "bonferroni" | "none"  (default "tukey")
#   options$confidenceLevel  : numeric confidence level, e.g. 0.95  (default 0.95)
#   options$effectSize       : logical — compute eta-squared (default TRUE)
#   options$missingValues    : "exclude-analysis" | "exclude-listwise"
#
# Returns a named list with:
#   f_statistic, df_between, df_within, p_value, significant,
#   eta_squared, eta_squared_label,
#   group_stats (list of per-group means, sds, ns),
#   post_hoc_results (Tukey HSD or Bonferroni comparisons, NULL if not run),
#   interpretation

if (!exists("dependentVariable") || length(dependentVariable) == 0) {
  stop("Variable slot 'dependentVariable' is required")
}
if (!exists("groupingVariable") || length(groupingVariable) == 0) {
  stop("Variable slot 'groupingVariable' is required")
}

# Variable slots come as lists from JSON — extract the column name strings
dep_name   <- if (is.list(dependentVariable)) dependentVariable[[1]] else dependentVariable[1]
group_name <- if (is.list(groupingVariable))  groupingVariable[[1]]  else groupingVariable[1]

if (!exists(dep_name))   stop(paste0("Column '", dep_name,   "' not found in data"))
if (!exists(group_name)) stop(paste0("Column '", group_name, "' not found in data"))

# Column data may come as lists from JSON — convert appropriately
dep_raw   <- get(dep_name)
group_raw <- get(group_name)

dependent <- as.numeric(if (is.list(dep_raw))   unlist(dep_raw)   else dep_raw)
group     <- if (is.list(group_raw)) unlist(group_raw) else group_raw

# ---- Read options ----

alpha    <- 0.05
post_hoc <- "tukey"

# Read flattened option variables directly
if (exists("confidenceLevel") && !is.null(confidenceLevel)) {
  alpha <- 1 - as.numeric(if (is.list(confidenceLevel)) confidenceLevel[[1]] else confidenceLevel)
}
if (exists("postHocTest") && !is.null(postHocTest)) {
  post_hoc <- as.character(if (is.list(postHocTest)) postHocTest[[1]] else postHocTest)
}

# ---- Validate and clean inputs ----

group <- as.factor(group)

keep      <- !is.na(dependent) & !is.na(group)
dependent <- dependent[keep]
group     <- droplevels(group[keep])

if (length(dependent) < 3) stop(paste0("'", dep_name, "' must have at least 3 non-missing values"))

n_groups <- nlevels(group)
if (n_groups < 2) stop(paste0("'", group_name, "' must have at least 2 distinct levels"))

group_levels <- levels(group)

# ---- Effect size label helper ----

eta_sq_label <- function(eta2) {
  if (eta2 < 0.01) {
    "negligible"
  } else if (eta2 < 0.06) {
    "small"
  } else if (eta2 < 0.14) {
    "medium"
  } else {
    "large"
  }
}

# ---- Run One-Way ANOVA ----

aov_fit   <- aov(dependent ~ group)
aov_table <- summary(aov_fit)[[1]]

ss_between <- aov_table["group",    "Sum Sq"]
ss_within  <- aov_table["Residuals","Sum Sq"]
ss_total   <- ss_between + ss_within

df_between <- aov_table["group",    "Df"]
df_within  <- aov_table["Residuals","Df"]

f_stat     <- aov_table["group",    "F value"]
p_val      <- aov_table["group",    "Pr(>F)"]

eta2       <- ss_between / ss_total

# ---- Per-group descriptives ----

group_stats <- lapply(group_levels, function(lv) {
  vals <- dependent[group == lv]
  list(
    n    = length(vals),
    mean = mean(vals),
    sd   = if (length(vals) > 1) sd(vals) else NA_real_,
    se   = if (length(vals) > 1) sd(vals) / sqrt(length(vals)) else NA_real_
  )
})
names(group_stats) <- group_levels

# ---- Post-hoc tests ----

post_hoc_results <- NULL

run_posthoc <- (post_hoc != "none") && (p_val < alpha)

if (run_posthoc) {
  if (post_hoc == "tukey" || post_hoc == "bonferroni") {
    ph     <- TukeyHSD(aov_fit, conf.level = 1 - alpha)
    ph_mat <- as.data.frame(ph$group)

    if (post_hoc == "bonferroni") {
      # Override Tukey p-values with Bonferroni-corrected ones
      raw_p <- pairwise.t.test(dependent, group,
                               p.adjust.method = "bonferroni")$p.value
      # Flatten the p-value matrix into comparison pairs
      pairs <- expand.grid(g1 = group_levels, g2 = group_levels,
                           stringsAsFactors = FALSE)
      pairs <- pairs[pairs$g1 < pairs$g2, ]

      bon_list <- lapply(seq_len(nrow(pairs)), function(i) {
        g1 <- pairs$g1[i]
        g2 <- pairs$g2[i]
        p_adj <- raw_p[max(g1, g2), min(g1, g2)]
        if (is.na(p_adj)) p_adj <- raw_p[min(g1, g2), max(g1, g2)]
        list(
          comparison  = paste0(g1, "-", g2),
          mean_diff   = mean(dependent[group == g1]) - mean(dependent[group == g2]),
          p_adjusted  = p_adj,
          significant = !is.na(p_adj) && p_adj < alpha,
          method      = "bonferroni"
        )
      })
      post_hoc_results <- bon_list
    } else {
      # Tukey HSD
      tukey_list <- lapply(rownames(ph_mat), function(comp) {
        list(
          comparison  = comp,
          mean_diff   = ph_mat[comp, "diff"],
          ci_lower    = ph_mat[comp, "lwr"],
          ci_upper    = ph_mat[comp, "upr"],
          p_adjusted  = ph_mat[comp, "p adj"],
          significant = ph_mat[comp, "p adj"] < alpha,
          method      = "tukey"
        )
      })
      post_hoc_results <- tukey_list
    }
  }
}

# ---- Visualisation ----

# Boxplot with jittered points
palette_cols <- c(
  "#4C72B0","#DD8452","#55A868","#C44E52",
  "#8172B2","#937860","#DA8BC3","#8C8C8C","#CCB974","#64B5CD"
)
group_cols <- palette_cols[seq_len(n_groups)]

boxplot(
  dependent ~ group,
  main   = sprintf("One-Way ANOVA: F(%d, %d) = %.3f, p %s %.4f",
                   df_between, df_within, f_stat,
                   if (p_val < alpha) "<" else ">=", alpha),
  xlab   = group_name,
  ylab   = dep_name,
  col    = group_cols,
  border = "#333333",
  notch  = FALSE
)
stripchart(
  dependent ~ group,
  vertical = TRUE,
  method   = "jitter",
  add      = TRUE,
  pch      = 20,
  col      = paste0(group_cols, "88")
)

# ---- Interpretation string ----

p_cmp <- if (p_val < alpha) "<" else ">="
sig_word <- if (p_val < alpha) "" else "not"
post_hoc_note <- if (!is.null(post_hoc_results)) {
  sprintf("Post-hoc %s tests were performed.", post_hoc)
} else if (p_val >= alpha) {
  "Post-hoc tests were not conducted (ANOVA not significant)."
} else {
  "Post-hoc tests were not requested."
}

interp <- sprintf(
  paste0(
    "One-Way ANOVA: F(%d, %d) = %.3f, p %s %.4f. ",
    "The effect of %s on %s is %s significant ",
    "(eta-squared = %.3f, %s effect). ",
    "%s"
  ),
  df_between,
  df_within,
  f_stat,
  p_cmp,
  alpha,
  group_name,
  dep_name,
  sig_word,
  eta2,
  eta_sq_label(eta2),
  post_hoc_note
)

# ---- Compose result ----

result <- list(
  f_statistic        = unname(f_stat),
  df_between         = df_between,
  df_within          = df_within,
  p_value            = p_val,
  significant        = p_val < alpha,
  eta_squared        = eta2,
  eta_squared_label  = eta_sq_label(eta2),
  group_stats        = group_stats,
  post_hoc_results   = post_hoc_results,
  post_hoc_method    = if (run_posthoc) post_hoc else "none",
  alpha              = alpha,
  interpretation     = interp
)

result
