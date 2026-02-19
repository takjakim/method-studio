import type { AnalysisSpec } from './types.ts';

/**
 * Serial Mediation analysis specification (PROCESS Model 6).
 * Tests indirect effects through two sequentially ordered mediators,
 * where the first mediator causally precedes the second.
 */
export const serialMediationSpec: AnalysisSpec = {
  id: 'serial-mediation',
  name: 'Serial Mediation',
  category: 'process',
  description: 'Test indirect effects through two sequential mediators (PROCESS Model 6)',
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
      id: 'mediator1',
      label: 'First Mediator (M1)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag the first (proximal to X) mediator here',
    },
    {
      id: 'mediator2',
      label: 'Second Mediator (M2)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag the second (proximal to Y) mediator here',
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
    // Inference
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
      step: 1,
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
    // Output
    {
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
    {
      id: 'contrastPaths',
      type: 'checkbox',
      label: 'Contrast Specific Indirect Paths',
      default: true,
      group: 'Output',
    },
    {
      id: 'totalIndirect',
      type: 'checkbox',
      label: 'Show Total Indirect Effect',
      default: true,
      group: 'Output',
    },
    {
      id: 'effectSize',
      type: 'checkbox',
      label: 'Effect Sizes (Kappa-squared)',
      default: false,
      group: 'Output',
    },
  ],
};

/** All serial mediation specs in a single map for easy lookup */
export const serialMediationSpecs = {
  'serial-mediation': serialMediationSpec,
} as const;
