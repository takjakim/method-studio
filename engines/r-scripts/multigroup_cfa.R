# multigroup_cfa.R - Multi-Group Confirmatory Factor Analysis (Measurement Invariance)
#
# Tests measurement invariance across groups by fitting a sequence of increasingly
# constrained CFA models (configural → metric → scalar → strict).
#
# Expected environment variables (set by wrapper.R from request data):
#   variables    : list of observed indicator variable names
#   factors      : named list mapping factor labels to their indicator variables
#                  e.g., list(F1 = list("item1","item2","item3"))
#   group_var    : character, name of the grouping variable column
#   <col_name>   : each column's data injected as a variable (list from JSON)
#   options      : optional named list with fields:
#                    estimator    : character, "ML" | "MLR" | "WLSMV" (default "ML")
#                    standardized : logical (default TRUE)
#                    ciLevel      : numeric in (0,1) (default 0.95)
#                    fitIndices   : logical (default TRUE)
#                    testStrict   : logical, also fit strict invariance (default TRUE)
#                    missingValues: character, "exclude-listwise" | "fiml" (default "exclude-listwise")
#
# Returns a named list assigned to `result` with:
#   configural_fit    : fit indices for configural model (baseline)
#   metric_fit        : fit indices for metric model (equal loadings)
#   scalar_fit        : fit indices for scalar model (equal intercepts)
#   strict_fit        : fit indices for strict model (equal residuals) [if testStrict=TRUE]
#   comparison_table  : list of model-comparison rows with delta fit indices and chi-sq diff tests
#   loadings          : list of factor loadings per group (from configural model)
#   model_syntax      : lavaan model string used
#   group_variable    : character, name of the grouping variable
#   groups            : character vector of group labels
#   n_per_group       : named list of observation counts per group
#   estimator         : character, estimator used
#   n                 : integer, total observations
#   interpretation    : character, narrative summary
#
# Dependencies: lavaan (loaded by caller via packages field)

# ---- Input validation ----

if (!exists("variables") || length(variables) == 0) {
  stop("Variable 'variables' is required - specify observed indicator column names")
}

if (!exists("factors") || length(factors) == 0) {
  stop("Variable 'factors' is required - specify factor structure as a named list")
}

if (!exists("group_var") || is.null(group_var) || !nzchar(
    if (is.list(group_var)) group_var[[1]] else group_var
)) {
  stop("Variable 'group_var' is required - specify the grouping variable column name")
}

if (!requireNamespace("lavaan", quietly = TRUE)) {
  stop("Package 'lavaan' is required. Install with install.packages('lavaan').")
}

# ---- Resolve inputs ----

var_names <- if (is.list(variables)) unlist(variables) else as.character(variables)
group_col  <- if (is.list(group_var)) group_var[[1]] else as.character(group_var)

if (length(var_names) < 2) stop("Multi-group CFA requires at least 2 observed variables.")
if (!is.list(factors)) stop("'factors' must be a named list mapping factor names to indicator lists.")

factor_names_vec <- names(factors)
if (is.null(factor_names_vec) || any(!nzchar(factor_names_vec))) {
  stop("All entries in 'factors' must have non-empty names.")
}

factor_indicators <- lapply(factors, function(inds) {
  if (is.list(inds)) unlist(inds) else as.character(inds)
})

# Validate minimum indicators
for (fn in factor_names_vec) {
  if (length(factor_indicators[[fn]]) < 2) {
    stop(paste0("Factor '", fn, "' has fewer than 2 indicators."))
  }
}

# ---- Resolve options ----

estimator_opt <- "ML"
do_std        <- TRUE
ci_level      <- 0.95
do_fit        <- TRUE
test_strict   <- TRUE
missing_opt   <- "exclude-listwise"

# Read flattened option variables directly (Rust engine injects each option as its own variable)
if (exists("estimator") && !is.null(estimator)) {
  estimator_opt <- toupper(as.character(if (is.list(estimator)) estimator[[1]] else estimator))
}
if (exists("standardized") && !is.null(standardized)) {
  do_std <- as.logical(if (is.list(standardized)) standardized[[1]] else standardized)
}
if (exists("ciLevel") && !is.null(ciLevel)) {
  ci_level <- as.numeric(if (is.list(ciLevel)) ciLevel[[1]] else ciLevel)
  if (is.na(ci_level) || ci_level <= 0 || ci_level >= 1) ci_level <- 0.95
}
if (exists("fitIndices") && !is.null(fitIndices)) {
  do_fit <- as.logical(if (is.list(fitIndices)) fitIndices[[1]] else fitIndices)
}
if (exists("testStrict") && !is.null(testStrict)) {
  test_strict <- as.logical(if (is.list(testStrict)) testStrict[[1]] else testStrict)
}
if (exists("missingValues") && !is.null(missingValues)) {
  missing_opt <- as.character(if (is.list(missingValues)) missingValues[[1]] else missingValues)
}

