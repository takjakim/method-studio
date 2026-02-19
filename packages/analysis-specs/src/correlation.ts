import type { AnalysisSpec } from './types.ts';

/**
 * Correlation analysis specification.
 * Computes pairwise correlation coefficients (Pearson, Spearman, or Kendall)
 * along with p-values, sample sizes, and optional confidence intervals.
 */
export const correlationSpec: AnalysisSpec = {
  id: 'correlation',
  name: 'Correlation',
  category: 'correlation',
  description:
    'Compute pairwise correlations between numeric variables with p-values and optional confidence intervals.',
  variables: [
    {
      id: 'variables',
      label: 'Variables',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag two or more numeric variables here',
    },
  ],
  options: [
    // Method
    {
      id: 'method',
      type: 'radio',
      label: 'Correlation Coefficient',
      default: 'pearson',
      choices: [
        { value: 'pearson',  label: 'Pearson'  },
        { value: 'spearman', label: 'Spearman' },
        { value: 'kendall',  label: 'Kendall\'s tau-b' },
      ],
      group: 'Method',
    },
    // Hypothesis
    {
      id: 'twoTailed',
      type: 'checkbox',
      label: 'Two-tailed test',
      default: true,
      group: 'Hypothesis',
    },
    // Output options
    {
      id: 'flagSignificant',
      type: 'checkbox',
      label: 'Flag significant correlations',
      default: true,
      group: 'Output',
    },
    {
      id: 'alpha',
      type: 'number',
      label: 'Significance level (\u03b1)',
      default: 0.05,
      min: 0.001,
      max: 0.20,
      step: 0.001,
      group: 'Output',
    },
    {
      id: 'confidenceIntervals',
      type: 'checkbox',
      label: 'Confidence intervals (Pearson only)',
      default: false,
      group: 'Output',
    },
    {
      id: 'pairwiseN',
      type: 'checkbox',
      label: 'Show pairwise N',
      default: true,
      group: 'Output',
    },
  ],
};
