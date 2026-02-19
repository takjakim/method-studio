import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DescriptivesDialog } from '../descriptives/DescriptivesDialog';
import { TTestDialog } from '../ttest/TTestDialog';
import { ANOVADialog } from '../anova/ANOVADialog';
import { CorrelationDialog } from '../correlation/CorrelationDialog';
import { EFADialog } from '../efa/EFADialog';
import { RegressionDialog } from '../regression/RegressionDialog';
import { MediationDialog } from '../mediation/MediationDialog';
import { ModerationDialog } from '../moderation/ModerationDialog';
import { CFADialog } from '../cfa/CFADialog';
import { PathAnalysisDialog } from '../path-analysis/PathAnalysisDialog';
import { ModeratedMediationDialog } from '../moderated-mediation/ModeratedMediationDialog';
import { SerialMediationDialog } from '../serial-mediation/SerialMediationDialog';
import { MultigroupCFADialog } from '../multigroup-cfa/MultigroupCFADialog';
import { FullSEMDialog } from '../full-sem/FullSEMDialog';
import { MultilevelDialog } from '../multilevel/MultilevelDialog';
import { useDataStore } from '../../stores/data-store';
import { useAnalysisEngine } from '../../hooks';
import { AnalysisResultViewer } from '../../components/output';
import type { AnalysisRequest } from '@method-studio/analysis-specs';

type AnalysisType =
  | 'descriptives' | 'ttest' | 'anova' | 'correlation' | 'efa' | 'regression'
  | 'mediation' | 'moderation' | 'moderated-mediation' | 'serial-mediation'
  | 'cfa' | 'path-analysis' | 'multigroup-cfa' | 'full-sem' | 'multilevel'
  | null;

function useAnalysisCategories() {
  const { t } = useTranslation();
  return useMemo(() => [
    {
      name: t('categories.descriptiveStatistics'),
      items: [
        { id: 'descriptives', label: t('analyses.descriptives.name'), description: t('analyses.descriptives.description') },
      ],
    },
    {
      name: t('categories.compareMeans'),
      items: [
        { id: 'ttest', label: t('analyses.ttest.name'), description: t('analyses.ttest.description') },
        { id: 'anova', label: t('analyses.anova.name'), description: t('analyses.anova.description') },
      ],
    },
    {
      name: t('categories.correlation'),
      items: [
        { id: 'correlation', label: t('analyses.correlation.name'), description: t('analyses.correlation.description') },
      ],
    },
    {
      name: t('categories.factorAnalysis'),
      items: [
        { id: 'efa', label: t('analyses.efa.name'), description: t('analyses.efa.description') },
      ],
    },
    {
      name: t('categories.regression'),
      items: [
        { id: 'regression', label: t('analyses.regression.name'), description: t('analyses.regression.description') },
      ],
    },
    {
      name: t('categories.processModels'),
      items: [
        { id: 'mediation', label: t('analyses.mediation.name'), description: t('analyses.mediation.description') },
        { id: 'moderation', label: t('analyses.moderation.name'), description: t('analyses.moderation.description') },
        { id: 'moderated-mediation', label: t('analyses.moderatedMediation.name'), description: t('analyses.moderatedMediation.description') },
        { id: 'serial-mediation', label: t('analyses.serialMediation.name'), description: t('analyses.serialMediation.description') },
      ],
    },
    {
      name: t('categories.sem'),
      items: [
        { id: 'cfa', label: t('analyses.cfa.name'), description: t('analyses.cfa.description') },
        { id: 'path-analysis', label: t('analyses.pathAnalysis.name'), description: t('analyses.pathAnalysis.description') },
        { id: 'multigroup-cfa', label: t('analyses.multigroupCFA.name'), description: t('analyses.multigroupCFA.description') },
        { id: 'full-sem', label: t('analyses.fullSEM.name'), description: t('analyses.fullSEM.description') },
      ],
    },
    {
      name: t('categories.multilevel'),
      items: [
        { id: 'multilevel', label: t('analyses.multilevel.name'), description: t('analyses.multilevel.description') },
      ],
    },
  ], [t]);
}

export default function AnalysisPage() {
  const { t } = useTranslation();
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisType>(null);
  const dataset = useDataStore((state) => state.dataset);
  const { runAnalysis, isLoading, error, result } = useAnalysisEngine();
  const analysisCategories = useAnalysisCategories();

  const hasData = dataset && dataset.data.length > 0;

  const handleRunAnalysis = useCallback(async (request: AnalysisRequest) => {
    // Dialog stays open - user can close manually or run again with different settings
    await runAnalysis(request);
  }, [runAnalysis]);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <h1 className="text-title">{t('analysis.title')}</h1>
        <p className="text-caption" style={{ marginTop: 'var(--space-1)' }}>
          {hasData
            ? `${t('analysis.datasetLoaded')}: ${dataset.variables.length} ${t('dataEditor.variables')}, ${dataset.data.length} ${t('dataEditor.cases')}`
            : t('analysis.loadDataHint')}
        </p>
      </div>

      {/* Content */}
      <div className="page-content">
        {!hasData ? (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px' }}>
            <div style={{ textAlign: 'center' }}>
              <p className="text-body-secondary" style={{ marginBottom: 'var(--space-2)' }}>{t('analysis.noData')}</p>
              <p className="text-caption">{t('analysis.loadDataHint')}</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {analysisCategories.map((category) => (
              <div key={category.name}>
                <h2 className="text-label" style={{ marginBottom: 'var(--space-3)' }}>
                  {category.name}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
                  {category.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveAnalysis(item.id as AnalysisType)}
                      className="card"
                      style={{
                        padding: 'var(--space-4)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                        e.currentTarget.style.borderColor = 'var(--color-border)';
                      }}
                    >
                      <div className="text-body" style={{ fontWeight: 'var(--font-weight-medium)' }}>{item.label}</div>
                      <div className="text-caption" style={{ marginTop: 'var(--space-1)' }}>{item.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {(isLoading || result || error) && (
              <div className="card" style={{ padding: 'var(--space-4)' }}>
                <AnalysisResultViewer result={result} isLoading={isLoading} error={error} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Analysis Dialogs */}
      {activeAnalysis === 'descriptives' && dataset && (
        <DescriptivesDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'ttest' && dataset && (
        <TTestDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'anova' && dataset && (
        <ANOVADialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'correlation' && dataset && (
        <CorrelationDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'efa' && dataset && (
        <EFADialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'regression' && dataset && (
        <RegressionDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'mediation' && dataset && (
        <MediationDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'moderation' && dataset && (
        <ModerationDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'cfa' && dataset && (
        <CFADialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'path-analysis' && dataset && (
        <PathAnalysisDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'moderated-mediation' && dataset && (
        <ModeratedMediationDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'serial-mediation' && dataset && (
        <SerialMediationDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'multigroup-cfa' && dataset && (
        <MultigroupCFADialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'full-sem' && dataset && (
        <FullSEMDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
      {activeAnalysis === 'multilevel' && dataset && (
        <MultilevelDialog
          isOpen={true}
          onClose={() => setActiveAnalysis(null)}
          onRun={handleRunAnalysis}
          variables={dataset.variables}
          datasetName={dataset.name}
          isRunning={isLoading}
        />
      )}
    </div>
  );
}
