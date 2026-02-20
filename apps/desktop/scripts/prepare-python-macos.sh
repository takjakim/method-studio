#!/bin/bash

# prepare-python-macos.sh - Prepare portable Python for macOS bundling
# Usage: ./prepare-python-macos.sh [arm64|x86_64]

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect architecture
ARCH="${1:-$(uname -m)}"

# Normalize architecture name
case "$ARCH" in
    "arm64"|"aarch64")
        ARCH="arm64"
        PYTHON_ARCH="aarch64"  # python-build-standalone uses "aarch64" in URL
        ;;
    "x86_64"|"amd64")
        ARCH="x64"
        PYTHON_ARCH="x86_64"
        ;;
    *)
        log_error "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

log_info "Preparing Python for macOS-${ARCH}"

# Python version
PYTHON_VERSION="3.12.7"
PYTHON_MAJOR_MINOR="3.12"
PYTHON_RELEASE_DATE="20241016"

# Directory setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DESKTOP_ROOT="$PROJECT_ROOT/apps/desktop"
BUNDLED_DIR="$DESKTOP_ROOT/bundled-engines/macos-${ARCH}"
PYTHON_DIR="$BUNDLED_DIR/python"
DOWNLOAD_DIR="$DESKTOP_ROOT/.python-downloads"

log_info "Project root: $PROJECT_ROOT"
log_info "Bundled directory: $BUNDLED_DIR"

# Create directories
mkdir -p "$DOWNLOAD_DIR"
mkdir -p "$PYTHON_DIR"

# Python packages to install
PYTHON_PACKAGES=(
    "pandas"
    "numpy"
    "scipy"
    "statsmodels"
    "semopy"
    "factor_analyzer"
    "pingouin"
    "matplotlib"
    "seaborn"
    "scikit-learn"
)

# Download Python standalone build
download_python() {
    local python_pkg="python-${PYTHON_VERSION}-macos-${PYTHON_ARCH}.tar.gz"
    local download_url="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_RELEASE_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE_DATE}-${PYTHON_ARCH}-apple-darwin-install_only.tar.gz"
    local download_path="$DOWNLOAD_DIR/$python_pkg"

    # Clear cached download if it's too small (likely corrupted or error page)
    if [ -f "$download_path" ]; then
        local file_size=$(stat -f%z "$download_path" 2>/dev/null || stat -c%s "$download_path" 2>/dev/null || echo "0")
        if [ "$file_size" -lt 1000000 ]; then
            log_warn "Existing download is too small ($file_size bytes), re-downloading..."
            rm -f "$download_path"
        else
            log_info "Python package already downloaded: $python_pkg"
            return 0
        fi
    fi

    log_info "Downloading Python ${PYTHON_VERSION} for ${PYTHON_ARCH}..."
    log_info "URL: $download_url"

    if command -v curl &> /dev/null; then
        curl -fSL -o "$download_path" "$download_url"
        if [ $? -ne 0 ]; then
            log_error "Failed to download Python. Check the URL: $download_url"
            rm -f "$download_path"
            exit 1
        fi
    elif command -v wget &> /dev/null; then
        wget -O "$download_path" "$download_url"
    else
        log_error "Neither curl nor wget found. Cannot download Python."
        exit 1
    fi

    # Verify download size
    local file_size=$(stat -f%z "$download_path" 2>/dev/null || stat -c%s "$download_path" 2>/dev/null || echo "0")
    if [ "$file_size" -lt 1000000 ]; then
        log_error "Downloaded file is too small ($file_size bytes). Download may have failed."
        rm -f "$download_path"
        exit 1
    fi

    log_info "Download complete: $python_pkg ($file_size bytes)"
}

