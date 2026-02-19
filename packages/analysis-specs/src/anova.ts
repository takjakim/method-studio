import type { AnalysisSpec } from './types.ts';

/**
 * One-Way ANOVA specification.
 * Tests whether the means of three or more independent groups are equal.
 */
export const anovaOnewaySpec: AnalysisSpec = {
  id: 'anova-oneway',
  name: 'One-Way ANOVA',
  category: 'compare-means',
  description:
    'Test whether the means of three or more independent groups differ significantly.',
  variables: [
    {
      id: 'dependentVariable',
      label: 'Dependent Variable',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag a numeric outcome variable here',
    },
    {
      id: 'groupingVariable',
      label: 'Factor (Grouping Variable)',
      accepts: ['numeric', 'string'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag a categorical grouping variable here',
    },
  ],
  options: [
    {
      id: 'postHocTest',
      type: 'select',
      label: 'Post Hoc Tests',
      default: 'tukey',
      choices: [
        { value: 'tukey',       label: 'Tukey HSD' },
        { value: 'bonferroni',  label: 'Bonferroni' },
        { value: 'none',        label: 'None' },
      ],
      group: 'Post Hoc',
    },
    {
      id: 'effectSize',
      type: 'checkbox',
      label: 'Eta-squared (η²)',
      default: true,
      group: 'Effect Size',
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
      group: 'Options',
    },
    {
      id: 'missingValues',
      type: 'radio',
      label: 'Missing Values',
      default: 'exclude-analysis',
      choices: [
        { value: 'exclude-analysis', label: 'Exclude cases analysis by analysis' },
        { value: 'exclude-listwise', label: 'Exclude cases listwise' },
      ],
      group: 'Options',
    },
  ],
};

/** All ANOVA specs in a single map for easy lookup */
export const anovaSpecs = {
  'anova-oneway': anovaOnewaySpec,
} as const;
