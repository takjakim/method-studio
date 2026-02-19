import { useState } from 'react';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';
import { fullSEMSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';

interface FullSEMDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

/**
 * Full Structural Equation Model dialog.
 * Uses JamoviStyleDialog with drag-and-drop support.
 */
export function FullSEMDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: FullSEMDialogProps) {
  // Map dataset Variable type to the simplified format JamoviStyleDialog expects
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={fullSEMSpec}
      datasetName={datasetName}
      availableVariables={availableVariables}
      isOpen={isOpen}
      onClose={onClose}
      onRun={onRun}
      isRunning={isRunning}
    />
  );
}

// Convenience hook for managing open state
export function useFullSEMDialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
