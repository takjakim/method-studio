# Method Studio

<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="128" height="128" alt="Method Studio Logo">
</p>

<p align="center">
  <strong>Open-source statistical analysis platform powered by R and Python</strong>
</p>

<p align="center">
  <a href="https://github.com/takjakim/method-studio/releases">
    <img src="https://img.shields.io/github/v/release/takjakim/method-studio" alt="Release">
  </a>
  <a href="https://github.com/takjakim/method-studio/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/takjakim/method-studio" alt="License">
  </a>
  <a href="https://github.com/takjakim/method-studio/actions">
    <img src="https://github.com/takjakim/method-studio/actions/workflows/release.yml/badge.svg" alt="Build Status">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#supported-analyses">Analyses</a> •
  <a href="#development">Development</a> •
  <a href="#license">License</a>
</p>

---

## Features

- **Jamovi-style UI** - Intuitive drag-and-drop interface for variable assignment
- **Dual Engine Support** - Run analyses with R or Python backends
- **Bilingual** - Full Korean and English localization
- **Cross-Platform** - Windows, macOS, and Linux support
- **Sample Datasets** - Built-in example data for every analysis type

## Installation

### Download

Download the latest version for your platform from the [Releases](https://github.com/takjakim/method-studio/releases) page:

| Platform | Download |
|----------|----------|
| Windows | `.exe` (NSIS installer) or `.msi` |
| macOS (Apple Silicon) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Linux | `.AppImage` or `.deb` |

### Requirements

Method Studio requires either R or Python to be installed on your system.

#### R Engine (Recommended)

1. Install [R 4.0+](https://cran.r-project.org/)
2. Install required packages:
```r
install.packages(c("jsonlite", "psych", "lavaan", "lme4", "boot", "mediation"))
```

#### Python Engine

1. Install [Python 3.9+](https://python.org)
2. Install required packages:
```bash
pip install pandas numpy scipy statsmodels semopy factor_analyzer pingouin
```

#### Verifying Installation

**R:**
```bash
Rscript --version
```

**Python:**
```bash
python3 --version  # macOS/Linux
python --version   # Windows
```

## Supported Analyses

### Basic Statistics
| Analysis | Description |
|----------|-------------|
| Descriptives | Mean, SD, frequencies, percentiles |
| T-Test | One-sample, independent, paired |
| One-Way ANOVA | Post-hoc tests (Tukey, Bonferroni, Scheffé) |
| Correlation | Pearson, Spearman, Kendall |
| Linear Regression | Multiple regression with diagnostics |

### Factor Analysis
| Analysis | Description |
|----------|-------------|
| EFA | Exploratory Factor Analysis with rotation options |
| CFA | Confirmatory Factor Analysis with fit indices |
| Multi-group CFA | Measurement invariance testing |

### PROCESS Models
| Model | Description |
|-------|-------------|
| Model 1 | Simple Moderation |
| Model 4 | Simple Mediation |
| Model 6 | Serial Mediation |
| Model 7 | Moderated Mediation (first stage) |
| Model 8 | Moderated Mediation (both stages) |
| Model 14 | Moderated Mediation (second stage) |
| Model 58 | Complex Moderated Mediation |
| Model 59 | Complex Moderated Mediation |

### Structural Equation Modeling
| Analysis | Description |
|----------|-------------|
| Path Analysis | Direct and indirect effects |
| Full SEM | Latent variable models |

### Multilevel Models
| Analysis | Description |
|----------|-------------|
| HLM | Hierarchical Linear Models with random effects |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://rustup.rs/) (latest stable)

### Setup

```bash
# Clone the repository
git clone https://github.com/takjakim/method-studio.git
cd method-studio

# Install dependencies
pnpm install

# Run in development mode
cd apps/desktop
pnpm tauri dev
```

### Build

```bash
# Build for production
pnpm tauri build
```

### Project Structure

```
method-studio/
├── apps/
│   └── desktop/          # Tauri desktop application
│       ├── src/          # React frontend
│       └── src-tauri/    # Rust backend
├── engines/
│   ├── r-scripts/        # R analysis scripts
│   └── python-scripts/   # Python analysis scripts
└── packages/
    ├── analysis-specs/   # Analysis specifications
    ├── r-engine/         # R engine integration
    └── python-engine/    # Python engine integration
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the [MIT License](LICENSE).

## Author

**Kim, Jaehyun**
📧 takjakim.apple@gmail.com

---

<p align="center">
  Made with ❤️ using <a href="https://tauri.app">Tauri</a>, <a href="https://react.dev">React</a>, <a href="https://www.r-project.org">R</a>, and <a href="https://python.org">Python</a>
</p>