# Extract Python
extract_python() {
    log_info "Extracting Python to $PYTHON_DIR..."

    # Clean existing Python directory
    if [ -d "$PYTHON_DIR" ]; then
        log_warn "Removing existing Python directory"
        rm -rf "$PYTHON_DIR"
    fi

    mkdir -p "$PYTHON_DIR"

    local python_pkg="python-${PYTHON_VERSION}-macos11-${PYTHON_ARCH}.tar.gz"
    local download_path="$DOWNLOAD_DIR/$python_pkg"

    # Extract to temporary directory
    local temp_extract="$DOWNLOAD_DIR/temp_extract"
    rm -rf "$temp_extract"
    mkdir -p "$temp_extract"

    tar -xzf "$download_path" -C "$temp_extract"

    # Move python directory contents
    if [ -d "$temp_extract/python" ]; then
        mv "$temp_extract/python"/* "$PYTHON_DIR/"
    else
        # If extracted directly
        mv "$temp_extract"/* "$PYTHON_DIR/"
    fi

    rm -rf "$temp_extract"

    log_info "Python extracted successfully"
}

# Setup Python structure
setup_python_structure() {
    log_info "Setting up Python directory structure..."

    # Ensure required directories exist
    mkdir -p "$PYTHON_DIR/bin"
    mkdir -p "$PYTHON_DIR/lib/python${PYTHON_MAJOR_MINOR}"
    mkdir -p "$PYTHON_DIR/lib/python${PYTHON_MAJOR_MINOR}/site-packages"

    # Find and link python executable
    local python_exe=""

    if [ -f "$PYTHON_DIR/bin/python3" ]; then
        python_exe="$PYTHON_DIR/bin/python3"
    elif [ -f "$PYTHON_DIR/bin/python${PYTHON_MAJOR_MINOR}" ]; then
        python_exe="$PYTHON_DIR/bin/python${PYTHON_MAJOR_MINOR}"
        ln -sf "python${PYTHON_MAJOR_MINOR}" "$PYTHON_DIR/bin/python3"
    elif [ -f "$PYTHON_DIR/bin/python" ]; then
        python_exe="$PYTHON_DIR/bin/python"
        ln -sf "python" "$PYTHON_DIR/bin/python3"
    else
        log_error "Could not find Python executable in $PYTHON_DIR/bin"
        exit 1
    fi

    # Make sure pip is available
    if [ ! -f "$PYTHON_DIR/bin/pip3" ]; then
        log_info "Installing pip..."
        "$python_exe" -m ensurepip --upgrade
    fi

    # Verify Python installation
    log_info "Verifying Python installation..."
    "$python_exe" --version

    log_info "Python structure setup complete"
}

# Install Python packages
install_packages() {
    log_info "Installing Python packages..."

    local python_exe="$PYTHON_DIR/bin/python3"
    local pip_exe="$PYTHON_DIR/bin/pip3"

    if [ ! -f "$python_exe" ]; then
        log_error "Python executable not found: $python_exe"
        exit 1
    fi

    # Upgrade pip
    log_info "Upgrading pip..."
    "$python_exe" -m pip install --upgrade pip

    # Install each package
    for package in "${PYTHON_PACKAGES[@]}"; do
        log_info "Installing $package..."
        "$pip_exe" install --no-cache-dir "$package"
    done

    log_info "All packages installed successfully"
}

# Optimize Python bundle
optimize_bundle() {
    log_info "Optimizing Python bundle (removing unnecessary files)..."

    # Remove __pycache__ directories
    find "$PYTHON_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

    # Remove .pyc and .pyo files
    find "$PYTHON_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
    find "$PYTHON_DIR" -type f -name "*.pyo" -delete 2>/dev/null || true

    # Remove test directories
    find "$PYTHON_DIR/lib" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
    find "$PYTHON_DIR/lib" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true

    # Remove .dist-info directories (keep minimal metadata)
    # Uncomment if you want to remove these to save space
    # find "$PYTHON_DIR/lib" -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true

    # Remove development headers (optional - keep if needed for some packages)
    # rm -rf "$PYTHON_DIR/include" 2>/dev/null || true

    # Remove static libraries (optional)
    # find "$PYTHON_DIR/lib" -type f -name "*.a" -delete 2>/dev/null || true

    log_info "Bundle optimization complete"
}

# Generate metadata
generate_metadata() {
    log_info "Generating bundle metadata..."

    local metadata_file="$PYTHON_DIR/bundle-info.json"
    local python_exe="$PYTHON_DIR/bin/python3"

    cat > "$metadata_file" <<EOF
{
  "python_version": "$PYTHON_VERSION",
  "architecture": "$ARCH",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "packages": [
$(for pkg in "${PYTHON_PACKAGES[@]}"; do
    version=$("$python_exe" -c "import importlib.metadata; print(importlib.metadata.version('$pkg'))" 2>/dev/null || echo "unknown")
    echo "    {\"name\": \"$pkg\", \"version\": \"$version\"},"
done | sed '$ s/,$//')
  ]
}
EOF

    log_info "Metadata written to $metadata_file"
}

# Print summary
print_summary() {
    local python_exe="$PYTHON_DIR/bin/python3"
    local bundle_size=$(du -sh "$PYTHON_DIR" | cut -f1)

    log_info "================================================"
    log_info "Python bundle preparation complete!"
    log_info "================================================"
    log_info "Architecture: $ARCH"
    log_info "Python version: $("$python_exe" --version)"
    log_info "Bundle location: $PYTHON_DIR"
    log_info "Bundle size: $bundle_size"
    log_info "================================================"

    # List installed packages
    log_info "Installed packages:"
    "$python_exe" -m pip list
}

# Main execution
main() {
    log_info "Starting Python preparation for macOS-${ARCH}"

    download_python
    extract_python
    setup_python_structure
    install_packages
    optimize_bundle
    generate_metadata
    print_summary

    log_info "Done! Python is ready for bundling."
}

# Run main function
main
