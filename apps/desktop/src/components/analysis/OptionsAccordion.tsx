/**
 * OptionsAccordion.tsx
 *
 * Jamovi-style collapsible options panel (RIGHT panel of analysis dialog).
 *
 * Renders option groups as collapsible accordion sections.
 * Each section contains typed controls:
 *   - checkbox
 *   - radio group
 *   - select dropdown
 *   - number input
 *
 * All sections start open unless `defaultOpenGroups` overrides this.
 * Styling via jamovi.css (.jv-*).
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OptionSpec } from '@method-studio/analysis-specs';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface OptionsAccordionProps {
  /** Grouped option specs: Map<groupName, OptionSpec[]> */
  optionGroups: Map<string, OptionSpec[]>;
  /** Current option values keyed by option id */
  values: Record<string, unknown>;
  /** Called when the user changes any option */
  onChange: (optionId: string, value: unknown) => void;
  /**
   * Set of group names that should start expanded.
   * Defaults to ALL groups open when omitted.
   */
  defaultOpenGroups?: Set<string>;
}

/* ------------------------------------------------------------------ */
/* Chevron SVG (CSS-animated)                                           */
/* ------------------------------------------------------------------ */

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={`jv-accordion-chevron${isOpen ? ' is-open' : ''}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 2.5L7.5 6L4 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Individual option controls                                            */
/* ------------------------------------------------------------------ */

interface ControlProps {
  opt: OptionSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}

function CheckboxControl({ opt, value, onChange }: ControlProps) {
  return (
    <label className="jv-opt-checkbox">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{opt.label}</span>
    </label>
  );
}

function RadioControl({ opt, value, onChange }: ControlProps) {
  return (
    <div className="jv-opt-radio-group">
      <div className="jv-opt-radio-label-group">{opt.label}</div>
      {(opt.choices ?? []).map(choice => (
        <label
          key={String(choice.value)}
          className="jv-opt-radio"
        >
          <input
            type="radio"
            name={opt.id}
            value={String(choice.value)}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </div>
  );
}

function SelectControl({ opt, value, onChange }: ControlProps) {
  return (
    <div className="jv-opt-field">
      <div className="jv-opt-field-label">{opt.label}</div>
      <select
        className="jv-opt-select"
        value={String(value)}
        onChange={e => {
          const chosen = opt.choices?.find(c => String(c.value) === e.target.value);
          onChange(chosen ? chosen.value : e.target.value);
        }}
      >
        {(opt.choices ?? []).map(choice => (
          <option key={String(choice.value)} value={String(choice.value)}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberControl({ opt, value, onChange }: ControlProps) {
  return (
    <div className="jv-opt-field">
      <div className="jv-opt-field-label">{opt.label}</div>
      <input
        type="number"
        className="jv-opt-number"
        value={value as number}
        min={opt.min}
        max={opt.max}
        step={opt.step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function OptionControl({ opt, value, onChange }: ControlProps) {
  switch (opt.type) {
    case 'checkbox': return <CheckboxControl opt={opt} value={value} onChange={onChange} />;
    case 'radio':    return <RadioControl opt={opt} value={value} onChange={onChange} />;
    case 'select':   return <SelectControl opt={opt} value={value} onChange={onChange} />;
    case 'number':   return <NumberControl opt={opt} value={value} onChange={onChange} />;
    default:         return null;
  }
}

/* ------------------------------------------------------------------ */
/* Single accordion section                                             */
/* ------------------------------------------------------------------ */

interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <div className="jv-accordion-section">
      <button
        className="jv-accordion-trigger"
        onClick={onToggle}
        aria-expanded={isOpen}
        type="button"
      >
        <span>{title}</span>
        <ChevronIcon isOpen={isOpen} />
      </button>
      <div
        className={`jv-accordion-body${isOpen ? ' is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="jv-accordion-content">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* OptionsAccordion (main export)                                        */
/* ------------------------------------------------------------------ */

// Translation mappings for common option labels
const LABEL_TRANSLATIONS: Record<string, string> = {
  // Group names
  'Model': 'options.groups.model',
  'Output': 'options.groups.output',
  'Options': 'options.groups.options',
  'Inference': 'options.groups.inference',
  'Statistics': 'options.groups.statistics',
  'Assumption Checks': 'options.groups.assumptionChecks',
  'Post-Hoc': 'options.groups.postHoc',
  'Missing Values': 'options.groups.missingValues',

  // Common option labels
  'Estimator': 'options.labels.estimator',
  'Maximum Likelihood': 'options.labels.ml',
  'Robust ML': 'options.labels.mlr',
  'Weighted Least Squares': 'options.labels.wlsmv',
  'Standardized Solution': 'options.labels.standardized',
  'Standardized Coefficients': 'options.labels.standardizedCoef',
  'Fit Indices': 'options.labels.fitIndices',
  'Fit Indices (CFI, TLI, RMSEA, SRMR)': 'options.labels.fitIndicesFull',
  'Modification Indices': 'options.labels.modificationIndices',
  'Residual Correlations': 'options.labels.residualCorrelations',
  'Orthogonal Factors (no correlations)': 'options.labels.orthogonal',
  'Listwise Deletion': 'options.labels.listwise',
  'Full Information ML': 'options.labels.fiml',
  'Effect Size': 'options.labels.effectSize',
  'Confidence Interval': 'options.labels.confidenceInterval',
  'Descriptive Statistics': 'options.labels.descriptives',
  'Bootstrap Samples': 'options.labels.bootstrapSamples',
  'Confidence Level': 'options.labels.confidenceLevel',
  'Total Effect': 'options.labels.totalEffect',
  'Effect Sizes': 'options.labels.effectSizes',
  'Mean': 'options.labels.mean',
  'Median': 'options.labels.median',
  'Mode': 'options.labels.mode',
  'Standard Deviation': 'options.labels.sd',
  'Variance': 'options.labels.variance',
  'Range': 'options.labels.range',
  'Minimum': 'options.labels.min',
  'Maximum': 'options.labels.max',
  'Skewness': 'options.labels.skewness',
  'Kurtosis': 'options.labels.kurtosis',
  'Frequency Tables': 'options.labels.frequencyTables',
  'Percentiles': 'options.labels.percentiles',
  'Test Value': 'options.labels.testValue',
  "Cohen's d": 'options.labels.cohensD',
  "Levene's Test": 'options.labels.levenesTest',
  "Tukey's HSD": 'options.labels.tukeyHSD',
  'Bonferroni': 'options.labels.bonferroni',
  'Scheffe': 'options.labels.scheffe',
  'Correlation Method': 'options.labels.correlationMethod',
  'Pearson': 'options.labels.pearson',
  'Spearman': 'options.labels.spearman',
  'Kendall': 'options.labels.kendall',
  'Flag Significant': 'options.labels.flagSignificant',
  'Pairwise Deletion': 'options.labels.pairwiseDeletion',
  'Extraction Method': 'options.labels.extractionMethod',
  'Principal Axis': 'options.labels.principalAxis',
  'Principal Components': 'options.labels.principalComponents',
  'Rotation': 'options.labels.rotation',
  'Varimax': 'options.labels.varimax',
  'Promax': 'options.labels.promax',
  'Oblimin': 'options.labels.oblimin',
  'None': 'options.labels.none',
  'Number of Factors': 'options.labels.nFactors',
  'Scree Plot': 'options.labels.screePlot',
  'Factor Loadings': 'options.labels.factorLoadings',
  'Communalities': 'options.labels.communalities',
  'KMO & Bartlett Test': 'options.labels.kmo',
  'Indirect Effects': 'options.labels.indirectEffects',
  'Bootstrap CI': 'options.labels.bootstrapCI',
  'Probe Interaction': 'options.labels.probeInteraction',
  'Johnson-Neyman': 'options.labels.johnsonNeyman',
  'Mean-Center Predictors': 'options.labels.meanCenter',
  'Simple Slopes': 'options.labels.simpleSlopes',
  'Interaction Plot': 'options.labels.interactionPlot',
  'Random Intercept': 'options.labels.randomIntercept',
  'Random Slopes': 'options.labels.randomSlopes',
  'ICC': 'options.labels.icc',
  'REML Estimation': 'options.labels.reml',
};

export function OptionsAccordion({
  optionGroups,
  values,
  onChange,
  defaultOpenGroups,
}: OptionsAccordionProps) {
  const { t, i18n } = useTranslation();

  // Translate label if translation exists
  const translateLabel = useCallback((label: string): string => {
    if (i18n.language === 'en') return label;
    const key = LABEL_TRANSLATIONS[label];
    if (key) {
      const translated = t(key);
      // If translation key doesn't exist, return original
      return translated === key ? label : translated;
    }
    return label;
  }, [t, i18n.language]);

  /* Initialise open state: all open by default */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    if (defaultOpenGroups) return new Set(defaultOpenGroups);
    return new Set(optionGroups.keys());
  });

  const toggleGroup = useCallback((name: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  if (optionGroups.size === 0) {
    return (
      <div className="jv-options-panel">
        <div className="jv-options-panel-title">{t('analysis.options')}</div>
        <div
          style={{
            padding: '16px 12px',
            fontSize: 'var(--jv-font-xs)',
            color: 'var(--jv-text-muted)',
            textAlign: 'center',
          }}
        >
          {t('options.noOptions')}
        </div>
      </div>
    );
  }

  // Translate options for display
  const translateOption = (opt: OptionSpec): OptionSpec => ({
    ...opt,
    label: translateLabel(opt.label),
    choices: opt.choices?.map(c => ({
      ...c,
      label: translateLabel(c.label),
    })),
  });

  return (
    <div className="jv-options-panel">
      <div className="jv-options-panel-title">{t('analysis.options')}</div>

      {Array.from(optionGroups.entries()).map(([groupName, opts]) => (
        <AccordionSection
          key={groupName}
          title={translateLabel(groupName)}
          isOpen={openGroups.has(groupName)}
          onToggle={() => toggleGroup(groupName)}
        >
          {opts.map(opt => (
            <OptionControl
              key={opt.id}
              opt={translateOption(opt)}
              value={values[opt.id]}
              onChange={val => onChange(opt.id, val)}
            />
          ))}
        </AccordionSection>
      ))}
    </div>
  );
}
