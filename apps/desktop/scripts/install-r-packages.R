#!/usr/bin/env Rscript

# R Package Installation Script
# Usage: Rscript install-r-packages.R <library_path>
#
# This script installs required R packages to a specified library path.
# It includes error handling and progress messages.

# Get command line arguments
args <- commandArgs(trailingOnly = TRUE)

# Validate arguments
if (length(args) == 0) {
  cat("ERROR: Library path argument is required\n")
  cat("Usage: Rscript install-r-packages.R <library_path>\n")
  quit(status = 1)
}

library_path <- args[1]

# Validate that the library path exists or can be created
if (!dir.exists(library_path)) {
  cat("INFO: Creating library directory:", library_path, "\n")
  dir.create(library_path, recursive = TRUE, showWarnings = FALSE)

  if (!dir.exists(library_path)) {
    cat("ERROR: Failed to create library directory:", library_path, "\n")
    quit(status = 1)
  }
}

cat("INFO: Using library path:", library_path, "\n")

# Add the library path to .libPaths()
.libPaths(c(library_path, .libPaths()))
cat("INFO: Updated R library paths\n")

# Define required packages
required_packages <- c(
  "jsonlite",
  "psych",
  "lavaan",
  "lme4",
  "boot",
  "mediation",
  "lmerTest"
)

cat("INFO: Required packages to install:\n")
for (pkg in required_packages) {
  cat("  -", pkg, "\n")
}

# Set CRAN mirror
options(repos = c(CRAN = "https://cloud.r-project.org/"))
cat("INFO: CRAN mirror set to https://cloud.r-project.org/\n\n")

# Function to safely install packages
install_packages_safely <- function(pkgs, lib) {
  cat("INFO: Starting package installation...\n")

  for (pkg in pkgs) {
    cat("---\n")
    cat("INFO: Installing package:", pkg, "\n")

    tryCatch({
      install.packages(pkg, lib = lib, dependencies = TRUE, quiet = FALSE)

      # Verify installation
      if (require(pkg, lib.loc = lib, character.only = TRUE)) {
        cat("SUCCESS: Package", pkg, "installed and loaded successfully\n")
      } else {
        cat("ERROR: Package", pkg, "installed but failed to load\n")
        return(FALSE)
      }
    }, error = function(e) {
      cat("ERROR: Failed to install package", pkg, ":\n")
      cat("  ", conditionMessage(e), "\n")
    }, warning = function(w) {
      cat("WARNING:", conditionMessage(w), "\n")
    })
  }

  cat("---\n")
  return(TRUE)
}

# Install packages
success <- install_packages_safely(required_packages, library_path)

# Final verification
cat("\nINFO: Final verification - checking all packages are available\n")

all_available <- TRUE
for (pkg in required_packages) {
  available <- require(pkg, lib.loc = library_path, character.only = TRUE, quietly = TRUE)
  status <- if (available) "OK" else "MISSING"
  cat("  -", pkg, ":", status, "\n")
  if (!available) {
    all_available <- FALSE
  }
}

cat("\n")

if (all_available) {
  cat("SUCCESS: All required packages installed and available\n")
  quit(status = 0)
} else {
  cat("ERROR: Some packages are not available\n")
  quit(status = 1)
}
