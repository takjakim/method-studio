import type { AnalysisSpec } from './types.ts';

/**
 * One-Sample T-Test specification.
 * Tests whether the population mean equals a hypothesised value.
 */
export const oneSampleTTestSpec: AnalysisSpec = {
  id: 'ttest-one-sample',
  name: 'One-Sample T Test',
  category: 'compare-means',
  description: 'Test whether the population mean of a variable equals a specified value.',
  variables: [
    {
      id: 'testVariables',
      label: 'Test Variable(s)',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag numeric variables here',
    },
  ],
  options: [
    {
      id: 'testValue',
      type: 'number',
      label: 'Test Value (H₀: μ =)',
      default: 0,
      group: 'Hypothesis',
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
      id: 'effectSize',
      type: 'checkbox',
      label: "Cohen's d",
      default: true,
      group: 'Effect Size',
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

/**
 * Independent-Samples T-Test specification.
 * Compares means between two independent groups.
 */
export const independentTTestSpec: AnalysisSpec = {
  id: 'ttest-independent',
  name: 'Independent-Samples T Test',
  category: 'compare-means',
  description: 'Compare means of two independent groups defined by a grouping variable.',
  variables: [
    {
      id: 'testVariables',
      label: 'Test Variable(s)',
      accepts: ['numeric'],
      multiple: true,
      required: true,
      hint: 'Drag numeric outcome variables here',
    },
    {
      id: 'groupingVariable',
      label: 'Grouping Variable',
      accepts: ['numeric', 'string'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Drag a binary grouping variable here',
    },
  ],
  options: [
    {
      id: 'group1Value',
      type: 'number',
      label: 'Group 1 Value',
      default: 1,
      group: 'Group Definition',
    },
    {
      id: 'group2Value',
      type: 'number',
      label: 'Group 2 Value',
      default: 2,
      group: 'Group Definition',
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
      id: 'leveneTest',
      type: 'checkbox',
      label: "Levene's Test for Equality of Variances",
      default: true,
      group: 'Options',
    },
    {
      id: 'effectSize',
      type: 'checkbox',
      label: "Cohen's d",
      default: true,
      group: 'Effect Size',
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

/**
 * Paired-Samples T-Test specification.
 * Tests the mean difference between two related measurements.
 */
export const pairedTTestSpec: AnalysisSpec = {
  id: 'ttest-paired',
  name: 'Paired-Samples T Test',
  category: 'compare-means',
  description: 'Test whether the mean difference between paired measurements equals zero.',
  variables: [
    {
      id: 'variable1',
      label: 'Variable 1',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'First measurement (e.g. pre-test)',
    },
    {
      id: 'variable2',
      label: 'Variable 2',
      accepts: ['numeric'],
      multiple: false,
      required: true,
      maxVariables: 1,
      hint: 'Second measurement (e.g. post-test)',
    },
  ],
  options: [
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
      id: 'effectSize',
      type: 'checkbox',
      label: "Cohen's d (paired)",
      default: true,
      group: 'Effect Size',
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

/** All t-test specs in a single map for easy lookup */
export const tTestSpecs = {
  'ttest-one-sample': oneSampleTTestSpec,
  'ttest-independent': independentTTestSpec,
  'ttest-paired': pairedTTestSpec,
} as const;
