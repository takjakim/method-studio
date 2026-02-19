use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

use super::installer::{find_rscript, find_python};

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

// ---------------------------------------------------------------------------
// AnalysisRequest / AnalysisResult
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    /// Identifies which analysis to run (e.g. "descriptives", "ttest")
    pub spec_id: String,
    /// Named variables passed into the script environment
    pub variables: HashMap<String, Value>,
    /// Arbitrary options forwarded to the script
    pub options: Value,
    /// Which engine to use: "r" or "python"
    pub engine: String,
    /// Rows of data (array of JSON objects)
    pub data: Vec<Value>,
    /// Dataset name (for reference, not used in scripts)
    #[serde(default)]
    pub dataset_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub success: bool,
    /// The deserialized result value returned by the script
    pub result: Option<Value>,
    /// Text output captured from the script (print / cat statements)
    pub output: String,
    /// Base64-encoded PNG plots produced by the script
    pub plots: Vec<String>,
    /// Error message if success == false
    pub error: Option<String>,
    /// The full script that was executed (for display in Syntax view)
    pub script: Option<String>,
    /// Simplified/summarized version of the script showing key commands
    pub script_summary: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate a simple unique request id without an external crate.
fn make_request_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("{}-{}", ts, pid)
}

/// Map a spec_id to the corresponding script filename (without extension).
/// Returns an error string when the spec_id is not recognised.
fn spec_to_script_name(spec_id: &str) -> Result<&'static str, String> {
    match spec_id {
        "descriptives" => Ok("descriptives"),
        "ttest" | "ttest-one-sample" | "ttest-independent" | "ttest-paired" => Ok("ttest"),
        "anova" | "anova-oneway" => Ok("anova"),
        "correlation" => Ok("correlation"),
        "efa" => Ok("efa"),
        "regression" | "regression-linear" => Ok("regression"),
        "mediation" => Ok("mediation"),
        "moderation" => Ok("moderation"),
        "cfa" => Ok("cfa"),
        "path-analysis" => Ok("path_analysis"),
        "moderated-mediation" | "moderated_mediation" => Ok("moderated_mediation"),
        "serial-mediation" | "serial_mediation" => Ok("serial_mediation"),
        "multigroup-cfa" | "multigroup_cfa" => Ok("multigroup_cfa"),
        "full-sem" | "full_sem" => Ok("full_sem"),
        "multilevel" | "multilevel-hlm" => Ok("multilevel"),
        "process-model-8" | "process_model_8" => Ok("process_model8"),
        "process-model-58" | "process_model_58" => Ok("process_model58"),
        "process-model-59" | "process_model_59" => Ok("process_model59"),
        other => Err(format!("Unknown spec_id: '{}'", other)),
    }
}

/// Extract additional variables from spec_id that scripts may need.
/// For example, "ttest-one-sample" yields test_type = "one-sample".
fn extract_spec_variables(spec_id: &str) -> Vec<(&'static str, Value)> {
    match spec_id {
        "ttest-one-sample" => vec![("test_type", json!("one-sample"))],
        "ttest-independent" => vec![("test_type", json!("independent"))],
        "ttest-paired" => vec![("test_type", json!("paired"))],
        "anova-oneway" => vec![("anova_type", json!("oneway"))],
        "regression-linear" => vec![("regression_type", json!("linear"))],
        "multilevel-hlm" => vec![("multilevel_type", json!("hlm"))],
        _ => vec![],
    }
}