valid_estimators <- c("ML", "MLR", "WLSMV", "ULS", "DWLS", "GLS", "WLS")
if (!estimator_opt %in% valid_estimators) {
  warning(paste0("Unknown estimator '", estimator_opt, "'; defaulting to 'ML'."))
  estimator_opt <- "ML"
}

lavaan_missing <- if (missing_opt == "fiml") "ml" else "listwise"

# ---- Build data frame ----

all_cols <- c(var_names, group_col)
df_list  <- list()
for (cn in all_cols) {
  if (!exists(cn)) stop(paste0("Column '", cn, "' not found in data"))
  raw <- get(cn)
  if (cn == group_col) {
    df_list[[cn]] <- as.character(if (is.list(raw)) unlist(raw) else raw)
  } else {
    df_list[[cn]] <- as.numeric(if (is.list(raw)) unlist(raw) else raw)
  }
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

if (lavaan_missing == "listwise") {
  df <- df_raw[complete.cases(df_raw), , drop = FALSE]
} else {
  df <- df_raw
}

n_total <- nrow(df)
if (n_total < 10L) stop("Insufficient observations for multi-group CFA.")

# Group labels and counts
group_levels <- sort(unique(df[[group_col]]))
n_groups <- length(group_levels)
if (n_groups < 2L) stop("Grouping variable must have at least 2 distinct groups.")
if (n_groups > 20L) warning("More than 20 groups detected; results may be unstable.")

n_per_group <- lapply(group_levels, function(g) sum(df[[group_col]] == g))
names(n_per_group) <- group_levels

# ---- Build lavaan model syntax ----

model_lines <- vapply(factor_names_vec, function(fn) {
  inds <- factor_indicators[[fn]]
  paste0(fn, " =~ ", paste(inds, collapse = " + "))
}, character(1L))

model_syntax <- paste(model_lines, collapse = "\n")

# ---- Helper: extract fit indices ----

extract_fit <- function(fit_obj, model_name) {
  if (is.null(fit_obj)) return(NULL)
  fm <- tryCatch(
    lavaan::fitMeasures(fit_obj, c(
      "chisq", "df", "pvalue",
      "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper",
      "srmr", "aic", "bic"
    )),
    error = function(e) NULL
  )
  if (is.null(fm)) return(NULL)
  safe <- function(nm) {
    v <- unname(fm[nm])
    if (is.null(v) || length(v) == 0 || is.na(v)) NULL else round(v, 4)
  }
  list(
    model      = model_name,
    chi_square = safe("chisq"),
    df         = safe("df"),
    p_value    = safe("pvalue"),
    CFI        = safe("cfi"),
    TLI        = safe("tli"),
    RMSEA      = safe("rmsea"),
    RMSEA_lower = safe("rmsea.ci.lower"),
    RMSEA_upper = safe("rmsea.ci.upper"),
    SRMR       = safe("srmr"),
    AIC        = safe("aic"),
    BIC        = safe("bic"),
    converged  = lavaan::lavInspect(fit_obj, "converged")
  )
}

# ---- Helper: fit multi-group CFA model ----

fit_mg_model <- function(model_syntax, data, group_col, estimator, missing,
                         group.equal = character(0)) {
  tryCatch(
    lavaan::cfa(
      model       = model_syntax,
      data        = data,
      group       = group_col,
      group.equal = group.equal,
      estimator   = estimator,
      missing     = missing
    ),
    error = function(e) {
      if (estimator %in% c("WLSMV", "DWLS", "WLS")) {
        tryCatch(
          lavaan::cfa(
            model       = model_syntax,
            data        = data,
            group       = group_col,
            group.equal = group.equal,
            estimator   = "ML",
            missing     = missing
          ),
          error = function(e2) NULL
        )
      } else {
        NULL
      }
    }
  )
}

# ---- Fit models ----

# 1. Configural: same factor structure, all parameters free per group
fit_configural <- fit_mg_model(
  model_syntax, df, group_col, estimator_opt, lavaan_missing,
  group.equal = character(0)
)

if (is.null(fit_configural)) {
  stop("Configural model failed to fit. Check factor structure and data.")
}

# 2. Metric: equal factor loadings across groups
fit_metric <- fit_mg_model(
  model_syntax, df, group_col, estimator_opt, lavaan_missing,
  group.equal = "loadings"
)

# 3. Scalar: equal loadings + equal item intercepts
fit_scalar <- fit_mg_model(
  model_syntax, df, group_col, estimator_opt, lavaan_missing,
  group.equal = c("loadings", "intercepts")
)

# 4. Strict: equal loadings + intercepts + residual variances
fit_strict <- if (test_strict) {
  fit_mg_model(
    model_syntax, df, group_col, estimator_opt, lavaan_missing,
    group.equal = c("loadings", "intercepts", "residuals")
  )
} else NULL

# ---- Extract fit indices per model ----

configural_fit <- extract_fit(fit_configural, "Configural")
metric_fit     <- extract_fit(fit_metric,     "Metric")
scalar_fit     <- extract_fit(fit_scalar,     "Scalar")
strict_fit     <- if (!is.null(fit_strict)) extract_fit(fit_strict, "Strict") else NULL

# ---- Chi-square difference test helper ----

chi_diff_test <- function(fit_constrained, fit_free, label_constrained, label_free) {
  if (is.null(fit_constrained) || is.null(fit_free)) return(NULL)
  result <- tryCatch({
    lt <- lavaan::lavTestLRT(fit_free, fit_constrained)
    if (is.null(lt) || nrow(lt) < 2) return(NULL)
    # lavTestLRT returns the difference in row 2
    delta_chi  <- lt[["Chisq diff"]][2]
    delta_df   <- lt[["Df diff"]][2]
    p_val      <- lt[["Pr(>Chisq)"]][2]
    list(
      comparison         = paste0(label_constrained, " vs. ", label_free),
      delta_chi_sq       = if (!is.na(delta_chi)) round(delta_chi, 3) else NULL,
      delta_df           = if (!is.na(delta_df))  as.integer(delta_df) else NULL,
      p_value            = if (!is.na(p_val))     round(p_val, 4) else NULL,
      significant        = !is.na(p_val) && p_val < 0.05
    )
  }, error = function(e) NULL)
  result
}

# ---- Compute delta fit indices ----

delta_fit <- function(fit_a, fit_b, label) {
  # fit_a is constrained, fit_b is less constrained (baseline)
  if (is.null(fit_a) || is.null(fit_b)) return(NULL)
  delta_cfi  <- if (!is.null(fit_a$CFI)   && !is.null(fit_b$CFI))   round(fit_a$CFI   - fit_b$CFI,   4) else NULL
  delta_rmsea<- if (!is.null(fit_a$RMSEA) && !is.null(fit_b$RMSEA)) round(fit_a$RMSEA - fit_b$RMSEA, 4) else NULL
  list(
    model        = label,
    delta_CFI    = delta_cfi,
    delta_RMSEA  = delta_rmsea
  )
}

# ---- Build comparison table ----

comparison_table <- list()

# Metric vs Configural
chi_metric <- chi_diff_test(fit_metric, fit_configural, "Metric", "Configural")
df_metric  <- delta_fit(metric_fit, configural_fit, "Metric vs. Configural")
if (!is.null(chi_metric) || !is.null(df_metric)) {
  row <- c(
    list(comparison = "Metric vs. Configural"),
    if (!is.null(chi_metric)) chi_metric[c("delta_chi_sq", "delta_df", "p_value", "significant")] else list(),
    if (!is.null(df_metric))  df_metric[c("delta_CFI", "delta_RMSEA")] else list()
  )
  comparison_table <- c(comparison_table, list(row))
}

# Scalar vs Metric
chi_scalar <- chi_diff_test(fit_scalar, fit_metric, "Scalar", "Metric")
df_scalar  <- delta_fit(scalar_fit, metric_fit, "Scalar vs. Metric")
if (!is.null(chi_scalar) || !is.null(df_scalar)) {
  row <- c(
    list(comparison = "Scalar vs. Metric"),
    if (!is.null(chi_scalar)) chi_scalar[c("delta_chi_sq", "delta_df", "p_value", "significant")] else list(),
    if (!is.null(df_scalar))  df_scalar[c("delta_CFI", "delta_RMSEA")] else list()
  )
  comparison_table <- c(comparison_table, list(row))
}

# Strict vs Scalar
if (!is.null(fit_strict)) {
  chi_strict <- chi_diff_test(fit_strict, fit_scalar, "Strict", "Scalar")
  df_strict  <- delta_fit(strict_fit, scalar_fit, "Strict vs. Scalar")
  if (!is.null(chi_strict) || !is.null(df_strict)) {
    row <- c(
      list(comparison = "Strict vs. Scalar"),
      if (!is.null(chi_strict)) chi_strict[c("delta_chi_sq", "delta_df", "p_value", "significant")] else list(),
      if (!is.null(df_strict))  df_strict[c("delta_CFI", "delta_RMSEA")] else list()
    )
    comparison_table <- c(comparison_table, list(row))
  }
}

# ---- Extract loadings from configural model ----

loadings_by_group <- tryCatch({
  pe_all <- lavaan::parameterEstimates(
    fit_configural,
    ci           = TRUE,
    level        = ci_level,
    standardized = do_std
  )
  pe_load <- pe_all[pe_all$op == "=~", , drop = FALSE]

  lapply(group_levels, function(g) {
    g_rows <- if ("group" %in% names(pe_load)) {
      # Map group label to group index
      g_idx <- which(group_levels == g)
      pe_load[pe_load$group == g_idx, , drop = FALSE]
    } else {
      pe_load  # single group fallback
    }
    lapply(seq_len(nrow(g_rows)), function(i) {
      row <- g_rows[i, ]
      entry <- list(
        group     = g,
        factor    = as.character(row$lhs),
        indicator = as.character(row$rhs),
        estimate  = round(row$est, 4),
        se        = round(row$se,  4)
      )
      if (!is.null(row$pvalue) && !is.na(row$pvalue)) entry$p_value <- round(row$pvalue, 6)
      if (do_std && "std.all" %in% names(row) && !is.na(row$std.all)) {
        entry$std_loading <- round(row$std.all, 4)
      }
      entry
    })
  })
}, error = function(e) NULL)

# Flatten to a single list
loadings_flat <- if (!is.null(loadings_by_group)) unlist(loadings_by_group, recursive = FALSE) else NULL

# ---- Determine highest supported invariance level ----

determine_invariance <- function(comp_tbl) {
  # Rules: if model comparison is non-significant (p > .05) AND |delta CFI| <= .010,
  # the more constrained model is supported.
  supported <- "configural"
  for (row in comp_tbl) {
    sig         <- isTRUE(row$significant)
    delta_cfi   <- row$delta_CFI
    cfi_concern <- !is.null(delta_cfi) && abs(delta_cfi) > 0.010
    model_label <- row$comparison

    if (!sig && !cfi_concern) {
      if (grepl("Metric", model_label, fixed = TRUE)) supported <- "metric"
      else if (grepl("Scalar", model_label, fixed = TRUE)) supported <- "scalar"
      else if (grepl("Strict", model_label, fixed = TRUE)) supported <- "strict"
    } else {
      break  # Stop once invariance is violated
    }
  }
  supported
}

invariance_level <- if (length(comparison_table) > 0) {
  determine_invariance(comparison_table)
} else {
  "configural"
}

# ---- Build interpretation ----

inv_descriptions <- list(
  configural = "Configural invariance only: same factor structure holds across groups, but loadings and intercepts differ.",
  metric     = "Metric invariance: factor loadings are equal across groups, allowing meaningful comparison of relationships.",
  scalar     = "Scalar invariance: loadings and intercepts are equal, supporting latent mean comparisons across groups.",
  strict     = "Strict invariance: loadings, intercepts, and residual variances are equal across groups."
)

config_fit_str <- if (!is.null(configural_fit)) {
  cfi_v <- configural_fit$CFI; rmsea_v <- configural_fit$RMSEA
  parts <- character(0)
  if (!is.null(configural_fit$chi_square) && !is.null(configural_fit$df)) {
    parts <- c(parts, sprintf("chi2(%d) = %.2f", as.integer(configural_fit$df), configural_fit$chi_square))
  }
  if (!is.null(cfi_v))   parts <- c(parts, sprintf("CFI = %.3f", cfi_v))
  if (!is.null(rmsea_v)) parts <- c(parts, sprintf("RMSEA = %.3f", rmsea_v))
  paste(parts, collapse = ", ")
} else "unavailable"

interpretation <- sprintf(
  paste0(
    "Multi-group CFA with %d groups (%s) and %d factor(s) estimated using %s. ",
    "N = %d total observations. ",
    "Configural model fit: %s. ",
    "Conclusion: %s"
  ),
  n_groups,
  paste(group_levels, collapse = ", "),
  length(factor_names_vec),
  estimator_opt,
  n_total,
  config_fit_str,
  inv_descriptions[[invariance_level]]
)

# ---- Compose result ----

result <- list(
  configural_fit   = configural_fit,
  metric_fit       = metric_fit,
  scalar_fit       = scalar_fit,
  strict_fit       = strict_fit,
  comparison_table = comparison_table,
  loadings         = loadings_flat,
  model_syntax     = model_syntax,
  group_variable   = group_col,
  groups           = group_levels,
  n_per_group      = n_per_group,
  estimator        = estimator_opt,
  n                = n_total,
  n_factors        = length(factor_names_vec),
  factor_names     = factor_names_vec,
  variable_names   = var_names,
  invariance_level = invariance_level,
  interpretation   = interpretation
)

result
