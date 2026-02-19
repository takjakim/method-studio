#!/usr/bin/env Rscript
#
# wrapper.R - Method Studio R sidecar wrapper
#
# Reads one JSON request from stdin (newline-terminated), executes the user
# script in an isolated environment, captures output/plots, then writes one
# JSON response to stdout.
#
# Protocol: JSON-RPC 2.0 over stdin/stdout (newline-delimited)
#
# Input JSON shape:
#   {
#     "jsonrpc": "2.0",
#     "id": "<string>",
#     "method": "execute",
#     "params": {
#       "script": "<R code>",
#       "data": { "<name>": <value>, ... },
#       "packages": ["<pkg>", ...]
#     }
#   }
#
# Output JSON shape (success):
#   {
#     "jsonrpc": "2.0",
#     "id": "<string>",
#     "result": {
#       "value": <any>,
#       "output": "<captured text output>",
#       "plots": ["<base64 png>", ...]
#     }
#   }
#
# Output JSON shape (error):
#   {
#     "jsonrpc": "2.0",
#     "id": "<string>",
#     "error": { "code": <int>, "message": "<string>" }
#   }
#

suppressPackageStartupMessages({
  library(jsonlite)
})

# ---- Error codes (mirrors protocol.ts) ----
ERR_PARSE       <- -32700L
ERR_INVALID_REQ <- -32600L
ERR_INTERNAL    <- -32603L
ERR_R_EXEC      <- -32000L
ERR_PACKAGE     <- -32002L

# ---- Helpers ----

send_response <- function(id, result = NULL, error = NULL) {
  resp <- list(jsonrpc = "2.0", id = id)
  if (!is.null(error)) {
    resp$error <- error
  } else {
    resp$result <- result
  }
  cat(toJSON(resp, auto_unbox = TRUE, null = "null", na = "null"), "\n",
      sep = "", file = stdout())
  flush(stdout())
}

send_error <- function(id, code, message, data = NULL) {
  err <- list(code = code, message = message)
  if (!is.null(data)) err$data <- data
  send_response(id, error = err)
}

# Convert R objects to JSON-friendly form, tagging special types.
r_to_json_value <- function(x) {
  if (is.null(x)) return(NULL)

  if (is.factor(x)) {
    return(list(
      `__type` = "factor",
      levels   = levels(x),
      values   = as.integer(x)
    ))
  }

  if (is.data.frame(x)) {
    cols <- lapply(x, r_to_json_value)
    return(list(
      `__type` = "data.frame",
      columns  = cols,
      nrow     = nrow(x),
      ncol     = ncol(x)
    ))
  }

  if (is.matrix(x)) {
    dn <- dimnames(x)
    return(list(
      `__type`  = "matrix",
      data      = as.vector(x),
      nrow      = nrow(x),
      ncol      = ncol(x),
      dimnames  = list(dn[[1]], dn[[2]])
    ))
  }

  if (is.list(x)) {
    return(lapply(x, r_to_json_value))
  }

  # Scalar / vector: return as-is (jsonlite handles numeric, character, logical)
  return(x)
}

# Convert JSON-decoded value back to proper R type, recognising __type tags.
json_to_r_value <- function(x) {
  if (is.null(x)) return(NULL)

  if (is.list(x) && !is.null(x[["__type"]])) {
    typ <- x[["__type"]]

    if (typ == "factor") {
      f <- factor(x$levels[x$values], levels = x$levels)
      return(f)
    }

    if (typ == "data.frame") {
      cols <- lapply(x$columns, json_to_r_value)
      return(as.data.frame(cols, stringsAsFactors = FALSE))
    }

    if (typ == "matrix") {
      m <- matrix(x$data, nrow = x$nrow, ncol = x$ncol)
      if (!is.null(x$dimnames)) {
        rownames(m) <- x$dimnames[[1]]
        colnames(m) <- x$dimnames[[2]]
      }
      return(m)
    }
  }

  if (is.list(x)) {
    return(lapply(x, json_to_r_value))
  }

  return(x)
}

# Load packages, returning error message on failure.
load_packages <- function(pkgs) {
  if (is.null(pkgs) || length(pkgs) == 0) return(NULL)
  for (pkg in pkgs) {
    ok <- suppressWarnings(
      tryCatch(
        { library(pkg, character.only = TRUE, quietly = TRUE); TRUE },
        error = function(e) FALSE
      )
    )
    if (!ok) {
      return(paste0("Failed to load package: ", pkg))
    }
  }
  return(NULL)
}

