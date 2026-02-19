# PowerShell script to prepare R for Windows bundling
# This script downloads R, extracts it, and installs required packages

$ErrorActionPreference = "Stop"

# Configuration
$R_VERSION = "4.5.2"
$R_DOWNLOAD_URL = "https://cran.r-project.org/bin/windows/base/R-$R_VERSION-win.exe"
$SCRIPT_DIR = $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_DIR
$BUNDLED_DIR = Join-Path $PROJECT_ROOT "bundled-engines\windows-x64\r"
$TEMP_DIR = Join-Path $env:TEMP "r-windows-prep"

# Required R packages
$REQUIRED_PACKAGES = @(
    "jsonlite",
    "psych",
    "lavaan",
    "lme4",
    "boot",
    "mediation",
    "lmerTest"
)

# Directories to remove to reduce size
$DIRS_TO_REMOVE = @(
    "doc",
    "tests",
    "html"
)

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Windows R Preparation Script" -ForegroundColor Cyan
Write-Host "R Version: $R_VERSION" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create directories
Write-Host "[1/7] Creating directories..." -ForegroundColor Green
if (Test-Path $TEMP_DIR) {
    Remove-Item -Path $TEMP_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $TEMP_DIR -Force | Out-Null

if (Test-Path $BUNDLED_DIR) {
    Write-Host "  Removing existing bundled R directory..." -ForegroundColor Yellow
    Remove-Item -Path $BUNDLED_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $BUNDLED_DIR -Force | Out-Null

# Step 2: Download R installer
$INSTALLER_PATH = Join-Path $TEMP_DIR "R-installer.exe"
Write-Host "[2/7] Downloading R $R_VERSION installer..." -ForegroundColor Green
Write-Host "  URL: $R_DOWNLOAD_URL" -ForegroundColor Gray

try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $R_DOWNLOAD_URL -OutFile $INSTALLER_PATH -UseBasicParsing
    $ProgressPreference = 'Continue'
    Write-Host "  Downloaded successfully: $('{0:N2}' -f ((Get-Item $INSTALLER_PATH).Length / 1MB)) MB" -ForegroundColor Gray
} catch {
    Write-Host "  ERROR: Failed to download R installer" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Install R using silent installation (NSIS installer)
Write-Host "[3/7] Installing R using silent installation..." -ForegroundColor Green
$R_INSTALL_DIR = Join-Path $TEMP_DIR "R-install"

try {
    Write-Host "  Running R installer with silent flags..." -ForegroundColor Gray
    Write-Host "  Installation directory: $R_INSTALL_DIR" -ForegroundColor Gray

    # Create installation directory
    New-Item -ItemType Directory -Path $R_INSTALL_DIR -Force | Out-Null

    # Run the installer with NSIS silent flags
    # /S = Silent mode (NSIS standard)
    # /D= specifies installation directory (must be last parameter)
    $installArgs = @("/S", "/D=$R_INSTALL_DIR")
    $installProcess = Start-Process -FilePath $INSTALLER_PATH -ArgumentList $installArgs -Wait -PassThru -NoNewWindow

    Write-Host "  Installer process completed with exit code: $($installProcess.ExitCode)" -ForegroundColor Gray

    # Wait a few seconds for file system to settle
    Start-Sleep -Seconds 3

    # Wait for installation to complete by checking for Rscript.exe
    Write-Host "  Waiting for installation to complete..." -ForegroundColor Gray
    $timeout = 180  # 3 minutes timeout
    $elapsed = 0
    $rscriptPath = Join-Path $R_INSTALL_DIR "bin\Rscript.exe"

    while (-not (Test-Path $rscriptPath) -and $elapsed -lt $timeout) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        if ($elapsed % 10 -eq 0) {
            Write-Host "  Still waiting... ($elapsed seconds elapsed)" -ForegroundColor Gray
        }
    }

    if ($elapsed -ge $timeout) {
        Write-Host "  ERROR: Installation timeout - Rscript.exe not found after $timeout seconds" -ForegroundColor Red
        Write-Host "  Expected location: $rscriptPath" -ForegroundColor Red
        Write-Host "  Directory contents:" -ForegroundColor Red
        Get-ChildItem -Path $R_INSTALL_DIR -Recurse -Depth 2 | ForEach-Object {
            Write-Host "    $($_.FullName)" -ForegroundColor Red
        }
        throw "Installation timeout - Rscript.exe not found"
    }

    Write-Host "  Installation complete - R installed to $R_INSTALL_DIR" -ForegroundColor Green
    $EXTRACT_DIR = $R_INSTALL_DIR

} catch {
    Write-Host "  ERROR: Failed to install R" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Installation directory: $R_INSTALL_DIR" -ForegroundColor Red
    if (Test-Path $R_INSTALL_DIR) {
        Write-Host "  Directory contents:" -ForegroundColor Red
        Get-ChildItem -Path $R_INSTALL_DIR -Recurse -Depth 2 | ForEach-Object {
            Write-Host "    $($_.FullName)" -ForegroundColor Red
        }
    }
    exit 1
}

# Step 4: Copy R to bundled directory
Write-Host "[4/7] Copying R to bundled directory..." -ForegroundColor Green

Write-Host "  Analyzing installation structure..." -ForegroundColor Gray

# Find R directory by looking for bin/Rscript.exe
# The silent installer should have created the R installation directly in $EXTRACT_DIR
$R_SOURCE_DIR = $null

# Check if R was installed directly to $EXTRACT_DIR
$rscriptPath = Join-Path $EXTRACT_DIR "bin\Rscript.exe"
if (Test-Path $rscriptPath) {
    $R_SOURCE_DIR = $EXTRACT_DIR
    Write-Host "  Found R installation directly in install directory" -ForegroundColor Green
} else {
    # If not, search common subdirectory patterns
    Write-Host "  Rscript.exe not found in expected location, searching subdirectories..." -ForegroundColor Yellow
    Write-Host "  Directory contents:" -ForegroundColor Gray
    Get-ChildItem -Path $EXTRACT_DIR -Recurse -Depth 2 | Select-Object -First 50 | ForEach-Object {
        Write-Host "    $($_.FullName.Replace($EXTRACT_DIR, ''))" -ForegroundColor Gray
    }

    $searchPaths = @(
        (Join-Path $EXTRACT_DIR "R-$R_VERSION"),
        (Join-Path $EXTRACT_DIR "R")
    )

    # Also search for any R-* directories
    Get-ChildItem -Path $EXTRACT_DIR -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^R-" } | ForEach-Object {
        $searchPaths += $_.FullName
    }

    foreach ($path in $searchPaths) {
        $testPath = Join-Path $path "bin\Rscript.exe"
        if (Test-Path $testPath) {
            $R_SOURCE_DIR = $path
            Write-Host "  Found R installation at: $R_SOURCE_DIR" -ForegroundColor Green
            break
        }
    }

    if (-not $R_SOURCE_DIR) {
        Write-Host "  ERROR: Could not locate R installation (bin\Rscript.exe not found)" -ForegroundColor Red
        Write-Host "  Searched paths:" -ForegroundColor Red
        foreach ($path in $searchPaths) {
            Write-Host "    $path" -ForegroundColor Red
        }
        Write-Host "  Expected location: $rscriptPath" -ForegroundColor Red
        exit 1
    }
}

