import { useLanguageStore, type Language } from '../stores/language-store';

export function LanguageSelector() {
  const { language, setLanguage } = useLanguageStore();

  const handleChange = (lang: Language) => {
    setLanguage(lang);
  };

  return (
    <div
      style={{
        display: 'flex',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    >
      <button
        onClick={() => handleChange('en')}
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: language === 'en' ? 600 : 400,
          border: 'none',
          cursor: 'pointer',
          backgroundColor: language === 'en' ? 'var(--color-accent)' : 'var(--color-bg)',
          color: language === 'en' ? 'white' : 'var(--color-text-muted)',
          transition: 'all 0.15s ease',
        }}
      >
        EN
      </button>
      <button
        onClick={() => handleChange('ko')}
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: language === 'ko' ? 600 : 400,
          border: 'none',
          borderLeft: '1px solid var(--color-border)',
          cursor: 'pointer',
          backgroundColor: language === 'ko' ? 'var(--color-accent)' : 'var(--color-bg)',
          color: language === 'ko' ? 'white' : 'var(--color-text-muted)',
          transition: 'all 0.15s ease',
        }}
      >
        한
      </button>
    </div>
  );
}
