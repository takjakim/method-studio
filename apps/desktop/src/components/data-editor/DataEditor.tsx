import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DataView } from './DataView';
import { VariableView } from './VariableView';
import { useDataStore, initializeEmptyDataset } from '../../stores/data-store';

type Tab = 'data' | 'variable';

// Sample datasets with translation keys (file name without extension used as key)
const SAMPLE_DATASETS = [
  // Basic Statistics
  { file: 'descriptives_example.csv', key: 'descriptives_example', analysis: 'descriptives' },
  { file: 'one_sample_ttest_example.csv', key: 'one_sample_ttest_example', analysis: 'ttest-one-sample' },
  { file: 'independent_ttest_example.csv', key: 'independent_ttest_example', analysis: 'ttest-independent' },
  { file: 'paired_ttest_example.csv', key: 'paired_ttest_example', analysis: 'ttest-paired' },
  { file: 'anova_example.csv', key: 'anova_example', analysis: 'anova-oneway' },
  { file: 'correlation_example.csv', key: 'correlation_example', analysis: 'correlation' },
  { file: 'regression_example.csv', key: 'regression_example', analysis: 'regression-linear' },
  // Factor Analysis
  { file: 'efa_example.csv', key: 'efa_example', analysis: 'efa' },
  { file: 'cfa_example.csv', key: 'cfa_example', analysis: 'cfa' },
  { file: 'multigroup_cfa_example.csv', key: 'multigroup_cfa_example', analysis: 'multigroup-cfa' },
  // PROCESS Models
  { file: 'mediation_example.csv', key: 'mediation_example', analysis: 'mediation' },
  { file: 'moderation_example.csv', key: 'moderation_example', analysis: 'moderation' },
  { file: 'moderated_mediation_example.csv', key: 'moderated_mediation_example', analysis: 'moderated-mediation' },
  { file: 'serial_mediation_example.csv', key: 'serial_mediation_example', analysis: 'serial-mediation' },
  { file: 'process_model8_example.csv', key: 'process_model8_example', analysis: 'process-model-8' },
  { file: 'process_model58_example.csv', key: 'process_model58_example', analysis: 'process-model-58' },
  { file: 'process_model59_example.csv', key: 'process_model59_example', analysis: 'process-model-59' },
  // SEM & Multilevel
  { file: 'path_analysis_example.csv', key: 'path_analysis_example', analysis: 'path-analysis' },
  { file: 'sem_example.csv', key: 'sem_example', analysis: 'full-sem' },
  { file: 'multilevel_example.csv', key: 'multilevel_example', analysis: 'multilevel' },
] as const;

export function DataEditor() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const dataset = useDataStore((s) => s.dataset);
  const isDirty = useDataStore((s) => s.isDirty);
  const importCSV = useDataStore((s) => s.importCSV);
  const exportCSV = useDataStore((s) => s.exportCSV);
  const exportSAV = useDataStore((s) => s.exportSAV);
  const clearDataset = useDataStore((s) => s.clearDataset);
  const loadSampleData = useDataStore((s) => s.loadSampleData);

  useEffect(() => {
    initializeEmptyDataset();
  }, []);

  useEffect(() => {
    const handleClickOutside = () => setShowSampleMenu(false);
    if (showSampleMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showSampleMenu]);

  const handleNewDataset = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(t('dataEditor.unsavedChanges'));
      if (!confirmed) return;
    }
    clearDataset();
    initializeEmptyDataset();
  }, [isDirty, clearDataset, t]);

  const handleImportCSV = useCallback(async () => {
    await importCSV('/placeholder/data.csv');
  }, [importCSV]);

  const handleExportCSV = useCallback(async () => {
    if (!dataset) return;
    await exportCSV(`/placeholder/${dataset.name}.csv`);
  }, [dataset, exportCSV]);

  const handleExportSAV = useCallback(async () => {
    if (!dataset) return;
    await exportSAV(`/placeholder/${dataset.name}.sav`);
  }, [dataset, exportSAV]);

  const handleLoadSampleData = useCallback(async (filename: string) => {
    if (isDirty) {
      const confirmed = window.confirm(t('dataEditor.unsavedChanges'));
      if (!confirmed) return;
    }
    await loadSampleData(filename);
    setShowSampleMenu(false);
  }, [isDirty, loadSampleData, t]);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Toolbar */}
      <div className="toolbar">
        <span className="text-body font-semibold" style={{ marginRight: 'var(--space-3)' }}>
          {dataset ? dataset.name : 'No Data'}
          {isDirty && <span style={{ color: 'var(--color-warning)', marginLeft: 'var(--space-1)' }}>*</span>}
        </span>

        <button onClick={handleNewDataset} className="toolbar-btn">
          {t('menu.new')}
        </button>
        <button onClick={handleImportCSV} className="toolbar-btn">
          {t('menu.importCSV')}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowSampleMenu(!showSampleMenu); }}
            className="toolbar-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            {t('menu.sampleData')}
            <span style={{ fontSize: 'var(--font-size-xs)' }}>▼</span>
          </button>
          {showSampleMenu && (
            <div className="dropdown" style={{ minWidth: '300px', maxHeight: '400px', overflowY: 'auto' }}>
              {SAMPLE_DATASETS.map((sample) => (
                <button
                  key={sample.file}
                  onClick={() => handleLoadSampleData(sample.file)}
                  className="dropdown-item"
                >
                  <div style={{ fontWeight: 'var(--font-weight-medium)' }}>
                    {t(`sampleData.${sample.key}`)}
                  </div>
                  <div className="dropdown-item-hint">
                    {t('sampleData.recommended')}: {sample.analysis}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-divider" />

        <button onClick={handleExportCSV} disabled={!dataset} className="toolbar-btn">
          {t('menu.exportCSV')}
        </button>
        <button onClick={handleExportSAV} disabled={!dataset} className="toolbar-btn">
          {t('menu.exportExcel')}
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          onClick={() => setActiveTab('data')}
          className={`tab ${activeTab === 'data' ? 'active' : ''}`}
        >
          {t('dataEditor.dataView')}
        </button>
        <button
          onClick={() => setActiveTab('variable')}
          className={`tab ${activeTab === 'variable' ? 'active' : ''}`}
        >
          {t('dataEditor.variableView')}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'data' ? <DataView /> : <VariableView />}
      </div>

      {/* Status bar */}
      <div className="status-bar">
        {dataset ? (
          <>
            <span>{dataset.variables.length} {t('dataEditor.variables')}</span>
            <span className="status-bar-divider">|</span>
            <span>{dataset.data.length} {t('dataEditor.cases')}</span>
            {dataset.metadata.source && (
              <>
                <span className="status-bar-divider">|</span>
                <span>{t('dataEditor.source')}: {dataset.metadata.source}</span>
              </>
            )}
            <span className="status-bar-divider">|</span>
            <span>{t('dataEditor.modified')}: {dataset.metadata.modifiedAt.toLocaleTimeString()}</span>
          </>
        ) : (
          <span>{t('dataEditor.noData')}</span>
        )}
      </div>
    </div>
  );
}