/// Generate a simplified/summarized script showing the key analysis command.
fn generate_script_summary(
    spec_id: &str,
    engine: &str,
    variables: &HashMap<String, Value>,
    options: &Value,
) -> String {
    let is_r = engine.to_lowercase() == "r";

    // Helper to extract variable names from slot
    let get_vars = |key: &str| -> Vec<String> {
        variables
            .get(key)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default()
    };

    let get_option = |key: &str| -> Option<String> {
        options.get(key).map(|v| {
            if v.is_string() {
                v.as_str().unwrap_or("").to_string()
            } else {
                v.to_string()
            }
        })
    };

    match spec_id {
        "descriptives" => {
            let vars = get_vars("variables").join(", ");
            if is_r {
                format!(
                    "# Descriptive Statistics\n# Variables: {}\n\ndescribe(data[, c({})])",
                    vars, vars
                )
            } else {
                format!(
                    "# Descriptive Statistics\n# Variables: {}\n\ndf[[{}]].describe()",
                    vars, vars
                )
            }
        }
        "ttest-one-sample" => {
            let vars = get_vars("testVariables").join(", ");
            let test_val = get_option("testValue").unwrap_or("0".to_string());
            if is_r {
                format!(
                    "# One-Sample T-Test\n# Variable: {}\n# Test value: {}\n\nt.test({}, mu = {})",
                    vars, test_val, vars, test_val
                )
            } else {
                format!(
                    "# One-Sample T-Test\n# Variable: {}\n# Test value: {}\n\nstats.ttest_1samp({}, {})",
                    vars, test_val, vars, test_val
                )
            }
        }
        "ttest-independent" => {
            let vars = get_vars("testVariables").join(", ");
            let group_var = get_vars("groupingVariable").join("");
            let g1 = get_option("group1Value").unwrap_or("1".to_string());
            let g2 = get_option("group2Value").unwrap_or("2".to_string());
            if is_r {
                format!(
                    "# Independent-Samples T-Test\n# Variable: {}\n# Grouping: {} (groups: {}, {})\n\nt.test({} ~ {})",
                    vars, group_var, g1, g2, vars, group_var
                )
            } else {
                format!(
                    "# Independent-Samples T-Test\n# Variable: {}\n# Grouping: {} (groups: {}, {})\n\nstats.ttest_ind(group1, group2)",
                    vars, group_var, g1, g2
                )
            }
        }
        "ttest-paired" => {
            let var1 = get_vars("variable1").join("");
            let var2 = get_vars("variable2").join("");
            if is_r {
                format!(
                    "# Paired-Samples T-Test\n# Variables: {} vs {}\n\nt.test({}, {}, paired = TRUE)",
                    var1, var2, var1, var2
                )
            } else {
                format!(
                    "# Paired-Samples T-Test\n# Variables: {} vs {}\n\nstats.ttest_rel({}, {})",
                    var1, var2, var1, var2
                )
            }
        }
        "anova" | "anova-oneway" => {
            let dep_var = get_vars("dependentVariable").join("");
            let factor = get_vars("factor").join("");
            if is_r {
                format!(
                    "# One-Way ANOVA\n# Dependent: {}\n# Factor: {}\n\naov({} ~ {}, data = df)",
                    dep_var, factor, dep_var, factor
                )
            } else {
                format!(
                    "# One-Way ANOVA\n# Dependent: {}\n# Factor: {}\n\nstats.f_oneway(*groups)",
                    dep_var, factor
                )
            }
        }
        "correlation" => {
            let vars = get_vars("variables").join(", ");
            if is_r {
                format!(
                    "# Correlation Analysis\n# Variables: {}\n\ncor(data[, c({})])",
                    vars, vars
                )
            } else {
                format!(
                    "# Correlation Analysis\n# Variables: {}\n\ndf[[{}]].corr()",
                    vars, vars
                )
            }
        }
        "efa" => {
            let vars = get_vars("variables").join(", ");
            let n_factors = get_option("nFactors").unwrap_or("3".to_string());
            if is_r {
                format!(
                    "# Exploratory Factor Analysis\n# Variables: {}\n# Factors: {}\n\nfa(data, nfactors = {})",
                    vars, n_factors, n_factors
                )
            } else {
                format!(
                    "# Exploratory Factor Analysis\n# Variables: {}\n# Factors: {}\n\nFactorAnalyzer(n_factors={}).fit(data)",
                    vars, n_factors, n_factors
                )
            }
        }
        "regression" | "regression-linear" => {
            let dep_var = get_vars("dependentVariable").join("");
            let predictors = get_vars("predictors").join(" + ");
            if is_r {
                format!(
                    "# Linear Regression\n# Dependent: {}\n# Predictors: {}\n\nlm({} ~ {}, data = df)",
                    dep_var, predictors, dep_var, predictors
                )
            } else {
                format!(
                    "# Linear Regression\n# Dependent: {}\n# Predictors: {}\n\nsm.OLS(y, X).fit()",
                    dep_var, predictors
                )
            }
        }
        _ => {
            format!("# Analysis: {}\n# Engine: {}", spec_id, engine)
        }
    }
}

