# PowerShell script to prepare portable Python for Windows x64
# This script downloads Python embeddable package and sets up required dependencies

$ErrorActionPreference = "Stop"

# Configuration
$PYTHON_VERSION = "3.12.8"
$PYTHON_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-amd64.zip"
$GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"

# Paths
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$DESKTOP_DIR = Split-Path -Parent $SCRIPT_DIR
$BUNDLED_DIR = Join-Path $DESKTOP_DIR "bundled-engines"
$WINDOWS_DIR = Join-Path $BUNDLED_DIR "windows-x64"
$PYTHON_DIR = Join-Path $WINDOWS_DIR "python"
$TEMP_DIR = Join-Path $env:TEMP "method-studio-python-setup"

# Required packages
$REQUIRED_PACKAGES = @(
    "pandas",
    "numpy",
    "scipy",
    "statsmodels",
    "semopy",
    "factor_analyzer",
    "pingouin",
    "matplotlib",
    "seaborn",
    "scikit-learn"
)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Method Studio - Python Preparation for Windows" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Create directories
Write-Host "[1/7] Creating directory structure..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $PYTHON_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $TEMP_DIR | Out-Null
Write-Host "  Created: $PYTHON_DIR" -ForegroundColor Green

# Download Python embeddable package
Write-Host ""
Write-Host "[2/7] Downloading Python $PYTHON_VERSION embeddable package..." -ForegroundColor Yellow
$pythonZip = Join-Path $TEMP_DIR "python-embed.zip"
try {
    Invoke-WebRequest -Uri $PYTHON_URL -OutFile $pythonZip -UseBasicParsing
    Write-Host "  Downloaded: $(Split-Path $pythonZip -Leaf)" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Failed to download Python" -ForegroundColor Red
    Write-Host "  URL: $PYTHON_URL" -ForegroundColor Red
    throw
}

# Extract Python
Write-Host ""
Write-Host "[3/7] Extracting Python..." -ForegroundColor Yellow
try {
    Expand-Archive -Path $pythonZip -DestinationPath $PYTHON_DIR -Force
    Write-Host "  Extracted to: $PYTHON_DIR" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Failed to extract Python" -ForegroundColor Red
    throw
}

# Verify python.exe exists
$pythonExe = Join-Path $PYTHON_DIR "python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Host "  ERROR: python.exe not found after extraction" -ForegroundColor Red
    throw "Python executable not found"
}
Write-Host "  Verified: python.exe" -ForegroundColor Green

# Enable pip in embeddable Python by uncommenting import site
Write-Host ""
Write-Host "[4/7] Configuring Python for pip..." -ForegroundColor Yellow
$pthFiles = Get-ChildItem -Path $PYTHON_DIR -Filter "*._pth"
foreach ($pthFile in $pthFiles) {
    $content = Get-Content $pthFile.FullName
    $newContent = $content -replace "^#import site", "import site"
    Set-Content -Path $pthFile.FullName -Value $newContent
    Write-Host "  Modified: $($pthFile.Name)" -ForegroundColor Green
}

# Download and install pip
Write-Host ""
Write-Host "[5/7] Installing pip..." -ForegroundColor Yellow
$getPipPath = Join-Path $TEMP_DIR "get-pip.py"
try {
    Invoke-WebRequest -Uri $GET_PIP_URL -OutFile $getPipPath -UseBasicParsing
    Write-Host "  Downloaded: get-pip.py" -ForegroundColor Green

    & $pythonExe $getPipPath --no-warn-script-location
    if ($LASTEXITCODE -ne 0) {
        throw "pip installation failed with exit code $LASTEXITCODE"
    }
    Write-Host "  pip installed successfully" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Failed to install pip" -ForegroundColor Red
    throw
}

# Verify pip installation
$pipExe = Join-Path $PYTHON_DIR "Scripts\pip.exe"
if (-not (Test-Path $pipExe)) {
    Write-Host "  WARNING: pip.exe not found in Scripts directory" -ForegroundColor Yellow
    Write-Host "  Attempting to use python -m pip instead" -ForegroundColor Yellow
    $pipCommand = "$pythonExe -m pip"
} else {
    $pipCommand = $pipExe
    Write-Host "  Verified: pip.exe" -ForegroundColor Green
}

# Install required packages
Write-Host ""
Write-Host "[6/7] Installing required packages..." -ForegroundColor Yellow
Write-Host "  Packages: $($REQUIRED_PACKAGES -join ', ')" -ForegroundColor Cyan

foreach ($package in $REQUIRED_PACKAGES) {
    Write-Host "  Installing $package..." -ForegroundColor Gray
    try {
        if ($pipCommand -like "*python*") {
            & $pythonExe -m pip install $package --no-warn-script-location --disable-pip-version-check --quiet
        } else {
            & $pipCommand install $package --no-warn-script-location --disable-pip-version-check --quiet
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Package installation failed with exit code $LASTEXITCODE"
        }
        Write-Host "    - $package [OK]" -ForegroundColor Green
    } catch {
        Write-Host "    - $package [FAILED]" -ForegroundColor Red
        throw "Failed to install package: $package"
    }
}

# Clean up unnecessary files to reduce size
Write-Host ""
Write-Host "[7/7] Cleaning up unnecessary files..." -ForegroundColor Yellow
$cleanupPatterns = @(
    "*/__pycache__",
    "*.pyc",
    "*.pyo",
    "*/tests",
    "*/test",
    "*.dist-info/RECORD",
    "*.egg-info"
)

$removedCount = 0
foreach ($pattern in $cleanupPatterns) {
    $items = Get-ChildItem -Path $PYTHON_DIR -Recurse -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*$pattern*" }
    foreach ($item in $items) {
        Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
        $removedCount++
    }

    $files = Get-ChildItem -Path $PYTHON_DIR -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*$pattern*" }
    foreach ($file in $files) {
        Remove-Item -Path $file.FullName -Force -ErrorAction SilentlyContinue
        $removedCount++
    }
}
Write-Host "  Removed $removedCount cache/test files" -ForegroundColor Green

# Remove temporary files
Remove-Item -Path $TEMP_DIR -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  Cleaned temporary files" -ForegroundColor Green

# Calculate final size
$size = (Get-ChildItem -Path $PYTHON_DIR -Recurse -File | Measure-Object -Property Length -Sum).Sum
$sizeMB = [math]::Round($size / 1MB, 2)

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Python preparation completed successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Location: $PYTHON_DIR" -ForegroundColor White
Write-Host "Size: $sizeMB MB" -ForegroundColor White
Write-Host "Python: $PYTHON_VERSION" -ForegroundColor White
Write-Host "Packages: $($REQUIRED_PACKAGES.Count) installed" -ForegroundColor White
Write-Host ""

# Verify installation
Write-Host "Verifying installation..." -ForegroundColor Yellow
try {
    $versionOutput = & $pythonExe --version 2>&1
    Write-Host "  Python version: $versionOutput" -ForegroundColor Green

    foreach ($package in $REQUIRED_PACKAGES) {
        $testImport = "import $package"
        & $pythonExe -c $testImport 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  - $package [VERIFIED]" -ForegroundColor Green
        } else {
            Write-Host "  - $package [VERIFICATION FAILED]" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "  WARNING: Verification encountered errors" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Python is ready for bundling." -ForegroundColor Cyan
