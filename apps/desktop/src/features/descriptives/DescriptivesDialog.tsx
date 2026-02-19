import { useState } from 'react';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';
import { descriptivesSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';

interface DescriptivesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

/**
 * Descriptive Statistics dialog.
 * Uses JamoviStyleDialog with drag-and-drop support.
 */
export function DescriptivesDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: DescriptivesDialogProps) {
  // Map dataset Variable type to the simplified format JamoviStyleDialog expects
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={descriptivesSpec}
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
export function useDescriptivesDialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