/// Locate the engines directory.
///
/// In development: looks for engines/ by traversing up from the executable.
/// In production: uses Tauri's resource directory where scripts are bundled.
fn engines_dir(app_handle: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    // First, try Tauri's resource directory (for bundled apps)
    if let Some(handle) = app_handle {
        if let Ok(resource_path) = handle.path().resource_dir() {
            // Check for bundled resources with _up_ prefix structure
            // (Tauri bundles ../../../engines as _up_/_up_/_up_/engines)
            let bundled_engines = resource_path.join("_up_").join("_up_").join("_up_").join("engines");
            if bundled_engines.is_dir() {
                return Ok(bundled_engines);
            }

            // Check direct engines directory
            let engines = resource_path.join("engines");
            if engines.is_dir() {
                return Ok(engines);
            }
        }
    }

    // Fallback: Walk up from the executable (for development)
    let exe = std::env::current_exe()
        .map_err(|e| format!("Cannot determine executable path: {}", e))?;

    let mut candidate = exe.as_path();
    // Traverse at most 10 parent directories.
    for _ in 0..10 {
        candidate = match candidate.parent() {
            Some(p) => p,
            None => break,
        };
        let engines = candidate.join("engines");
        if engines.is_dir() {
            return Ok(engines);
        }
    }

    // Final fallback: two levels up from binary
    let fallback = exe
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("engines"))
        .ok_or_else(|| "Cannot locate engines/ directory".to_string())?;

    if fallback.is_dir() {
        Ok(fallback)
    } else {
        Err(format!(
            "Cannot locate engines/ directory. Checked paths include: {}",
            fallback.display()
        ))
    }
}

/// Convert the Vec<Value> rows into the columnar data map the R wrapper expects:
///   { "colname": [v1, v2, ...], ... }
/// Ensures all column arrays have the same length by filling missing values with null.
fn rows_to_columnar(rows: &[Value]) -> Value {
    if rows.is_empty() {
        return json!({});
    }

    // First pass: collect all column names
    let mut all_columns: std::collections::HashSet<String> = std::collections::HashSet::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            for k in obj.keys() {
                all_columns.insert(k.clone());
            }
        }
    }

    // Second pass: build columnar data with consistent lengths
    let mut columns: HashMap<String, Vec<Value>> = HashMap::new();
    for col in &all_columns {
        columns.insert(col.clone(), Vec::with_capacity(rows.len()));
    }

    for row in rows {
        if let Some(obj) = row.as_object() {
            for col in &all_columns {
                let value = obj.get(col).cloned().unwrap_or(Value::Null);
                columns.get_mut(col).unwrap().push(value);
            }
        } else {
            // If row is not an object, push null for all columns
            for col in &all_columns {
                columns.get_mut(col).unwrap().push(Value::Null);
            }
        }
    }

    json!(columns)
}

// ---------------------------------------------------------------------------
// Engine dispatch
// ---------------------------------------------------------------------------

