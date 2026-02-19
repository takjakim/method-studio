import type { AnalysisSpec } from './types.ts';

/**
 * Simple Moderation analysis specification (PROCESS Model 1).
 * Tests whether the relationship between a predictor and outcome
 * varies as a function of a moderating variable.
 */
export const moderationSpec: AnalysisSpec = {
  id: 'moderation',
  name: 'Moderation Analysis',
  category: 'process',
  description: 'Test interaction effects with moderating variables (PROCESS Model 1)',
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
      hint: 'Drag one or more numeric covariate variables here',
    },
  ],
  options: [
    {
      id: 'centering',
      type: 'select',
      label: 'Variable Centering',
      default: 'mean',
      choices: [
        { value: 'mean', label: 'Mean Centering' },
        { value: 'none', label: 'No Centering' },
      ],
      group: 'Model',
    },
    {
      id: 'probeInteraction',
      type: 'checkbox',
      label: 'Probe Interaction',
      default: true,
      group: 'Simple Slopes',
    },
    {
      id: 'probeValues',
      type: 'select',
      label: 'Probe Values',
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
      label: 'Johnson-Neyman Analysis',
      default: true,
      group: 'Simple Slopes',
    },
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
      id: 'interactionPlot',
      type: 'checkbox',
      label: 'Interaction Plot',
      default: true,
      group: 'Output',
    },
  ],
};

/** All PROCESS specs in a single map for easy lookup */
export const processSpecs = {
  moderation: moderationSpec,
} as const;