Write-Host "  Source: $R_SOURCE_DIR" -ForegroundColor Gray
Write-Host "  Destination: $BUNDLED_DIR" -ForegroundColor Gray

# Copy essential directories
$dirsToCheck = @("bin", "library", "etc", "share", "include", "modules")
foreach ($dir in $dirsToCheck) {
    $sourcePath = Join-Path $R_SOURCE_DIR $dir
    if (Test-Path $sourcePath) {
        Write-Host "  Copying $dir..." -ForegroundColor Gray
        Copy-Item -Path $sourcePath -Destination (Join-Path $BUNDLED_DIR $dir) -Recurse -Force
    } else {
        Write-Host "  Skipping $dir (not found)" -ForegroundColor Yellow
    }
}

Write-Host "  Copy complete" -ForegroundColor Gray

# Step 5: Install required packages
Write-Host "[5/7] Installing required R packages..." -ForegroundColor Green

$RSCRIPT_PATH = Join-Path $BUNDLED_DIR "bin\Rscript.exe"
if (-not (Test-Path $RSCRIPT_PATH)) {
    Write-Host "  ERROR: Rscript.exe not found at $RSCRIPT_PATH" -ForegroundColor Red
    exit 1
}

# Test Rscript execution before proceeding
Write-Host "  Testing R installation..." -ForegroundColor Gray
try {
    $testOutput = & $RSCRIPT_PATH --version 2>&1
    Write-Host "    R version: $testOutput" -ForegroundColor Gray
} catch {
    Write-Host "  ERROR: Rscript.exe failed to execute" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Path: $RSCRIPT_PATH" -ForegroundColor Red
    exit 1
}

