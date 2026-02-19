import type { AnalysisSpec } from './types.ts';

/**
 * Multilevel Modeling (HLM / Mixed Effects) specification.
 * Handles nested data structures by partitioning variance between levels
 * and modeling cross-level interactions between Level-1 and Level-2 predictors.
 */
export const multilevelSpec: AnalysisSpec = {
  id: 'multilevel',
  name: 'Multilevel Modeling (HLM)',
  category: 'regression',
  description: 'Analyze nested/clustered data with random intercepts and slopes',
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
      id: 'level1Predictors',
      label: 'Level-1 Predictors (Within-Group)',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Drag individual-level numeric predictors here',
    },
    {
      id: 'level2Predictors',
      label: 'Level-2 Predictors (Between-Group)',
      accepts: ['numeric'],
      multiple: true,
      required: false,
      hint: 'Drag group-level numeric predictors here',
    },
    {
      id: 'groupingVariable',
      label: 'Grouping Variable (Cluster ID)',
      accepts: ['string', 'numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag the variable that identifies group membership here',
    },
  ],
  options: [
    // Model
    {
      id: 'randomIntercept',
      type: 'checkbox',
      label: 'Random Intercept',
      default: true,
      group: 'Random Effects',
    },
    {
      id: 'randomSlopes',
      type: 'checkbox',
      label: 'Random Slopes (for Level-1 predictors)',
      default: false,
      group: 'Random Effects',
    },
    {
      id: 'crossLevelInteraction',
      type: 'checkbox',
      label: 'Cross-Level Interactions',
      default: false,
      group: 'Random Effects',
    },
    // Centering
    {
      id: 'centering',
      type: 'select',
      label: 'Level-1 Predictor Centering',
      default: 'cwc',
      choices: [
        { value: 'cwc', label: 'Centering Within Cluster (CWC)' },
        { value: 'cgm', label: 'Grand Mean Centering (CGM)' },
        { value: 'none', label: 'No Centering' },
      ],
      group: 'Model',
    },
    // Estimation
    {
      id: 'REML',
      type: 'checkbox',
      label: 'Restricted Maximum Likelihood (REML)',
      default: true,
      group: 'Estimation',
    },
    {
      id: 'optimizer',
      type: 'select',
      label: 'Optimizer',
      default: 'bobyqa',
      choices: [
        { value: 'bobyqa', label: 'BOBYQA (recommended)' },
        { value: 'nlminbwrap', label: 'nlminbwrap' },
        { value: 'nloptwrap', label: 'nloptwrap' },
      ],
      group: 'Estimation',
    },
    // Output
    {
      id: 'icc',
      type: 'checkbox',
      label: 'Intraclass Correlation (ICC)',
      default: true,
      group: 'Output',
    },
    {
      id: 'r2',
      type: 'checkbox',
      label: 'Pseudo-R\u00b2 (Nakagawa & Schielzeth)',
      default: true,
      group: 'Output',
    },
    {
      id: 'randomEffectsTable',
      type: 'checkbox',
      label: 'Random Effects Variance Components',
      default: true,
      group: 'Output',
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
      group: 'Output',
    },
  ],
};

/** All multilevel modeling specs in a single map for easy lookup */
export const multilevelSpecs = {
  multilevel: multilevelSpec,
} as const;
