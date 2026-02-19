import type { AnalysisSpec } from './types.ts';

/**
 * Exploratory Factor Analysis (EFA) specification.
 * Identifies underlying latent factors that explain correlations
 * among a set of observed numeric variables.
 */
export const efaSpec: AnalysisSpec = {
  id: 'efa',
  name: 'Exploratory Factor Analysis',
  category: 'correlation',
  description:
    'Identify latent factors that explain the covariance structure among multiple numeric variables.',
  variables: [
    {
      id: 'variables',
      label: 'Variables',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag at least 3 numeric variables here',
    },
  ],
  options: [
    // Factor extraction
    {
      id: 'nFactors',
      type: 'number',
      label: 'Number of Factors',
      default: 0,
      min: 0,
      max: 50,
      step: 1,
      group: 'Extraction',
    },
    {
      id: 'extractionMethod',
      type: 'select',
      label: 'Extraction Method',
      default: 'minres',
      choices: [
        { value: 'minres', label: 'Minimum Residuals (MINRES)' },
        { value: 'ml', label: 'Maximum Likelihood (ML)' },
        { value: 'pa', label: 'Principal Axis Factoring (PA)' },
        { value: 'wls', label: 'Weighted Least Squares (WLS)' },
        { value: 'gls', label: 'Generalized Least Squares (GLS)' },
      ],
      group: 'Extraction',
    },
    // Rotation
    {
      id: 'rotation',
      type: 'select',
      label: 'Rotation',
      default: 'varimax',
      choices: [
        { value: 'varimax', label: 'Varimax (orthogonal)' },
        { value: 'promax', label: 'Promax (oblique)' },
        { value: 'oblimin', label: 'Oblimin (oblique)' },
        { value: 'quartimax', label: 'Quartimax (orthogonal)' },
        { value: 'none', label: 'No Rotation' },
      ],
      group: 'Rotation',
    },
    // Adequacy tests
    {
      id: 'kmoTest',
      type: 'checkbox',
      label: 'Kaiser-Meyer-Olkin (KMO) Measure',
      default: true,
      group: 'Adequacy Tests',
    },
    {
      id: 'bartlettTest',
      type: 'checkbox',
      label: "Bartlett's Test of Sphericity",
      default: true,
      group: 'Adequacy Tests',
    },
    // Output options
    {
      id: 'screePlot',
      type: 'checkbox',
      label: 'Scree Plot',
      default: true,
      group: 'Output',
    },
    {
      id: 'factorScores',
      type: 'checkbox',
      label: 'Factor Scores',
      default: false,
      group: 'Output',
    },
    {
      id: 'suppressLoadings',
      type: 'number',
      label: 'Suppress Loadings Below',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      group: 'Output',
    },
    // Missing values
    {
      id: 'missingValues',
      type: 'radio',
      label: 'Missing Values',
      default: 'exclude-listwise',
      choices: [
        { value: 'exclude-listwise', label: 'Exclude cases listwise' },
        { value: 'pairwise', label: 'Pairwise (correlation-based)' },
      ],
      group: 'Options',
    },
    // Significance level for Bartlett's test
    {
      id: 'alpha',
      type: 'select',
      label: 'Significance Level',
      default: 0.05,
      choices: [
        { value: 0.10, label: '0.10' },
        { value: 0.05, label: '0.05' },
        { value: 0.01, label: '0.01' },
      ],
      group: 'Options',
    },
  ],
};
