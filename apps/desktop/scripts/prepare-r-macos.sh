#!/bin/bash
set -e

# macOS R preparation script
# Downloads and prepares a portable R installation for bundling with the desktop app

echo "=== macOS R Preparation Script ==="

# Determine architecture
ARCH="${1:-$(uname -m)}"
if [[ "$ARCH" == "arm64" ]] || [[ "$ARCH" == "aarch64" ]]; then
    ARCH="arm64"
    R_ARCH="arm64"
    R_VARIANT="arm64"
elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    ARCH="x64"
    R_ARCH="x86_64"
    R_VARIANT="x86_64"
else
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
fi

echo "Architecture: $ARCH"

# Configuration
R_VERSION="4.5.2"
R_PKG_URL="https://cran.r-project.org/bin/macosx/big-sur-${R_VARIANT}/base/R-${R_VERSION}-${R_VARIANT}.pkg"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
OUTPUT_DIR="$PROJECT_ROOT/apps/desktop/bundled-engines/macos-${ARCH}/r"

echo "R Version: $R_VERSION"
echo "Download URL: $R_PKG_URL"
echo "Output directory: $OUTPUT_DIR"
echo "Temporary directory: $TEMP_DIR"

# Clean up on exit
cleanup() {
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Download R installer
echo ""
echo "=== Downloading R ${R_VERSION} for macOS ${ARCH} ==="
R_PKG="$TEMP_DIR/R-${R_VERSION}.pkg"
curl -L -o "$R_PKG" "$R_PKG_URL"

if [[ ! -f "$R_PKG" ]]; then
    echo "Error: Failed to download R package"
    exit 1
fi

echo "Download complete: $(du -h "$R_PKG" | cut -f1)"

# Extract the pkg file
echo ""
echo "=== Extracting R package ==="
cd "$TEMP_DIR"

# Use pkgutil to expand the pkg
pkgutil --expand "$R_PKG" R-expanded

# Find R-framework.pkg specifically
R_FRAMEWORK_PKG="R-expanded/R-framework.pkg"
if [[ ! -d "$R_FRAMEWORK_PKG" ]]; then
    echo "Error: R-framework.pkg not found in expanded package"
    echo "Available packages:"
    ls -la R-expanded/
    exit 1
fi

PAYLOAD_FILE="$R_FRAMEWORK_PKG/Payload"
if [[ ! -f "$PAYLOAD_FILE" ]]; then
    echo "Error: Payload not found in R-framework.pkg"
    exit 1
fi

echo "Extracting R-framework.pkg payload: $PAYLOAD_FILE"
mkdir -p R-extracted
cd R-extracted
cat "../$PAYLOAD_FILE" | gunzip -dc | cpio -i

# Locate R.framework
if [[ -d "Library/Frameworks/R.framework" ]]; then
    R_FRAMEWORK="Library/Frameworks/R.framework"
elif [[ -d "R.framework" ]]; then
    R_FRAMEWORK="R.framework"
else
    echo "Error: R.framework not found in extracted package"
    find . -name "R.framework" -type d
    exit 1
fi

echo "Found R.framework at: $R_FRAMEWORK"

# Create output directory structure
echo ""
echo "=== Creating portable R structure ==="
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{bin,lib,library}

# Copy R.framework Resources to lib/R
echo "Copying R.framework..."
cp -R "$R_FRAMEWORK/Versions/Current/Resources" "$OUTPUT_DIR/lib/R"

# Copy R executable and create Rscript symlink
if [[ -f "$R_FRAMEWORK/Versions/Current/Resources/bin/R" ]]; then
    cp "$R_FRAMEWORK/Versions/Current/Resources/bin/R" "$OUTPUT_DIR/bin/"
fi

if [[ -f "$R_FRAMEWORK/Versions/Current/Resources/bin/Rscript" ]]; then
    cp "$R_FRAMEWORK/Versions/Current/Resources/bin/Rscript" "$OUTPUT_DIR/bin/"
fi

# Copy dynamic libraries
if [[ -d "$R_FRAMEWORK/Versions/Current/Resources/lib" ]]; then
    cp -R "$R_FRAMEWORK/Versions/Current/Resources/lib"/* "$OUTPUT_DIR/lib/R/lib/" 2>/dev/null || true
fi

# Set up R_HOME for portable use
echo "Configuring portable R_HOME..."
cat > "$OUTPUT_DIR/bin/R-wrapper" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SCRIPT_DIR/../lib/R"
export R_LIBS_USER="$SCRIPT_DIR/../library"
exec "$R_HOME/bin/R" "$@"
EOF
chmod +x "$OUTPUT_DIR/bin/R-wrapper"

cat > "$OUTPUT_DIR/bin/Rscript-wrapper" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SCRIPT_DIR/../lib/R"
export R_LIBS_USER="$SCRIPT_DIR/../library"
exec "$R_HOME/bin/Rscript" "$@"
EOF
chmod +x "$OUTPUT_DIR/bin/Rscript-wrapper"

# Make original binaries executable
chmod +x "$OUTPUT_DIR/bin/R" 2>/dev/null || true
chmod +x "$OUTPUT_DIR/bin/Rscript" 2>/dev/null || true

# Remove unnecessary files to reduce size
echo ""
echo "=== Optimizing bundle size ==="
echo "Removing documentation and help files..."
rm -rf "$OUTPUT_DIR/lib/R/doc" 2>/dev/null || true
rm -rf "$OUTPUT_DIR/lib/R/html" 2>/dev/null || true
find "$OUTPUT_DIR/lib/R" -name "help" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUTPUT_DIR/lib/R" -name "html" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUTPUT_DIR/lib/R" -name "*.pdf" -delete 2>/dev/null || true
find "$OUTPUT_DIR/lib/R" -name "*.html" -delete 2>/dev/null || true

# Install required R packages
echo ""
echo "=== Installing required R packages ==="
export R_HOME="$OUTPUT_DIR/lib/R"
export R_LIBS_USER="$OUTPUT_DIR/library"

RSCRIPT="$OUTPUT_DIR/bin/Rscript"
if [[ ! -f "$RSCRIPT" ]]; then
    echo "Error: Rscript not found at $RSCRIPT"
    exit 1
fi

PACKAGES=(
    "jsonlite"
    "psych"
    "lavaan"
    "lme4"
    "boot"
    "mediation"
    "lmerTest"
)

for pkg in "${PACKAGES[@]}"; do
    echo "Installing package: $pkg"
    "$RSCRIPT" -e "install.packages('$pkg', repos='https://cran.r-project.org', lib='$R_LIBS_USER', quiet=FALSE)"
done

# Verify installation
echo ""
echo "=== Verifying installation ==="
for pkg in "${PACKAGES[@]}"; do
    if "$RSCRIPT" -e "library('$pkg')" 2>/dev/null; then
        echo "✓ $pkg"
    else
        echo "✗ $pkg - FAILED"
        exit 1
    fi
done

# Print summary
echo ""
echo "=== Installation Summary ==="
echo "R Version: $("$RSCRIPT" --version 2>&1 | head -n 1)"
echo "R_HOME: $R_HOME"
echo "R_LIBS_USER: $R_LIBS_USER"
echo "Installed packages:"
"$RSCRIPT" -e "cat(paste('  -', rownames(installed.packages(lib.loc='$R_LIBS_USER'))), sep='\n')"

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
echo ""
echo "Bundle size: $BUNDLE_SIZE"
echo "Location: $OUTPUT_DIR"

echo ""
echo "=== R preparation complete ==="
echo "Portable R is ready at: $OUTPUT_DIR"
echo ""
echo "Usage:"
echo "  R_HOME=$OUTPUT_DIR/lib/R $OUTPUT_DIR/bin/Rscript script.R"
echo "  Or use the wrapper: $OUTPUT_DIR/bin/Rscript-wrapper script.R"
