import { useState } from 'react';
import { correlationSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CorrelationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function CorrelationDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: CorrelationDialogProps) {
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={correlationSpec}
      datasetName={datasetName}
      availableVariables={availableVariables}
      isOpen={isOpen}
      onClose={onClose}
      onRun={onRun}
      isRunning={isRunning}
    />
  );
}

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useCorrelationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
