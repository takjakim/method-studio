import { useState } from 'react';
import { linearRegressionSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RegressionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

// ---------------------------------------------------------------------------
// RegressionDialog
// ---------------------------------------------------------------------------

export function RegressionDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: RegressionDialogProps) {
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={linearRegressionSpec}
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
// useRegressionDialog hook
// ---------------------------------------------------------------------------

export function useRegressionDialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
