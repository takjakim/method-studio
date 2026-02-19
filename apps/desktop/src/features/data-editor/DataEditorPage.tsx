import { useTranslation } from 'react-i18next';
import { DataEditor } from '../../components/data-editor';

export default function DataEditorPage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col overflow-hidden" aria-label={t('dataEditor.title')}>
      <DataEditor />
    </div>
  );
}
