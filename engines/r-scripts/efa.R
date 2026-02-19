# efa.R - Exploratory Factor Analysis for Method Studio
#
# Expected environment variables (set by wrapper.R from request data):
#   variables        : list/character vector of column names to analyze (min 3)
#   <col_name>       : each column's data injected as a variable (list from JSON)
#   nFactors         : integer, number of factors to extract (0 = auto via Kaiser)
#   rotation         : character, rotation method: "varimax" | "promax" | "oblimin" |
#                      "quartimax" | "none" (default: "varimax")
#   extractionMethod : character, extraction method: "minres" | "ml" | "pa" | "wls" | "gls"
#                      (default: "minres")
#   kmoTest          : logical, compute KMO measure (default: TRUE)
#   bartlettTest     : logical, compute Bartlett's test (default: TRUE)
#   screePlot        : logical, draw scree plot (default: TRUE)
#   factorScores     : logical, compute factor scores (default: FALSE)
#   suppressLoadings : numeric, suppress loadings below this value (default: 0.3)
#   missingValues    : character, "exclude-listwise" | "pairwise" (default: "exclude-listwise")
#   alpha            : numeric, significance level for Bartlett's test (default: 0.05)
#
# Returns a named list assigned to `result` with:
#   adequacy           : list with KMO and Bartlett's test results
#   eigenvalues        : numeric vector
#   variance_explained : list of per-factor variance info
#   loadings           : list of per-variable loading rows
#   communalities      : named list (h2 per variable)
#   uniqueness         : named list (u2 per variable)
#   n_factors          : integer, number of factors extracted
#   rotation           : character, rotation used
#   fm                 : character, extraction method used
#   n                  : integer, number of observations
#   n_vars             : integer, number of variables analysed
#   variable_names     : character vector of analysed variable names
#   interpretation     : character, summary interpretation
#
# Dependencies: psych (loaded by caller via packages field)

# ---- Input validation ----

if (!exists("variables") || length(variables) == 0) {
  stop("Variable 'variables' is required - specify column names to analyze")
}

if (!requireNamespace("psych", quietly = TRUE)) {
  stop("Package 'psych' is required for EFA. Install it with install.packages('psych').")
}

# Variables come as a list from JSON - extract as character vector
var_names <- if (is.list(variables)) unlist(variables) else variables

# Build data frame from injected column variables (same pattern as descriptives.R)
df_list <- list()
for (vn in var_names) {
  if (!exists(vn)) {
    stop(paste0("Column '", vn, "' not found in data"))
  }
  x_raw <- get(vn)
  df_list[[vn]] <- as.numeric(if (is.list(x_raw)) unlist(x_raw) else x_raw)
}
df_raw <- as.data.frame(df_list, stringsAsFactors = FALSE)

# Enforce minimum variables
if (ncol(df_raw) < 3) {
  stop(paste0("EFA requires at least 3 numeric variables; only ", ncol(df_raw), " provided."))
}

# ---- Options ----

# nFactors: 0 or missing means auto-detect
if (!exists("nFactors") || is.null(nFactors)) {
  nfactors_req <- 0L
} else {
  # JSON numbers come as lists; extract scalar
  nfactors_raw <- if (is.list(nFactors)) nFactors[[1]] else nFactors
  nfactors_req <- as.integer(nfactors_raw)
}

rotation_opt <- "varimax"
if (exists("rotation") && !is.null(rotation)) {
  rotation_opt <- if (is.list(rotation)) rotation[[1]] else rotation
}

fm_opt <- "minres"
if (exists("extractionMethod") && !is.null(extractionMethod)) {
  fm_raw <- if (is.list(extractionMethod)) extractionMethod[[1]] else extractionMethod
  # Map spec values to psych values
  fm_opt <- switch(fm_raw,
    "minres" = "minres",
    "ml"     = "ml",
    "pa"     = "pa",
    "wls"    = "wls",
    "gls"    = "gls",
    "minres"  # default fallback
  )
}

do_kmo       <- TRUE
if (exists("kmoTest") && !is.null(kmoTest)) {
  do_kmo <- as.logical(if (is.list(kmoTest)) kmoTest[[1]] else kmoTest)
}

do_bartlett  <- TRUE
if (exists("bartlettTest") && !is.null(bartlettTest)) {
  do_bartlett <- as.logical(if (is.list(bartlettTest)) bartlettTest[[1]] else bartlettTest)
}

do_scree     <- TRUE
if (exists("screePlot") && !is.null(screePlot)) {
  do_scree <- as.logical(if (is.list(screePlot)) screePlot[[1]] else screePlot)
}

alpha_opt <- 0.05
if (exists("alpha") && !is.null(alpha)) {
  alpha_opt <- as.numeric(if (is.list(alpha)) alpha[[1]] else alpha)
}

