import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';
import {
  oneSampleTTestSpec,
  independentTTestSpec,
  pairedTTestSpec,
} from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';

type TTestTab = 'one-sample' | 'independent' | 'paired';

const TAB_SPECS = {
  'one-sample': oneSampleTTestSpec,
  independent: independentTTestSpec,
  paired: pairedTTestSpec,
} as const;

interface TTestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
  initialTab?: TTestTab;
}

/**
 * T Tests dialog.
 *
 * Provides a tab bar for selecting the t-test type (One-Sample, Independent,
 * Paired), then delegates the variable assignment and options UI to
 * JamoviStyleDialog with full drag-and-drop support via embedded mode.
 */
export function TTestDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
  initialTab = 'one-sample',
}: TTestDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TTestTab>(initialTab);

  const tabLabels: Record<TTestTab, string> = {
    'one-sample': t('analyses.ttest.oneSample'),
    independent: t('analyses.ttest.independent'),
    paired: t('analyses.ttest.paired'),
  };

  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  if (!isOpen) return null;

  return (
    // Outer overlay — clicking the backdrop closes the dialog
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      {/* Dialog shell — stop clicks propagating to the backdrop */}
      <div
        className="jv-dialog flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('analyses.ttest.title')}
      >
        {/* ---- Header ---- */}
        <div className="jv-dialog-header">
          <div className="jv-dialog-header-left">
            <span className="jv-dialog-eyebrow">{t('app.analysis')}</span>
            <span className="jv-dialog-title">{t('analyses.ttest.title')}</span>
          </div>
          <button
            className="jv-dialog-close"
            onClick={onClose}
            aria-label={t('analysis.close')}
            type="button"
          >
            &times;
          </button>
        </div>

        {/* ---- Tab bar: t-test type selector ---- */}
        <div
          className="flex border-b px-1 pt-1"
          style={{ backgroundColor: 'var(--jv-bg-panel)', borderColor: 'var(--jv-border)' }}
        >
          {(Object.keys(TAB_SPECS) as TTestTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
              className={`px-4 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent hover:bg-gray-100'
              }`}
              style={activeTab !== tab ? { color: 'var(--jv-text-secondary)' } : undefined}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/*
         * ---- Active analysis body ----
         * JamoviStyleDialog runs in embedded mode: it renders its body and
         * footer directly without a second overlay or dialog shell.
         * key={activeTab} resets all slot/option state when switching tabs.
         */}
        <JamoviStyleDialog
          key={activeTab}
          spec={TAB_SPECS[activeTab]}
          datasetName={datasetName}
          availableVariables={availableVariables}
          isOpen={true}
          onClose={onClose}
          onRun={onRun}
          isRunning={isRunning}
          embedded
        />
      </div>
    </div>
  );
}

// Convenience hook for managing open state
export function useTTestDialog(defaultTab: TTestTab = 'one-sample') {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<TTestTab>(defaultTab);
  return {
    isOpen,
    activeTab: tab,
    open: (t?: TTestTab) => { if (t) setTab(t); setIsOpen(true); },
    close: () => setIsOpen(false),
  };
}
