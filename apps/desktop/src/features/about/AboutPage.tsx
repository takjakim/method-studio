import { useTranslation } from 'react-i18next';

export default function AboutPage() {
  const { t } = useTranslation();

  const handleEmailClick = () => {
    window.open('mailto:takjakim.apple@gmail.com?subject=[Method Studio] Bug Report / Feedback');
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          {t('about.title')}
        </h1>
      </div>

      {/* Content */}
      <div className="max-w-2xl space-y-6">
        {/* App Info Card */}
        <div
          className="rounded-lg border p-6"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
          }}
        >
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                color: 'white',
              }}
            >
              M
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                Method Studio
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                v0.1.0 (Beta)
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('about.description')}
          </p>
        </div>

        {/* Developer Info Card */}
        <div
          className="rounded-lg border p-6"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('about.developer')}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-lg">👤</span>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  Kim, Jaehyun
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg">✉️</span>
              <button
                onClick={handleEmailClick}
                className="text-sm hover:underline"
                style={{ color: '#3b82f6' }}
              >
                takjakim.apple@gmail.com
              </button>
            </div>
          </div>
        </div>

        {/* Bug Report Card */}
        <div
          className="rounded-lg border p-6"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('about.bugReport')}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
            {t('about.bugReportDescription')}
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleEmailClick}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
              }}
            >
              {t('about.sendEmail')}
            </button>
          </div>
        </div>

        {/* Credits Card */}
        <div
          className="rounded-lg border p-6"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: 'var(--color-border)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('about.poweredBy')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {['Tauri', 'React', 'R', 'Python', 'lavaan', 'psych', 'lme4'].map((tech) => (
              <span
                key={tech}
                className="px-3 py-1 text-xs rounded-full"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* License */}
        <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          © 2026 Kim, Jaehyun. {t('about.license')}
        </p>
      </div>
    </div>
  );
}