fn run_with_r_wrapper(
    wrapper_path: PathBuf,
    script_name: &str,
    request: &AnalysisRequest,
    req_id: &str,
) -> Result<AnalysisResult, String> {
    // The R wrapper exposes source_bundled() which resolves names relative to
    // its own directory, so we just call source_bundled('script.R') and then
    // reference `result` (the last evaluated expression is the return value).
    let r_script = format!(
        "source_bundled('{}.R')\nresult",
        script_name
    );

    // Read the actual script content for returning to the frontend
    let script_dir = wrapper_path
        .parent()
        .ok_or_else(|| "Cannot determine R scripts directory".to_string())?;
    let script_file = script_dir.join(format!("{}.R", script_name));
    let script_content = std::fs::read_to_string(&script_file)
        .unwrap_or_else(|_| format!("# Unable to read {}.R", script_name));

    let data_columnar = rows_to_columnar(&request.data);

    // Merge columnar data, variables, and options into the data map.
    let mut data_map = serde_json::Map::new();
    if let Some(cols) = data_columnar.as_object() {
        data_map.extend(cols.clone());
    }
    for (k, v) in &request.variables {
        data_map.insert(k.clone(), v.clone());
    }
    // Flatten options into the data map (R scripts expect individual variables)
    if let Some(opts) = request.options.as_object() {
        for (key, val) in opts {
            if data_map.contains_key(key) {
                eprintln!("[engine] WARNING: option key '{}' collides with existing data key; overwriting.", key);
            }
            data_map.insert(key.clone(), val.clone());
        }
    }
    // Add spec-derived variables (e.g., test_type for t-tests)
    for (key, val) in extract_spec_variables(&request.spec_id) {
        if data_map.contains_key(key) {
            eprintln!("[engine] WARNING: spec variable key '{}' collides with existing data key; overwriting.", key);
        }
        data_map.insert(key.to_string(), val);
    }

    let rpc_request = json!({
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "execute",
        "params": {
            "script": r_script,
            "data": data_map,
            "packages": []
        }
    });

    let request_json = serde_json::to_string(&rpc_request)
        .map_err(|e| format!("Failed to serialize R request: {}", e))?;

    // Debug: print executed script
    println!("=== R Script Execution ===");
    println!("Script: {}", r_script);
    println!("Data keys: {:?}", data_map.keys().collect::<Vec<_>>());
    println!("==========================");

    // Spawn wrapper, pipe JSON to stdin, collect stdout.
    let rscript_cmd = find_rscript()
        .ok_or_else(|| "Rscript not found. Please install R first.".to_string())?;

    // Pass script directory via environment variable for reliable path resolution
    let script_dir = wrapper_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut child = Command::new(&rscript_cmd)
        .arg(wrapper_path.to_str().unwrap_or("wrapper.R"))
        .env("METHOD_STUDIO_SCRIPT_DIR", &script_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Rscript: {}", e))?;

    {
        let mut stdin = child.stdin.take()
            .ok_or("Failed to open stdin for R process")?;
        writeln!(stdin, "{}", request_json)
            .map_err(|e| format!("Failed to write to R stdin: {}", e))?;
        stdin.flush()
            .map_err(|e| format!("Failed to flush R stdin: {}", e))?;
        // stdin is dropped here, closing the pipe
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Rscript: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Parse JSON-RPC response.
    let response: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse R wrapper response: {}. Raw: {}. Stderr: {}", e, stdout, stderr))?;

    // Generate script summary
    let script_summary = generate_script_summary(
        &request.spec_id,
        "r",
        &request.variables,
        &request.options,
    );

    if let Some(error) = response.get("error") {
        let msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown R error")
            .to_string();
        return Ok(AnalysisResult {
            success: false,
            result: None,
            output: String::new(),
            plots: vec![],
            error: Some(msg),
            script: Some(script_content.clone()),
            script_summary: Some(script_summary),
        });
    }

    let result_obj = response.get("result");
    let value = result_obj.and_then(|r| r.get("value")).cloned();
    let out_text = result_obj
        .and_then(|r| r.get("output"))
        .and_then(|o| o.as_str())
        .unwrap_or("")
        .to_string();
    let plots: Vec<String> = result_obj
        .and_then(|r| r.get("plots"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(AnalysisResult {
        success: true,
        result: value,
        output: out_text,
        plots,
        error: None,
        script: Some(script_content),
        script_summary: Some(script_summary),
    })
}

fn run_with_python_wrapper(
    wrapper_path: PathBuf,
    script_name: &str,
    request: &AnalysisRequest,
    req_id: &str,
) -> Result<AnalysisResult, String> {
    let script_dir = wrapper_path
        .parent()
        .ok_or_else(|| "Cannot determine Python scripts directory".to_string())?;
    let script_file = script_dir.join(format!("{}.py", script_name));
    let script_file_str = script_file
        .to_str()
        .ok_or_else(|| "Script path contains non-UTF8 characters".to_string())?
        .to_string();

    // Read the actual script content for returning to the frontend
    let script_content = std::fs::read_to_string(&script_file)
        .unwrap_or_else(|_| format!("# Unable to read {}.py", script_name));

    // Use __script_path__ so the wrapper reads the actual script file.
    let mut data_map = serde_json::Map::new();
    data_map.insert(
        "__script_path__".to_string(),
        json!(script_file_str),
    );

    // Inject columnar data under a "data" key plus individual variable keys.
    let data_columnar = rows_to_columnar(&request.data);
    if let Some(cols) = data_columnar.as_object() {
        data_map.extend(cols.clone());
    }
    for (k, v) in &request.variables {
        data_map.insert(k.clone(), v.clone());
    }
    // Flatten options into the data map (Python scripts expect individual variables)
    if let Some(opts) = request.options.as_object() {
        for (key, val) in opts {
            if data_map.contains_key(key) {
                eprintln!("[engine] WARNING: option key '{}' collides with existing data key; overwriting.", key);
            }
            data_map.insert(key.clone(), val.clone());
        }
    }
    // Add spec-derived variables (e.g., test_type for t-tests)
    for (key, val) in extract_spec_variables(&request.spec_id) {
        if data_map.contains_key(key) {
            eprintln!("[engine] WARNING: spec variable key '{}' collides with existing data key; overwriting.", key);
        }
        data_map.insert(key.to_string(), val);
    }

    let py_request = json!({
        "id": req_id,
        "script": "",
        "data": data_map,
        "packages": []
    });

    let request_json = serde_json::to_string(&py_request)
        .map_err(|e| format!("Failed to serialize Python request: {}", e))?;

    // Debug: print executed script
    println!("=== Python Script Execution ===");
    println!("Script file: {}", script_file_str);
    println!("Data keys: {:?}", data_map.keys().collect::<Vec<_>>());
    println!("===============================");

    let python_cmd = find_python()
        .ok_or_else(|| "Python not found. Please install Python first.".to_string())?;

    let mut child = Command::new(&python_cmd)
        .arg(wrapper_path.to_str().unwrap_or("wrapper.py"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn python3: {}", e))?;

    {
        let mut stdin = child.stdin.take()
            .ok_or("Failed to open stdin for Python process")?;
        writeln!(stdin, "{}", request_json)
            .map_err(|e| format!("Failed to write to Python stdin: {}", e))?;
        stdin.flush()
            .map_err(|e| format!("Failed to flush Python stdin: {}", e))?;
        // stdin is dropped here, closing the pipe
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for python3: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let response: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse Python wrapper response: {}. Raw: {}. Stderr: {}", e, stdout, stderr))?;

    // Generate script summary
    let script_summary = generate_script_summary(
        &request.spec_id,
        "python",
        &request.variables,
        &request.options,
    );

    let success = response
        .get("success")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);

    if !success {
        let error_msg = response
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Unknown Python error")
            .to_string();
        let out_text = response
            .get("output")
            .and_then(|o| o.as_str())
            .unwrap_or("")
            .to_string();
        return Ok(AnalysisResult {
            success: false,
            result: None,
            output: out_text,
            plots: vec![],
            error: Some(error_msg),
            script: Some(script_content.clone()),
            script_summary: Some(script_summary),
        });
    }

    let result_val = response.get("result").cloned();
    let out_text = response
        .get("output")
        .and_then(|o| o.as_str())
        .unwrap_or("")
        .to_string();
    let plots: Vec<String> = response
        .get("plots")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(AnalysisResult {
        success: true,
        result: result_val,
        output: out_text,
        plots,
        error: None,
        script: Some(script_content),
        script_summary: Some(script_summary),
    })
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn run_analysis(
    app_handle: tauri::AppHandle,
    request: AnalysisRequest,
) -> Result<AnalysisResult, String> {
    let script_name = spec_to_script_name(&request.spec_id)?;
    let req_id = make_request_id();

    let engines = engines_dir(Some(&app_handle))?;

    match request.engine.to_lowercase().as_str() {
        "r" => {
            let wrapper = engines.join("r-scripts").join("wrapper.R");
            if !wrapper.exists() {
                return Err(format!("R wrapper not found at: {}", wrapper.display()));
            }
            run_with_r_wrapper(wrapper, script_name, &request, &req_id)
        }
        "python" => {
            let wrapper = engines.join("python-scripts").join("wrapper.py");
            if !wrapper.exists() {
                return Err(format!(
                    "Python wrapper not found at: {}",
                    wrapper.display()
                ));
            }
            run_with_python_wrapper(wrapper, script_name, &request, &req_id)
        }
        other => Err(format!(
            "Unknown engine '{}'. Expected 'r' or 'python'.",
            other
        )),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineStatus {
    pub r_available: bool,
    pub python_available: bool,
    pub r_version: Option<String>,
    pub python_version: Option<String>,
}

#[tauri::command]
pub async fn run_r_script(script: String) -> Result<EngineResult, String> {
    let rscript_cmd = find_rscript()
        .ok_or_else(|| "Rscript not found. Please install R first.".to_string())?;

    let output = Command::new(&rscript_cmd)
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run R script: {}", e))?;

    Ok(EngineResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

#[tauri::command]
pub async fn run_python_script(script: String) -> Result<EngineResult, String> {
    let python_cmd = find_python()
        .ok_or_else(|| "Python not found. Please install Python first.".to_string())?;

    let output = Command::new(&python_cmd)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run Python script: {}", e))?;

    Ok(EngineResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

#[tauri::command]
pub async fn check_engine_status() -> Result<EngineStatus, String> {
    let rscript_path = find_rscript();
    let python_path = find_python();

    let r_output = rscript_path.as_ref().and_then(|p| {
        Command::new(p)
            .arg("--version")
            .output()
            .ok()
    });

    let python_output = python_path.as_ref().and_then(|p| {
        Command::new(p)
            .arg("--version")
            .output()
            .ok()
    });

    let r_available = r_output.as_ref().map(|o| o.status.success()).unwrap_or(false);
    let python_available = python_output.as_ref().map(|o| o.status.success()).unwrap_or(false);

    let r_version = if r_available {
        r_output.map(|o| {
            String::from_utf8_lossy(&o.stderr)
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        })
    } else {
        None
    };

    let python_version = if python_available {
        python_output.map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .to_string()
        })
    } else {
        None
    };

    Ok(EngineStatus {
        r_available,
        python_available,
        r_version,
        python_version,
    })
}
