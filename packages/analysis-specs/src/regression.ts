import type { AnalysisSpec } from './types.ts';

/**
 * Linear Regression analysis specification.
 * Supports simple (one predictor) and multiple (two or more predictors) OLS regression.
 */
export const linearRegressionSpec: AnalysisSpec = {
  id: 'regression-linear',
  name: 'Linear Regression',
  category: 'regression',
  description:
    'Predict a continuous outcome from one or more numeric predictors using Ordinary Least Squares.',
  variables: [
    {
      id: 'dependent',
      label: 'Dependent Variable',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric outcome variable here',
    },
    {
      id: 'independents',
      label: 'Independent Variable(s)',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag one or more numeric predictor variables here',
    },
  ],
  options: [
    {
      id: 'includeConstant',
      type: 'checkbox',
      label: 'Include constant (intercept)',
      default: true,
      group: 'Model',
    },
    {
      id: 'confidenceLevel',
      type: 'select',
      label: 'Confidence Interval',
      default: 0.95,
      choices: [
        { value: 0.90, label: '90%' },
        { value: 0.95, label: '95%' },
        { value: 0.99, label: '99%' },
      ],
      group: 'Model',
    },
    {
      id: 'diagnostics',
      type: 'checkbox',
      label: 'Model diagnostics (residual plots, normality test)',
      default: true,
      group: 'Diagnostics',
    },
    {
      id: 'vif',
      type: 'checkbox',
      label: 'Variance Inflation Factor (VIF) for multicollinearity',
      default: true,
      group: 'Diagnostics',
    },
    {
      id: 'missingValues',
      type: 'radio',
      label: 'Missing Values',
      default: 'exclude-listwise',
      choices: [
        { value: 'exclude-listwise', label: 'Exclude cases listwise' },
        { value: 'exclude-analysis', label: 'Exclude cases analysis by analysis' },
      ],
      group: 'Options',
    },
  ],
};

/** All regression specs in a single map for easy lookup */
export const regressionSpecs = {
  'regression-linear': linearRegressionSpec,
} as const;
