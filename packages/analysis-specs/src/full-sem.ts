import type { AnalysisSpec } from './types.ts';

/**
 * Full Structural Equation Modeling specification.
 * Combines a measurement model (latent variables from indicators) with a
 * structural model (regression paths among latent and observed variables).
 */
export const fullSEMSpec: AnalysisSpec = {
  id: 'full-sem',
  name: 'Full Structural Equation Model',
  category: 'sem',
  description: 'Estimate latent variable measurement + structural paths simultaneously',
  variables: [
    {
      id: 'indicators',
      label: 'Indicator Variables (for Latent Factors)',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      minVariables: 3,
      hint: 'Drag numeric indicators for latent variables here',
    },
    {
      id: 'observed',
      label: 'Observed (Manifest) Variables',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Drag observed variables that appear as predictors/outcomes in the structural model',
    },
  ],
  options: [
    // Model
    {
      id: 'nFactors',
      type: 'number',
      label: 'Number of Latent Factors',
      default: 2,
      min: 1,
      max: 10,
      step: 1,
      group: 'Model',
    },
    {
      id: 'estimator',
      type: 'select',
      label: 'Estimator',
      default: 'ML',
      choices: [
        { value: 'ML', label: 'Maximum Likelihood' },
        { value: 'MLR', label: 'Robust ML (Satorra-Bentler)' },
        { value: 'WLSMV', label: 'Weighted Least Squares (ordinal)' },
        { value: 'Bayes', label: 'Bayesian (MCMC)' },
      ],
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
      id: 'rsquared',
      type: 'checkbox',
      label: 'R\u00b2 for Endogenous Variables',
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
    // Options
    {
      id: 'missingValues',
      type: 'select',
      label: 'Missing Values',
      default: 'fiml',
      choices: [
        { value: 'listwise', label: 'Listwise deletion' },
        { value: 'fiml', label: 'Full Information ML' },
      ],
      group: 'Options',
    },
  ],
};

/** All full SEM specs in a single map for easy lookup */
export const fullSEMSpecs = {
  'full-sem': fullSEMSpec,
} as const;
