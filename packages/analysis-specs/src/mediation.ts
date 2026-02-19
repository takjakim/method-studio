import type { AnalysisSpec } from './types.ts';

/**
 * Simple Mediation analysis specification (PROCESS Model 4).
 * Tests indirect effects of a predictor on an outcome through one or more mediators.
 */
export const mediationSpec: AnalysisSpec = {
  id: 'mediation',
  name: 'Mediation Analysis',
  category: 'process',
  description: 'Test indirect effects through mediating variables (PROCESS Model 4)',
  variables: [
    {
      id: 'outcome',
      label: 'Outcome Variable (Y)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric outcome variable here',
    },
    {
      id: 'predictor',
      label: 'Predictor Variable (X)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric predictor variable here',
    },
    {
      id: 'mediators',
      label: 'Mediator(s) (M)',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      minVariables: 1,
      hint: 'Drag one or more numeric mediator variables here',
    },
    {
      id: 'covariates',
      label: 'Covariates',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Drag optional numeric covariates here',
    },
  ],
  options: [
    {
      id: 'bootstrap',
      type: 'checkbox',
      label: 'Bootstrap CI',
      default: true,
      group: 'Inference',
    },
    {
      id: 'nBoot',
      type: 'number',
      label: 'Bootstrap Samples',
      default: 5000,
      min: 1000,
      max: 10000,
      group: 'Inference',
    },
    {
      id: 'ciLevel',
      type: 'select',
      label: 'Confidence Level',
      default: 0.95,
      choices: [
        { value: 0.90, label: '90%' },
        { value: 0.95, label: '95%' },
        { value: 0.99, label: '99%' },
      ],
      group: 'Inference',
    },
    {
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
    {
      id: 'effectSize',
      type: 'checkbox',
      label: 'Effect Sizes (Kappa-squared)',
      default: true,
      group: 'Output',
    },
    {
      id: 'totalEffect',
      type: 'checkbox',
      label: 'Show Total Effect',
      default: true,
      group: 'Output',
    },
  ],
};

/** All PROCESS mediation specs in a single map for easy lookup */
export const mediationSpecs = {
  mediation: mediationSpec,
} as const;
