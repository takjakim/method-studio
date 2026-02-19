import type { AnalysisSpec } from './types.ts';

/**
 * Multi-Group Confirmatory Factor Analysis specification.
 * Tests measurement invariance across groups by fitting the same factor
 * structure in multiple groups simultaneously and comparing model constraints.
 */
export const multigroupCFASpec: AnalysisSpec = {
  id: 'multigroup-cfa',
  name: 'Multi-Group CFA',
  category: 'sem',
  description: 'Test measurement invariance of a factor structure across groups',
  variables: [
    {
      id: 'indicators',
      label: 'Indicator Variables',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      minVariables: 3,
      hint: 'Drag at least 3 numeric indicator variables here',
    },
    {
      id: 'groupingVariable',
      label: 'Grouping Variable',
      accepts: ['string', 'numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag the categorical variable that defines groups here',
    },
  ],
  options: [
    // Model
    {
      id: 'nFactors',
      type: 'number',
      label: 'Number of Factors',
      default: 1,
      min: 1,
      max: 10,
      step: 1,
      group: 'Model',
    },
    {
      id: 'invarianceLevel',
      type: 'select',
      label: 'Invariance Level',
      default: 'metric',
      choices: [
        { value: 'configural', label: 'Configural (same factor structure)' },
        { value: 'metric', label: 'Metric (equal loadings)' },
        { value: 'scalar', label: 'Scalar (equal loadings + intercepts)' },
        { value: 'strict', label: 'Strict (equal loadings, intercepts + residuals)' },
      ],
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
      id: 'modelComparison',
      type: 'checkbox',
      label: 'Sequential Model Comparison (\u0394CFI, \u0394\u03c7\u00b2)',
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
    // Options
    {
      id: 'missingValues',
      type: 'select',
      label: 'Missing Values',
      default: 'listwise',
      choices: [
        { value: 'listwise', label: 'Listwise deletion' },
        { value: 'fiml', label: 'Full Information ML' },
      ],
      group: 'Options',
    },
  ],
};

/** All multi-group CFA specs in a single map for easy lookup */
export const multigroupCFASpecs = {
  'multigroup-cfa': multigroupCFASpec,
} as const;
