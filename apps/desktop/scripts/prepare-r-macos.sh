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
    OLD_FRAMEWORK_PATH="/Library/Frameworks/R.framework/Versions/4.5-arm64/Resources/lib"
elif [[ "$ARCH" == "x86_64" ]] || [[ "$ARCH" == "amd64" ]]; then
    ARCH="x64"
    R_ARCH="x86_64"
    R_VARIANT="x86_64"
    OLD_FRAMEWORK_PATH="/Library/Frameworks/R.framework/Versions/4.5-x86_64/Resources/lib"
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
    cd /tmp  # Change to a safe directory before cleanup
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

# Find R-framework.pkg
R_FRAMEWORK_PKG=""
for pkg_name in "R-fw.pkg" "R-framework.pkg" "r-framework.pkg" "R-Framework.pkg"; do
    if [[ -d "R-expanded/$pkg_name" ]]; then
        R_FRAMEWORK_PKG="R-expanded/$pkg_name"
        echo "Found framework package: $pkg_name"
        break
    fi
done

if [[ -z "$R_FRAMEWORK_PKG" ]]; then
    echo "Error: R framework package not found in expanded package"
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

# Copy R executable and Rscript to bin
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

echo ""
echo "=== Patching binaries for portable use ==="

# Function to fix library paths in a binary
fix_binary_paths() {
    local binary="$1"
    local loader_path_prefix="$2"  # e.g., "@loader_path/../lib" or "@loader_path/../../lib"

    local LIBS_TO_FIX=("libR.dylib" "libRlapack.dylib" "libRblas.dylib" "libgfortran.5.dylib" "libquadmath.0.dylib" "libgcc_s.1.1.dylib" "libomp.dylib")

    for lib in "${LIBS_TO_FIX[@]}"; do
        if otool -L "$binary" 2>/dev/null | grep -q "$OLD_FRAMEWORK_PATH/$lib"; then
            install_name_tool -change \
                "$OLD_FRAMEWORK_PATH/$lib" \
                "${loader_path_prefix}/${lib}" \
                "$binary" 2>/dev/null || true
        fi
    done
}

# 1. Fix the R binary (bin/exec/R)
echo "Fixing R binary..."
R_BINARY="$OUTPUT_DIR/lib/R/bin/exec/R"
if [[ -f "$R_BINARY" ]]; then
    fix_binary_paths "$R_BINARY" "@loader_path/../../lib"
fi

