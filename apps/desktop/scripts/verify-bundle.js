#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Bundle Verification Script
 *
 * Verifies that bundled R and Python engines are properly structured
 * and functional for the Method Studio desktop application.
 */

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ ${message}`, colors.cyan);
}

function logSection(message) {
  log(`\n${'='.repeat(60)}`, colors.blue);
  log(message, colors.blue);
  log('='.repeat(60), colors.blue);
}

/**
 * Detect platform from environment or argument
 */
function detectPlatform() {
  const platform = process.argv[2];

  if (platform) {
    const validPlatforms = ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'];
    if (validPlatforms.includes(platform)) {
      return platform;
    }
    logWarning(`Invalid platform: ${platform}. Detecting from environment...`);
  }

  // Auto-detect from environment
  const os = process.platform;
  const arch = process.arch;

  if (os === 'darwin') {
    return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  } else if (os === 'win32') {
    return 'windows-x64';
  } else if (os === 'linux') {
    return 'linux-x64';
  }

  throw new Error(`Unsupported platform: ${os}-${arch}`);
}

/**
 * Check if a file exists and is executable
 */
function checkExecutable(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, executable: false };
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return { exists: true, executable: true };
  } catch {
    return { exists: true, executable: false };
  }
}

/**
 * Check if a directory exists
 */
function checkDirectory(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

/**
 * Verify R installation
 */
function verifyR(bundleRoot, platform) {
  logSection('Verifying R Installation');

  const isWindows = platform.startsWith('windows');
  const rRoot = path.join(bundleRoot, 'r');
  const rBin = path.join(rRoot, 'bin', isWindows ? 'Rscript.exe' : 'Rscript');
  const rLibrary = path.join(rRoot, 'library');

  let hasErrors = false;

  // Check R root directory
  if (!checkDirectory(rRoot)) {
    logError(`R root directory not found: ${rRoot}`);
    return false;
  }
  logSuccess(`R root directory exists: ${rRoot}`);

  // Check R executable
  const rExecCheck = checkExecutable(rBin);
  if (!rExecCheck.exists) {
    logError(`Rscript executable not found: ${rBin}`);
    hasErrors = true;
  } else if (!rExecCheck.executable) {
    logError(`Rscript exists but is not executable: ${rBin}`);
    hasErrors = true;
  } else {
    logSuccess(`Rscript executable found and is executable: ${rBin}`);
  }

  // Check R library directory
  if (!checkDirectory(rLibrary)) {
    logError(`R library directory not found: ${rLibrary}`);
    hasErrors = true;
  } else {
    logSuccess(`R library directory exists: ${rLibrary}`);

    // List installed packages
    try {
      const packages = fs.readdirSync(rLibrary).filter(name => {
        const pkgPath = path.join(rLibrary, name);
        return fs.statSync(pkgPath).isDirectory() && !name.startsWith('.');
      });

      logInfo(`Found ${packages.length} R packages:`);
      if (packages.length > 0) {
        const displayPackages = packages.slice(0, 10);
        displayPackages.forEach(pkg => log(`  - ${pkg}`));
        if (packages.length > 10) {
          log(`  ... and ${packages.length - 10} more`);
        }
      }
    } catch (err) {
      logWarning(`Could not list R packages: ${err.message}`);
    }
  }

  // Test R execution
  if (rExecCheck.exists && rExecCheck.executable) {
    try {
      logInfo('Testing R execution...');
      const result = execSync(`"${rBin}" --version`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const versionMatch = result.match(/R version ([\d.]+)/);
      if (versionMatch) {
        logSuccess(`R version ${versionMatch[1]} executes successfully`);
      } else {
        logSuccess('R executes successfully');
      }

      // Test a simple R command
      logInfo('Testing R command execution...');
      const testResult = execSync(`"${rBin}" -e "cat('R is working\\n')"`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (testResult.includes('R is working')) {
        logSuccess('R command execution test passed');
      } else {
        logWarning('R command execution test completed but output unexpected');
      }
    } catch (err) {
      logError(`R execution test failed: ${err.message}`);
      hasErrors = true;
    }
  }

  return !hasErrors;
}

/**
 * Verify Python installation
 */
function verifyPython(bundleRoot, platform) {
  logSection('Verifying Python Installation');

  const isWindows = platform.startsWith('windows');
  const pythonRoot = path.join(bundleRoot, 'python');
  const pythonBin = path.join(pythonRoot, 'bin', isWindows ? 'python.exe' : 'python3');
  const sitePackages = path.join(pythonRoot, isWindows ? 'Lib' : 'lib',
                                  isWindows ? 'site-packages' : 'python*/site-packages');

  let hasErrors = false;

  // Check Python root directory
  if (!checkDirectory(pythonRoot)) {
    logError(`Python root directory not found: ${pythonRoot}`);
    return false;
  }
  logSuccess(`Python root directory exists: ${pythonRoot}`);

  // Check Python executable
  const pythonExecCheck = checkExecutable(pythonBin);
  if (!pythonExecCheck.exists) {
    logError(`Python executable not found: ${pythonBin}`);
    hasErrors = true;
  } else if (!pythonExecCheck.executable) {
    logError(`Python exists but is not executable: ${pythonBin}`);
    hasErrors = true;
  } else {
    logSuccess(`Python executable found and is executable: ${pythonBin}`);
  }

  // Check site-packages directory
  let actualSitePackages = null;
  if (isWindows) {
    actualSitePackages = path.join(pythonRoot, 'Lib', 'site-packages');
  } else {
    // Find the actual python version directory
    const libDir = path.join(pythonRoot, 'lib');
    if (checkDirectory(libDir)) {
      const pythonDirs = fs.readdirSync(libDir).filter(name => name.startsWith('python'));
      if (pythonDirs.length > 0) {
        actualSitePackages = path.join(libDir, pythonDirs[0], 'site-packages');
      }
    }
  }

  if (!actualSitePackages || !checkDirectory(actualSitePackages)) {
    logError(`Python site-packages directory not found: ${sitePackages}`);
    hasErrors = true;
  } else {
    logSuccess(`Python site-packages directory exists: ${actualSitePackages}`);

    // List installed packages
    try {
      const packages = fs.readdirSync(actualSitePackages).filter(name => {
        const pkgPath = path.join(actualSitePackages, name);
        const stat = fs.statSync(pkgPath);
        return (stat.isDirectory() && !name.startsWith('.') && !name.startsWith('_')) ||
               (name.endsWith('.dist-info'));
      });

      // Get unique package names (remove .dist-info duplicates)
      const uniquePackages = [...new Set(packages.map(p => p.replace(/\.dist-info$/, '')))];

      logInfo(`Found ${uniquePackages.length} Python packages:`);
      if (uniquePackages.length > 0) {
        const displayPackages = uniquePackages.slice(0, 10);
        displayPackages.forEach(pkg => log(`  - ${pkg}`));
        if (uniquePackages.length > 10) {
          log(`  ... and ${uniquePackages.length - 10} more`);
        }
      }
    } catch (err) {
      logWarning(`Could not list Python packages: ${err.message}`);
    }
  }

  // Test Python execution
  if (pythonExecCheck.exists && pythonExecCheck.executable) {
    try {
      logInfo('Testing Python execution...');
      const result = execSync(`"${pythonBin}" --version`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const versionMatch = result.match(/Python ([\d.]+)/);
      if (versionMatch) {
        logSuccess(`Python version ${versionMatch[1]} executes successfully`);
      } else {
        logSuccess('Python executes successfully');
      }

      // Test a simple Python command
      logInfo('Testing Python command execution...');
      const testResult = execSync(`"${pythonBin}" -c "print('Python is working')"`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (testResult.includes('Python is working')) {
        logSuccess('Python command execution test passed');
      } else {
        logWarning('Python command execution test completed but output unexpected');
      }

      // Test critical imports
      logInfo('Testing critical Python imports...');
      const imports = ['sys', 'os', 'json'];
      for (const moduleName of imports) {
        try {
          execSync(`"${pythonBin}" -c "import ${moduleName}"`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          logSuccess(`Import ${moduleName}: OK`);
        } catch (err) {
          logError(`Import ${moduleName}: FAILED`);
          hasErrors = true;
        }
      }
    } catch (err) {
      logError(`Python execution test failed: ${err.message}`);
      hasErrors = true;
    }
  }

  return !hasErrors;
}

/**
 * Main verification function
 */
function main() {
  try {
    log('\n🔍 Method Studio Bundle Verification\n', colors.cyan);

    // Detect platform
    const platform = detectPlatform();
    logInfo(`Platform: ${platform}`);

    // Determine bundle root
    const scriptsDir = __dirname;
    const projectRoot = path.resolve(scriptsDir, '..');
    const bundleRoot = path.join(projectRoot, 'bundled-engines', platform);

    logInfo(`Bundle root: ${bundleRoot}\n`);

    // Check if bundle root exists
    if (!checkDirectory(bundleRoot)) {
      logError(`Bundle root directory not found: ${bundleRoot}`);
      logError('Please run the bundling script first.');
      process.exit(1);
    }
    logSuccess(`Bundle root directory exists: ${bundleRoot}`);

    // Verify R
    const rValid = verifyR(bundleRoot, platform);

    // Verify Python
    const pythonValid = verifyPython(bundleRoot, platform);

    // Final summary
    logSection('Verification Summary');

    if (rValid && pythonValid) {
      logSuccess('✓ All verifications passed!');
      logSuccess('The bundled engines are properly structured and functional.');
      process.exit(0);
    } else {
      if (!rValid) {
        logError('✗ R verification failed');
      }
      if (!pythonValid) {
        logError('✗ Python verification failed');
      }
      logError('\nThe bundled engines have issues. Please review the errors above.');
      process.exit(1);
    }

  } catch (err) {
    logError(`\n✗ Verification failed with error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = { verifyR, verifyPython, detectPlatform };
