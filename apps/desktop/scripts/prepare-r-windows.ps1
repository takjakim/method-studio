# PowerShell script to prepare R for Windows bundling
# This script downloads R, extracts it, and installs required packages

$ErrorActionPreference = "Stop"

# Configuration
$R_VERSION = "4.4.2"
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

# Step 3: Extract R installer (InnoSetup)
Write-Host "[3/7] Extracting R installer..." -ForegroundColor Green
$EXTRACT_DIR = Join-Path $TEMP_DIR "R-extracted"

try {
    # Use 7-Zip if available, otherwise use innounp or plain extraction
    if (Get-Command "7z.exe" -ErrorAction SilentlyContinue) {
        Write-Host "  Using 7-Zip for extraction..." -ForegroundColor Gray
        & 7z.exe x $INSTALLER_PATH "-o$EXTRACT_DIR" -y | Out-Null
    } else {
        # Extract using silent install to temp location
        Write-Host "  Using silent install method..." -ForegroundColor Gray
        $R_INSTALL_DIR = Join-Path $TEMP_DIR "R-install"
        & $INSTALLER_PATH /VERYSILENT /DIR=$R_INSTALL_DIR /NOICONS /TASKS="" | Out-Null
        Start-Sleep -Seconds 5

        # Wait for installation to complete
        $timeout = 120
        $elapsed = 0
        while (-not (Test-Path (Join-Path $R_INSTALL_DIR "bin\Rscript.exe")) -and $elapsed -lt $timeout) {
            Start-Sleep -Seconds 2
            $elapsed += 2
        }

        if ($elapsed -ge $timeout) {
            throw "Installation timeout - Rscript.exe not found"
        }

        $EXTRACT_DIR = $R_INSTALL_DIR
    }

    Write-Host "  Extraction complete" -ForegroundColor Gray
} catch {
    Write-Host "  ERROR: Failed to extract R installer" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Copy R to bundled directory
Write-Host "[4/7] Copying R to bundled directory..." -ForegroundColor Green

# Find R directory (could be R-4.4.2 or just R)
$R_SOURCE_DIR = $null
if (Test-Path (Join-Path $EXTRACT_DIR "R-$R_VERSION")) {
    $R_SOURCE_DIR = Join-Path $EXTRACT_DIR "R-$R_VERSION"
} elseif (Test-Path (Join-Path $EXTRACT_DIR "R")) {
    $R_SOURCE_DIR = Join-Path $EXTRACT_DIR "R"
} else {
    # Look for any directory starting with R-
    $R_DIRS = Get-ChildItem -Path $EXTRACT_DIR -Directory | Where-Object { $_.Name -match "^R-" }
    if ($R_DIRS.Count -gt 0) {
        $R_SOURCE_DIR = $R_DIRS[0].FullName
    } else {
        $R_SOURCE_DIR = $EXTRACT_DIR
    }
}

Write-Host "  Source: $R_SOURCE_DIR" -ForegroundColor Gray
Write-Host "  Destination: $BUNDLED_DIR" -ForegroundColor Gray

# Copy essential directories
Copy-Item -Path (Join-Path $R_SOURCE_DIR "bin") -Destination (Join-Path $BUNDLED_DIR "bin") -Recurse -Force
Copy-Item -Path (Join-Path $R_SOURCE_DIR "library") -Destination (Join-Path $BUNDLED_DIR "library") -Recurse -Force
Copy-Item -Path (Join-Path $R_SOURCE_DIR "etc") -Destination (Join-Path $BUNDLED_DIR "etc") -Recurse -Force
Copy-Item -Path (Join-Path $R_SOURCE_DIR "share") -Destination (Join-Path $BUNDLED_DIR "share") -Recurse -Force
Copy-Item -Path (Join-Path $R_SOURCE_DIR "include") -Destination (Join-Path $BUNDLED_DIR "include") -Recurse -Force

# Copy modules if they exist
if (Test-Path (Join-Path $R_SOURCE_DIR "modules")) {
    Copy-Item -Path (Join-Path $R_SOURCE_DIR "modules") -Destination (Join-Path $BUNDLED_DIR "modules") -Recurse -Force
}

Write-Host "  Copy complete" -ForegroundColor Gray

# Step 5: Install required packages
Write-Host "[5/7] Installing required R packages..." -ForegroundColor Green

$RSCRIPT_PATH = Join-Path $BUNDLED_DIR "bin\Rscript.exe"
if (-not (Test-Path $RSCRIPT_PATH)) {
    Write-Host "  ERROR: Rscript.exe not found at $RSCRIPT_PATH" -ForegroundColor Red
    exit 1
}

# Set R_LIBS to the bundled library
$env:R_LIBS = Join-Path $BUNDLED_DIR "library"

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