# Resolve a bundled script name to full path relative to this wrapper.
script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_flag <- grep("^--file=", args, value = TRUE)
  if (length(file_flag) > 0) {
    return(dirname(sub("^--file=", "", file_flag[1])))
  }
  return(getwd())
}

source_bundled <- function(script_name) {
  path <- file.path(script_dir(), script_name)
  if (!file.exists(path)) {
    stop(paste0("Bundled script not found: ", script_name))
  }
  source(path, local = parent.frame())
}

# ---- Capture utilities ----

capture_plots <- function(expr_fn) {
  plots <- character(0)
  tmp   <- tempfile(fileext = ".png")
  on.exit({
    if (file.exists(tmp)) file.remove(tmp)
    if (!is.null(dev.list())) try(dev.off(), silent = TRUE)
  })

  png(tmp, width = 800, height = 600, res = 96)
  had_plot <- FALSE
  tryCatch({
    expr_fn()
    had_plot <- TRUE
  }, error = function(e) {
    try(dev.off(), silent = TRUE)
    stop(e)
  })
  dev.off()

  if (had_plot && file.exists(tmp) && file.info(tmp)$size > 0) {
    raw  <- readBin(tmp, "raw", file.info(tmp)$size)
    b64  <- jsonlite::base64_enc(raw)
    plots <- c(plots, b64)
  }

  return(plots)
}

# ---- Main execution loop ----

main <- function() {
  # Read exactly one line of JSON from stdin
  # NOTE: file("stdin") is required for piped input; stdin() reads from the script file itself
  stdin_con <- file("stdin", "r")
  on.exit(close(stdin_con), add = TRUE)
  input_line <- readLines(con = stdin_con, n = 1, warn = FALSE)

  if (length(input_line) == 0 || nchar(trimws(input_line)) == 0) {
    send_error("null", ERR_PARSE, "Empty input received")
    return(invisible(NULL))
  }

  # Parse request
  req <- tryCatch(
    fromJSON(input_line, simplifyVector = FALSE),
    error = function(e) {
      send_error("null", ERR_PARSE, paste0("JSON parse error: ", conditionMessage(e)))
      return(NULL)
    }
  )
  if (is.null(req)) return(invisible(NULL))

  req_id <- if (!is.null(req$id)) as.character(req$id) else "null"

  if (is.null(req$params) || is.null(req$params$script)) {
    send_error(req_id, ERR_INVALID_REQ, "Missing required field: params.script")
    return(invisible(NULL))
  }

  script   <- req$params$script
  raw_data <- req$params$data
  packages <- req$params$packages

  # Load requested packages
  pkg_err <- load_packages(packages)
  if (!is.null(pkg_err)) {
    send_error(req_id, ERR_PACKAGE, pkg_err)
    return(invisible(NULL))
  }

  # Build isolated execution environment with data pre-loaded
  env <- new.env(parent = globalenv())

  # Make source_bundled available inside user scripts
  assign("source_bundled", source_bundled, envir = env)

  if (!is.null(raw_data) && length(raw_data) > 0) {
    for (nm in names(raw_data)) {
      assign(nm, json_to_r_value(raw_data[[nm]]), envir = env)
    }
  }

  # Execute script, capturing text output and plots
  text_output <- ""
  plots       <- character(0)
  result_val  <- NULL
  exec_error  <- NULL

  text_output <- tryCatch(
    capture.output({
      plots <- tryCatch(
        capture_plots(function() {
          result_val <<- eval(parse(text = script), envir = env)
        }),
        error = function(e) {
          exec_error <<- conditionMessage(e)
          character(0)
        }
      )
    }),
    error = function(e) {
      exec_error <<- conditionMessage(e)
      character(0)
    }
  )

  if (!is.null(exec_error)) {
    # Still send partial output if available
    send_error(req_id, ERR_R_EXEC, exec_error,
               data = list(output = paste(text_output, collapse = "\n")))
    return(invisible(NULL))
  }

  json_result <- list(
    value  = r_to_json_value(result_val),
    output = paste(text_output, collapse = "\n"),
    plots  = as.list(plots)
  )

  send_response(req_id, result = json_result)
  invisible(NULL)
}

main()
