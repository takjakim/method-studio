import type { AnalysisSpec } from './types.ts';

/**
 * Moderated Mediation analysis specification (PROCESS Model 7/14/58/59).
 * Tests whether the indirect effect of a predictor on an outcome through a
 * mediator is contingent on the level of a moderating variable.
 */
export const moderatedMediationSpec: AnalysisSpec = {
  id: 'moderated-mediation',
  name: 'Moderated Mediation',
  category: 'process',
  description: 'Test conditional indirect effects (PROCESS Models 7, 14, 58, 59)',
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
      id: 'mediator',
      label: 'Mediator Variable (M)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric mediator variable here',
    },
    {
      id: 'moderator',
      label: 'Moderator Variable (W)',
      accepts: ['numeric', 'string'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric or categorical moderator variable here',
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
    // Simple Slopes
    {
      id: 'probeValues',
      type: 'select',
      label: 'Probe Values for Moderator',
      default: 'mean_sd',
      choices: [
        { value: 'mean_sd', label: 'Mean \u00b1 1 SD' },
        { value: 'percentiles', label: '16th, 50th, 84th percentiles' },
        { value: 'minmax', label: 'Min, Mean, Max' },
      ],
      group: 'Simple Slopes',
    },
    {
      id: 'johnsonNeyman',
      type: 'checkbox',
      label: 'Johnson-Neyman Regions of Significance',
      default: true,
      group: 'Simple Slopes',
    },
    // Output
    {
      id: 'modelNumber',
      type: 'select',
      label: 'PROCESS Model Number',
      default: 7,
      choices: [
        { value: 7, label: 'Model 7 (W moderates a-path)' },
        { value: 14, label: 'Model 14 (W moderates b-path)' },
        { value: 58, label: 'Model 58 (W moderates a and b paths)' },
        { value: 59, label: 'Model 59 (W moderates c\u2019-path)' },
      ],
      group: 'Model',
    },
    {
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
  ],
};

/** All moderated mediation specs in a single map for easy lookup */
export const moderatedMediationSpecs = {
  'moderated-mediation': moderatedMediationSpec,
} as const;
