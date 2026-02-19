import { useState } from 'react';
import { anovaOnewaySpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ANOVADialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

// ---------------------------------------------------------------------------
// ANOVADialog
// ---------------------------------------------------------------------------

export function ANOVADialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: ANOVADialogProps) {
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={anovaOnewaySpec}
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
// Convenience hook for managing open state
// ---------------------------------------------------------------------------

export function useANOVADialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
