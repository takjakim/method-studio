import type { AnalysisSpec } from './types.ts';

/**
 * PROCESS Model 8 analysis specification.
 * Moderated mediation where W moderates both the a-path (X→M) AND the
 * direct effect c' (X→Y). The indirect effect and the direct effect are
 * each conditional on W, yielding a moderated direct-and-indirect-effects model.
 */
export const processModel8Spec: AnalysisSpec = {
  id: 'process-model-8',
  name: 'PROCESS Model 8',
  category: 'process',
  description: "Moderated mediation: W moderates a-path (X\u2192M) and direct effect c' (X\u2192Y)",
  variables: [
    {
      id: 'outcome',
      label: 'Outcome (Y)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric outcome variable here',
    },
    {
      id: 'predictor',
      label: 'Predictor (X)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric predictor variable here',
    },
    {
      id: 'mediator',
      label: 'Mediator (M)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric mediator variable here',
    },
    {
      id: 'moderator',
      label: 'Moderator (W)',
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
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
  ],
};

/**
 * PROCESS Model 58 analysis specification.
 * Moderated mediation where W moderates both the a-path (X→M) AND the
 * b-path (M→Y). The indirect effect is doubly moderated: its two components
 * (a and b) each vary as a function of W.
 */
export const processModel58Spec: AnalysisSpec = {
  id: 'process-model-58',
  name: 'PROCESS Model 58',
  category: 'process',
  description: 'Moderated mediation: W moderates a-path (X\u2192M) and b-path (M\u2192Y)',
  variables: [
    {
      id: 'outcome',
      label: 'Outcome (Y)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric outcome variable here',
    },
    {
      id: 'predictor',
      label: 'Predictor (X)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric predictor variable here',
    },
    {
      id: 'mediator',
      label: 'Mediator (M)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric mediator variable here',
    },
    {
      id: 'moderator',
      label: 'Moderator (W)',
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
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
  ],
};

/**
 * PROCESS Model 59 analysis specification.
 * Moderated mediation where W moderates ALL paths: the a-path (X→M),
 * the b-path (M→Y), AND the direct effect c' (X→Y). This is the most
 * comprehensive single-moderator, single-mediator moderated mediation model.
 */
export const processModel59Spec: AnalysisSpec = {
  id: 'process-model-59',
  name: 'PROCESS Model 59',
  category: 'process',
  description: "Moderated mediation: W moderates a-path, b-path, and direct effect c' (all paths)",
  variables: [
    {
      id: 'outcome',
      label: 'Outcome (Y)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric outcome variable here',
    },
    {
      id: 'predictor',
      label: 'Predictor (X)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric predictor variable here',
    },
    {
      id: 'mediator',
      label: 'Mediator (M)',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag one numeric mediator variable here',
    },
    {
      id: 'moderator',
      label: 'Moderator (W)',
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
      id: 'standardize',
      type: 'checkbox',
      label: 'Standardized Coefficients',
      default: false,
      group: 'Output',
    },
  ],
};

/** All advanced PROCESS model specs in a single map for easy lookup */
export const processAdvancedSpecs = {
  'process-model-8': processModel8Spec,
  'process-model-58': processModel58Spec,
  'process-model-59': processModel59Spec,
} as const;