missing_opt <- "exclude-listwise"
if (exists("missingValues") && !is.null(missingValues)) {
  missing_opt <- if (is.list(missingValues)) missingValues[[1]] else missingValues
}

# Validate rotation
valid_rotations <- c("varimax", "promax", "oblimin", "none", "quartimax")
if (!rotation_opt %in% valid_rotations) {
  warning(paste0("Unknown rotation '", rotation_opt, "'; defaulting to 'varimax'."))
  rotation_opt <- "varimax"
}

# Validate extraction method
valid_fm <- c("minres", "ml", "pa", "wls", "gls")
if (!fm_opt %in% valid_fm) {
  warning(paste0("Unknown extraction method '", fm_opt, "'; defaulting to 'minres'."))
  fm_opt <- "minres"
}

# ---- Handle missing values ----

if (missing_opt == "pairwise") {
  # Use pairwise complete observations for correlation; keep all rows
  df <- df_raw
  use_str <- "pairwise.complete.obs"
} else {
  # Listwise deletion (default)
  df <- df_raw[complete.cases(df_raw), , drop = FALSE]
  use_str <- "everything"
}

n_obs <- nrow(df)

if (n_obs < ncol(df) + 1) {
  stop(paste0(
    "Insufficient observations (", n_obs, ") for ", ncol(df),
    " variables. Need at least ", ncol(df) + 1, " complete cases."
  ))
}

# ---- Adequacy Tests ----

cor_matrix <- cor(df, use = if (missing_opt == "pairwise") "pairwise.complete.obs" else "everything")

# KMO (Kaiser-Meyer-Olkin measure of sampling adequacy)
kmo_overall  <- NULL
kmo_per_var  <- NULL
kmo_interp   <- NULL

kmo_interpret <- function(msa) {
  if (msa >= 0.90) {
    "Marvelous"
  } else if (msa >= 0.80) {
    "Meritorious"
  } else if (msa >= 0.70) {
    "Middling"
  } else if (msa >= 0.60) {
    "Mediocre"
  } else if (msa >= 0.50) {
    "Miserable"
  } else {
    "Unacceptable"
  }
}

if (do_kmo) {
  kmo_result  <- psych::KMO(cor_matrix)
  kmo_overall <- round(unname(kmo_result$MSA), 4)
  kmo_per_var <- round(kmo_result$MSAi, 4)
  kmo_interp  <- kmo_interpret(kmo_overall)
}

# Bartlett's Test of Sphericity
bart_chi_sq  <- NULL
bart_df      <- NULL
bart_p_value <- NULL
bart_sig     <- NULL
bart_note    <- NULL

if (do_bartlett) {
  bart_result  <- psych::cortest.bartlett(cor_matrix, n = n_obs)
  bart_chi_sq  <- round(unname(bart_result$chisq), 4)
  bart_df      <- unname(bart_result$df)
  bart_p_value <- round(unname(bart_result$p.value), 8)
  bart_sig     <- bart_p_value < alpha_opt
  bart_note    <- if (bart_sig) {
    "Bartlett's test is significant: factor analysis is appropriate."
  } else {
    "Bartlett's test is NOT significant: factor analysis may not be appropriate."
  }
}

adequacy <- list(
  kmo = if (do_kmo) list(
    overall        = kmo_overall,
    per_variable   = as.list(kmo_per_var),
    interpretation = kmo_interp
  ) else NULL,
  bartlett = if (do_bartlett) list(
    chi_square  = bart_chi_sq,
    df          = bart_df,
    p_value     = bart_p_value,
    significant = bart_sig,
    note        = bart_note
  ) else NULL
)

# ---- Determine nfactors ----

if (nfactors_req <= 0L) {
  # Kaiser criterion: eigenvalues > 1
  eig_vals <- eigen(cor_matrix)$values
  nfactors <- max(1L, as.integer(sum(eig_vals > 1.0)))
} else {
  nfactors <- nfactors_req
  max_factors <- max(1L, floor((ncol(df) - 1) / 2))
  if (nfactors > max_factors) {
    warning(paste0(
      "nFactors (", nfactors, ") exceeds maximum recommended (",
      max_factors, "); setting to ", max_factors
    ))
    nfactors <- max_factors
  }
}

# ---- EFA ----

rotate_arg <- if (rotation_opt == "none") "none" else rotation_opt

# Try EFA with requested method, fall back to more robust methods if needed
fa_result <- tryCatch({
  psych::fa(
    r        = df,
    nfactors = nfactors,
    rotate   = rotate_arg,
    fm       = fm_opt,
    scores   = "none",
    warnings = FALSE
  )
}, error = function(e) {
  # If ML or other method fails, try minres
  if (fm_opt != "minres") {
    warning(paste0("Method '", fm_opt, "' failed, trying 'minres': ", e$message))
    tryCatch({
      psych::fa(r = df, nfactors = nfactors, rotate = rotate_arg, fm = "minres", scores = "none", warnings = FALSE)
    }, error = function(e2) {
      # If minres also fails, try principal axis factoring
      warning(paste0("Method 'minres' also failed, trying 'pa': ", e2$message))
      psych::fa(r = df, nfactors = nfactors, rotate = rotate_arg, fm = "pa", scores = "none", warnings = FALSE)
    })
  } else {
    # minres failed, try pa
    warning(paste0("Method 'minres' failed, trying 'pa': ", e$message))
    psych::fa(r = df, nfactors = nfactors, rotate = rotate_arg, fm = "pa", scores = "none", warnings = FALSE)
  }
})

