import type { AnalysisSpec } from './types.ts';

/**
 * Descriptive Statistics analysis specification.
 * Covers central tendency, dispersion, distribution shape,
 * percentiles, and frequency tables.
 */
export const descriptivesSpec: AnalysisSpec = {
  id: 'descriptives',
  name: 'Descriptive Statistics',
  category: 'descriptive',
  description: 'Compute summary statistics for numeric and categorical variables.',
  variables: [
    {
      id: 'variables',
      label: 'Variable(s)',
      accepts: ['numeric', 'string'],
      multiple: true,
      required: true,
      hint: 'Drag numeric or categorical variables here',
    },
  ],
  options: [
    // Central tendency
    {
      id: 'mean',
      type: 'checkbox',
      label: 'Mean',
      default: true,
      group: 'Central Tendency',
    },
    {
      id: 'median',
      type: 'checkbox',
      label: 'Median',
      default: true,
      group: 'Central Tendency',
    },
    {
      id: 'mode',
      type: 'checkbox',
      label: 'Mode',
      default: false,
      group: 'Central Tendency',
    },
    // Dispersion
    {
      id: 'stdDev',
      type: 'checkbox',
      label: 'Standard Deviation',
      default: true,
      group: 'Dispersion',
    },
    {
      id: 'variance',
      type: 'checkbox',
      label: 'Variance',
      default: false,
      group: 'Dispersion',
    },
    {
      id: 'range',
      type: 'checkbox',
      label: 'Range',
      default: false,
      group: 'Dispersion',
    },
    {
      id: 'minimum',
      type: 'checkbox',
      label: 'Minimum',
      default: true,
      group: 'Dispersion',
    },
    {
      id: 'maximum',
      type: 'checkbox',
      label: 'Maximum',
      default: true,
      group: 'Dispersion',
    },
    {
      id: 'semMean',
      type: 'checkbox',
      label: 'S.E. Mean',
      default: false,
      group: 'Dispersion',
    },
    // Distribution shape
    {
      id: 'skewness',
      type: 'checkbox',
      label: 'Skewness',
      default: false,
      group: 'Distribution',
    },
    {
      id: 'kurtosis',
      type: 'checkbox',
      label: 'Kurtosis',
      default: false,
      group: 'Distribution',
    },
    // Percentiles
    {
      id: 'quartiles',
      type: 'checkbox',
      label: 'Quartiles (Q1, Q2, Q3)',
      default: false,
      group: 'Percentiles',
    },
    {
      id: 'percentiles',
      type: 'checkbox',
      label: 'Custom Percentiles',
      default: false,
      group: 'Percentiles',
    },
    {
      id: 'percentileValues',
      type: 'select',
      label: 'Percentile Cut Points',
      default: [5, 10, 25, 75, 90, 95],
      choices: [
        { value: [5, 10, 25, 75, 90, 95], label: '5, 10, 25, 75, 90, 95' },
        { value: [10, 20, 30, 40, 50, 60, 70, 80, 90], label: 'Deciles (10-90)' },
        { value: [1, 5, 10, 25, 50, 75, 90, 95, 99], label: 'Full range' },
      ],
      group: 'Percentiles',
    },
    // Frequency / categorical
    {
      id: 'frequencyTable',
      type: 'checkbox',
      label: 'Frequency Table (categorical variables)',
      default: false,
      group: 'Frequency',
    },
    {
      id: 'validN',
      type: 'checkbox',
      label: 'N (valid cases)',
      default: true,
      group: 'Frequency',
    },
  ],
};
