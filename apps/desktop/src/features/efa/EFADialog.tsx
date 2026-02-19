import { useState } from 'react';
import { efaSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EFADialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

// ---------------------------------------------------------------------------
// EFADialog
// ---------------------------------------------------------------------------

export function EFADialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: EFADialogProps) {
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={efaSpec}
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

export function useEFADialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