# ---- Extract outputs ----

# Loadings (vars x factors)
fa_loadings_raw <- unclass(fa_result$loadings)
factor_names    <- paste0("F", seq_len(nfactors))
rownames(fa_loadings_raw) <- colnames(df)
colnames(fa_loadings_raw) <- factor_names

# Convert to a list of lists for JSON-friendly serialisation
loadings_list <- lapply(seq_len(nrow(fa_loadings_raw)), function(i) {
  row <- as.list(round(fa_loadings_raw[i, ], 4))
  c(list(variable = rownames(fa_loadings_raw)[i]), row)
})

# Communalities and uniqueness
communalities <- round(fa_result$communality, 4)
uniqueness    <- round(fa_result$uniquenesses, 4)
names(communalities) <- colnames(df)
names(uniqueness)    <- colnames(df)

# Eigenvalues (from correlation matrix)
eigenvalues <- round(eigen(cor_matrix)$values, 4)

# Variance explained table
ss_loadings <- colSums(fa_loadings_raw^2)
prop_var    <- ss_loadings / ncol(df)
cumul_var   <- cumsum(prop_var)

variance_explained <- lapply(seq_len(nfactors), function(i) {
  list(
    factor      = factor_names[i],
    ss_loadings = round(ss_loadings[i], 4),
    prop_var    = round(prop_var[i], 4),
    cumul_var   = round(cumul_var[i], 4)
  )
})

# ---- Scree Plot ----

if (do_scree) {
  n_eig_to_plot <- min(ncol(df), 20L)
  plot(
    x    = seq_len(n_eig_to_plot),
    y    = eigenvalues[seq_len(n_eig_to_plot)],
    type = "b",
    pch  = 20,
    col  = "#4C72B0",
    xlab = "Factor Number",
    ylab = "Eigenvalue",
    main = "Scree Plot",
    ylim = c(0, max(eigenvalues[seq_len(n_eig_to_plot)]) * 1.1),
    xaxt = "n"
  )
  axis(1, at = seq_len(n_eig_to_plot))
  abline(h = 1, col = "#DD8452", lwd = 1.5, lty = 2)
  abline(v = nfactors, col = "#55A868", lwd = 1.5, lty = 3)
  legend(
    "topright",
    legend = c("Eigenvalue = 1", paste0("Retained (", nfactors, " factors)")),
    col    = c("#DD8452", "#55A868"),
    lty    = c(2, 3),
    lwd    = 1.5,
    bty    = "n"
  )
}

# ---- Interpretation ----

adequacy_ok <- (!is.null(kmo_overall) && kmo_overall >= 0.60) &&
               (!is.null(bart_sig) && bart_sig)
var_pct     <- round(cumul_var[nfactors] * 100, 1)

kmo_str  <- if (!is.null(kmo_overall)) {
  sprintf("KMO = %.3f (%s). ", kmo_overall, kmo_interp)
} else {
  ""
}

bart_p_cmp <- if (!is.null(bart_sig) && bart_sig) "<" else ">="
bart_str <- if (!is.null(bart_sig)) {
  sprintf("Bartlett's test: chi2(%d) = %.2f, p %s %.4f. ",
    bart_df, bart_chi_sq, bart_p_cmp, alpha_opt)
} else {
  ""
}

adequacy_note <- if (adequacy_ok) {
  "Data adequacy is acceptable for EFA."
} else {
  "Note: Data adequacy may be insufficient for reliable EFA."
}

interpretation <- sprintf(
  paste0(
    "EFA with %d factor(s) extracted using %s and %s rotation. ",
    "%s%s",
    "Cumulative variance explained by %d factor(s): %.1f%%. ",
    "%s"
  ),
  nfactors, fm_opt, rotation_opt,
  kmo_str, bart_str,
  nfactors, var_pct,
  adequacy_note
)

# ---- Compose result ----

result <- list(
  adequacy           = adequacy,
  eigenvalues        = eigenvalues,
  variance_explained = variance_explained,
  loadings           = loadings_list,
  communalities      = as.list(communalities),
  uniqueness         = as.list(uniqueness),
  n_factors          = nfactors,
  rotation           = rotation_opt,
  fm                 = fm_opt,
  n                  = n_obs,
  n_vars             = ncol(df),
  variable_names     = colnames(df),
  interpretation     = interpretation
)

result