# Set R_LIBS to the bundled library
$env:R_LIBS = Join-Path $BUNDLED_DIR "library"
Write-Host "  R_LIBS set to: $env:R_LIBS" -ForegroundColor Gray

foreach ($package in $REQUIRED_PACKAGES) {
    Write-Host "  Installing $package..." -ForegroundColor Gray

    $installCommand = @"
options(repos = c(CRAN = 'https://cloud.r-project.org'))
if (!require('$package', quietly = TRUE)) {
    install.packages('$package', lib = Sys.getenv('R_LIBS'), dependencies = TRUE, quiet = FALSE)
    cat('Successfully installed $package\n')
} else {
    cat('Package $package already installed\n')
}
"@

    try {
        $output = & $RSCRIPT_PATH -e $installCommand 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "    WARNING: Package installation may have failed" -ForegroundColor Yellow
            Write-Host "    Output: $output" -ForegroundColor Gray
        } else {
            Write-Host "    $package installed successfully" -ForegroundColor Gray
        }
    } catch {
        Write-Host "    ERROR: Failed to install $package" -ForegroundColor Red
        Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Step 6: Clean up unnecessary files
Write-Host "[6/7] Cleaning up unnecessary files..." -ForegroundColor Green

$initialSize = (Get-ChildItem -Path $BUNDLED_DIR -Recurse | Measure-Object -Property Length -Sum).Sum

foreach ($dir in $DIRS_TO_REMOVE) {
    $dirPath = Join-Path $BUNDLED_DIR $dir
    if (Test-Path $dirPath) {
        Write-Host "  Removing $dir..." -ForegroundColor Gray
        Remove-Item -Path $dirPath -Recurse -Force
    }
}

# Remove help and documentation from library packages
Write-Host "  Removing help files from packages..." -ForegroundColor Gray
Get-ChildItem -Path (Join-Path $BUNDLED_DIR "library") -Directory | ForEach-Object {
    $helpDir = Join-Path $_.FullName "help"
    $htmlDir = Join-Path $_.FullName "html"
    $docDir = Join-Path $_.FullName "doc"

    if (Test-Path $helpDir) { Remove-Item -Path $helpDir -Recurse -Force }
    if (Test-Path $htmlDir) { Remove-Item -Path $htmlDir -Recurse -Force }
    if (Test-Path $docDir) { Remove-Item -Path $docDir -Recurse -Force }
}

$finalSize = (Get-ChildItem -Path $BUNDLED_DIR -Recurse | Measure-Object -Property Length -Sum).Sum
$savedSpace = $initialSize - $finalSize

Write-Host "  Space saved: $('{0:N2}' -f ($savedSpace / 1MB)) MB" -ForegroundColor Gray

# Step 7: Verify installation
Write-Host "[7/7] Verifying installation..." -ForegroundColor Green

Write-Host "  Checking Rscript.exe..." -ForegroundColor Gray
if (Test-Path $RSCRIPT_PATH) {
    $versionOutput = & $RSCRIPT_PATH --version 2>&1
    Write-Host "    Found: $versionOutput" -ForegroundColor Gray
} else {
    Write-Host "    ERROR: Rscript.exe not found" -ForegroundColor Red
    exit 1
}

Write-Host "  Verifying installed packages..." -ForegroundColor Gray
$verifyCommand = @"
installed <- installed.packages(lib.loc = Sys.getenv('R_LIBS'))[, 'Package']
required <- c('$($REQUIRED_PACKAGES -join "', '")')
missing <- setdiff(required, installed)
if (length(missing) > 0) {
    cat('MISSING:', paste(missing, collapse = ', '), '\n')
    quit(status = 1)
} else {
    cat('All required packages installed\n')
}
"@

try {
    $verifyOutput = & $RSCRIPT_PATH -e $verifyCommand 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    WARNING: Some packages may be missing" -ForegroundColor Yellow
        Write-Host "    $verifyOutput" -ForegroundColor Gray
    } else {
        Write-Host "    $verifyOutput" -ForegroundColor Gray
    }
} catch {
    Write-Host "    ERROR: Verification failed" -ForegroundColor Red
    Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup temp directory
Write-Host ""
Write-Host "Cleaning up temporary files..." -ForegroundColor Green
Remove-Item -Path $TEMP_DIR -Recurse -Force

# Final summary
Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "R Preparation Complete!" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Bundled R location: $BUNDLED_DIR" -ForegroundColor Green
Write-Host "Total size: $('{0:N2}' -f ($finalSize / 1MB)) MB" -ForegroundColor Green
Write-Host ""
Write-Host "The bundled R is ready for packaging with your desktop app." -ForegroundColor Green
Write-Host ""