# 2. Fix the dylib files in lib/R/lib/
echo "Fixing dynamic libraries..."
LIB_DIR="$OUTPUT_DIR/lib/R/lib"
for dylib in "$LIB_DIR"/*.dylib; do
    if [[ -f "$dylib" ]]; then
        # Fix install name
        LIB_NAME=$(basename "$dylib")
        install_name_tool -id "@loader_path/$LIB_NAME" "$dylib" 2>/dev/null || true
        # Fix dependencies
        fix_binary_paths "$dylib" "@loader_path"
    fi
done

# 3. Fix module .so files
echo "Fixing module files..."
MODULES_DIR="$OUTPUT_DIR/lib/R/modules"
if [[ -d "$MODULES_DIR" ]]; then
    for so_file in "$MODULES_DIR"/*.so; do
        if [[ -f "$so_file" ]]; then
            fix_binary_paths "$so_file" "@loader_path/../lib"
        fi
    done
fi

# 4. Fix library package .so files
echo "Fixing library package files..."
find "$OUTPUT_DIR/lib/R/library" -name "*.so" 2>/dev/null | while read so_file; do
    fix_binary_paths "$so_file" "@loader_path/../../../lib"
done

# 5. Create portable R shell script
echo "Creating portable R shell script..."
cat > "$OUTPUT_DIR/lib/R/bin/R" << 'RSCRIPT'
#!/bin/sh
# Shell wrapper for R executable - PORTABLE VERSION

# Calculate R_HOME from script location if not set
if [ -z "$R_HOME" ]; then
    R_HOME="$(cd "$(dirname "$0")/.." && pwd)"
fi
export R_HOME

R_SHARE_DIR="${R_HOME}/share"
export R_SHARE_DIR
R_INCLUDE_DIR="${R_HOME}/include"
export R_INCLUDE_DIR
R_DOC_DIR="${R_HOME}/doc"
export R_DOC_DIR

R_binary="${R_HOME}/bin/exec/R"

exec "$R_binary" "$@"
RSCRIPT
chmod +x "$OUTPUT_DIR/lib/R/bin/R"

# 6. Create Rscript wrapper (avoids hardcoded paths in Rscript binary)
echo "Creating Rscript wrapper..."
cat > "$OUTPUT_DIR/bin/Rscript-wrapper" << 'WRAPPER'
#!/bin/bash
# Rscript wrapper that uses R directly to avoid hardcoded paths in Rscript binary
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SCRIPT_DIR/../lib/R"
export R_LIBS_USER="$SCRIPT_DIR/../library"

# Parse arguments to convert Rscript format to R format
EXPRS=()
OPTS=()
FILE=""
POST_ARGS=()
PROCESSING_EXPRS=false
PROCESSING_ARGS=false

for arg in "$@"; do
    if [ "$PROCESSING_ARGS" = true ]; then
        POST_ARGS+=("$arg")
    elif [ "$arg" = "--args" ]; then
        PROCESSING_ARGS=true
    elif [ "$arg" = "-e" ]; then
        PROCESSING_EXPRS=true
    elif [ "$PROCESSING_EXPRS" = true ]; then
        EXPRS+=("-e" "$arg")
        PROCESSING_EXPRS=false
    elif [[ "$arg" == --* ]]; then
        OPTS+=("$arg")
    elif [ -z "$FILE" ] && [ -f "$arg" ]; then
        FILE="$arg"
    else
        POST_ARGS+=("$arg")
    fi
done

# Build the R command
CMD=("$R_HOME/bin/R" "--slave" "--no-restore")

for opt in "${OPTS[@]}"; do
    CMD+=("$opt")
done

if [ ${#EXPRS[@]} -gt 0 ]; then
    for expr in "${EXPRS[@]}"; do
        CMD+=("$expr")
    done
elif [ -n "$FILE" ]; then
    CMD+=("-f" "$FILE")
fi

if [ ${#POST_ARGS[@]} -gt 0 ]; then
    CMD+=("--args")
    for arg in "${POST_ARGS[@]}"; do
        CMD+=("$arg")
    done
fi

exec "${CMD[@]}"
WRAPPER
chmod +x "$OUTPUT_DIR/bin/Rscript-wrapper"

# Also create R-wrapper
cat > "$OUTPUT_DIR/bin/R-wrapper" << 'RWRAPPER'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export R_HOME="$SCRIPT_DIR/../lib/R"
export R_LIBS_USER="$SCRIPT_DIR/../library"
exec "$R_HOME/bin/R" "$@"
RWRAPPER
chmod +x "$OUTPUT_DIR/bin/R-wrapper"

# 7. Re-sign all modified binaries
echo "Re-signing binaries..."
find "$OUTPUT_DIR" -type f \( -name "*.dylib" -o -name "*.so" \) -exec codesign --force --sign - {} \; 2>/dev/null || true
codesign --force --sign - "$OUTPUT_DIR/lib/R/bin/exec/R" 2>/dev/null || true

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
RSCRIPT="$OUTPUT_DIR/bin/Rscript-wrapper"

# Test R installation
echo "Testing R installation..."
if ! "$RSCRIPT" -e "cat('R is working\n')" 2>/dev/null; then
    echo "Error: R installation test failed"
    "$RSCRIPT" -e "cat('test')" 2>&1 || true
    exit 1
fi
echo "R installation test passed"

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
    "$RSCRIPT" -e "install.packages('$pkg', repos='https://cran.r-project.org', lib='$R_LIBS_USER', quiet=FALSE)" || {
        echo "Warning: Failed to install $pkg, retrying..."
        "$RSCRIPT" -e "install.packages('$pkg', repos='https://cloud.r-project.org', lib='$R_LIBS_USER', quiet=FALSE)"
    }
done

# Fix paths in installed packages
echo ""
echo "=== Fixing installed package binaries ==="
find "$OUTPUT_DIR/library" -name "*.so" 2>/dev/null | while read so_file; do
    for lib in "libR.dylib" "libRlapack.dylib" "libRblas.dylib" "libgfortran.5.dylib" "libquadmath.0.dylib"; do
        if otool -L "$so_file" 2>/dev/null | grep -q "$OLD_FRAMEWORK_PATH/$lib"; then
            install_name_tool -change \
                "$OLD_FRAMEWORK_PATH/$lib" \
                "@loader_path/../../../lib/R/lib/$lib" \
                "$so_file" 2>/dev/null || true
        fi
    done
done

# Re-sign installed package binaries
find "$OUTPUT_DIR/library" -name "*.so" -exec codesign --force --sign - {} \; 2>/dev/null || true

# Verify installation
echo ""
echo "=== Verifying installation ==="

# Required packages (build fails if missing)
REQUIRED_PACKAGES=("jsonlite" "psych" "lavaan" "lme4" "boot" "lmerTest")
# Optional packages (warning only if missing)
OPTIONAL_PACKAGES=("mediation")

REQUIRED_FAILED=false
for pkg in "${REQUIRED_PACKAGES[@]}"; do
    if "$RSCRIPT" -e "library('$pkg', lib.loc='$R_LIBS_USER')" 2>/dev/null; then
        echo "✓ $pkg (required)"
    else
        echo "✗ $pkg - FAILED (required)"
        echo "  Error details:"
        "$RSCRIPT" -e "library('$pkg', lib.loc='$R_LIBS_USER')" 2>&1 | head -5 || true
        REQUIRED_FAILED=true
    fi
done

for pkg in "${OPTIONAL_PACKAGES[@]}"; do
    if "$RSCRIPT" -e "library('$pkg', lib.loc='$R_LIBS_USER')" 2>/dev/null; then
        echo "✓ $pkg (optional)"
    else
        echo "⚠ $pkg - FAILED (optional, continuing anyway)"
        echo "  Error details:"
        "$RSCRIPT" -e "library('$pkg', lib.loc='$R_LIBS_USER')" 2>&1 | head -5 || true
    fi
done

if [ "$REQUIRED_FAILED" = true ]; then
    echo "Required packages failed to load"
    exit 1
fi

# Print summary
echo ""
echo "=== Installation Summary ==="
echo "R Version: $("$RSCRIPT" -e "cat(R.version.string)" 2>/dev/null)"
echo "R_HOME: $R_HOME"
echo "R_LIBS_USER: $R_LIBS_USER"
echo "Installed packages:"
"$RSCRIPT" -e "cat(paste('  -', rownames(installed.packages(lib.loc='$R_LIBS_USER'))), sep='\n')" 2>/dev/null

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
echo "  $OUTPUT_DIR/bin/Rscript-wrapper script.R"
echo "  $OUTPUT_DIR/bin/Rscript-wrapper -e \"print('Hello')\""
