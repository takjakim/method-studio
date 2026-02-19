import type { AnalysisSpec } from './types.ts';

/**
 * Confirmatory Factor Analysis (CFA) specification.
 * Tests a hypothesized factor structure by fitting a measurement model
 * with latent variables to a set of observed indicator variables.
 */
export const cfaSpec: AnalysisSpec = {
  id: 'cfa',
  name: 'Confirmatory Factor Analysis',
  category: 'sem',
  description: 'Test hypothesized factor structure with latent variables',
  variables: [
    {
      id: 'factor1',
      label: 'Factor 1 Indicators',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      minVariables: 2,
      hint: 'At least 2 indicator variables for Factor 1',
    },
    {
      id: 'factor2',
      label: 'Factor 2 Indicators',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Optional: indicators for Factor 2',
    },
    {
      id: 'factor3',
      label: 'Factor 3 Indicators',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Optional: indicators for Factor 3',
    },
    {
      id: 'factor4',
      label: 'Factor 4 Indicators',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Optional: indicators for Factor 4',
    },
    {
      id: 'factor5',
      label: 'Factor 5 Indicators',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Optional: indicators for Factor 5',
    },
  ],
  options: [
    // Model
    {
      id: 'estimator',
      type: 'select',
      label: 'Estimator',
      default: 'ML',
      choices: [
        { value: 'ML', label: 'Maximum Likelihood' },
        { value: 'MLR', label: 'Robust ML' },
        { value: 'WLSMV', label: 'Weighted Least Squares' },
      ],
      group: 'Model',
    },
    {
      id: 'orthogonal',
      type: 'checkbox',
      label: 'Orthogonal Factors (no correlations)',
      default: false,
      group: 'Model',
    },
    // Output
    {
      id: 'standardized',
      type: 'checkbox',
      label: 'Standardized Solution',
      default: true,
      group: 'Output',
    },
    {
      id: 'fitIndices',
      type: 'checkbox',
      label: 'Fit Indices (CFI, TLI, RMSEA, SRMR)',
      default: true,
      group: 'Output',
    },
    {
      id: 'modificationIndices',
      type: 'checkbox',
      label: 'Modification Indices',
      default: false,
      group: 'Output',
    },
    {
      id: 'residualCorrelations',
      type: 'checkbox',
      label: 'Residual Correlations',
      default: false,
      group: 'Output',
    },
    // Options
    {
      id: 'missingValues',
      type: 'select',
      label: 'Missing Values',
      default: 'listwise',
      choices: [
        { value: 'listwise', label: 'listwise' },
        { value: 'fiml', label: 'Full Information ML' },
      ],
      group: 'Options',
    },
  ],
};

/**
 * Path Analysis specification.
 * Models direct and indirect effects among observed variables using
 * a system of regression equations without latent variables.
 */
export const pathAnalysisSpec: AnalysisSpec = {
  id: 'path-analysis',
  name: 'Path Analysis',
  category: 'sem',
  description: 'Analyze direct and indirect effects among observed variables',
  variables: [
    {
      id: 'endogenous',
      label: 'Endogenous (Dependent) Variables',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag at least 1 numeric endogenous variable here',
    },
    {
      id: 'exogenous',
      label: 'Exogenous (Independent) Variables',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag at least 1 numeric exogenous variable here',
    },
  ],
  options: [
    // Model
    {
      id: 'estimator',
      type: 'select',
      label: 'Estimator',
      default: 'ML',
      choices: [
        { value: 'ML', label: 'ML' },
        { value: 'MLR', label: 'MLR' },
      ],
      group: 'Model',
    },
    // Output
    {
      id: 'standardized',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: true,
      group: 'Output',
    },
    {
      id: 'fitIndices',
      type: 'checkbox',
      label: 'Fit Indices',
      default: true,
      group: 'Output',
    },
    {
      id: 'indirectEffects',
      type: 'checkbox',
      label: 'Indirect Effects',
      default: true,
      group: 'Output',
    },
    // Inference
    {
      id: 'bootstrap',
      type: 'checkbox',
      label: 'Bootstrap CI for Indirect Effects',
      default: false,
      group: 'Inference',
    },
    {
      id: 'nBoot',
      type: 'number',
      label: 'Bootstrap Samples',
      default: 1000,
      min: 500,
      max: 5000,
      step: 1,
      group: 'Inference',
    },
  ],
};

/** All SEM specs in a single map for easy lookup */
export const semSpecs = {
  'cfa': cfaSpec,
  'path-analysis': pathAnalysisSpec,
} as const;
