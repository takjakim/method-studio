import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface EngineInstallStatus {
  r_installed: boolean
  r_version: string | null
  python_installed: boolean
  python_version: string | null
  homebrew_installed: boolean
  winget_available: boolean
}

type InstallState = 'idle' | 'installing' | 'success' | 'error'

interface InstallProgress {
  r: InstallState
  python: InstallState
  homebrew: InstallState
}

interface EngineSetupDialogProps {
  onDismiss?: () => void
}

export function EngineSetupDialog({ onDismiss }: EngineSetupDialogProps) {
  const [status, setStatus] = useState<EngineInstallStatus | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [progress, setProgress] = useState<InstallProgress>({ r: 'idle', python: 'idle', homebrew: 'idle' })
  const [errorMessages, setErrorMessages] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState(true)

  const checkStatus = useCallback(async () => {
    setChecking(true)
    try {
      const result = await invoke<EngineInstallStatus>('check_install_status')
      setStatus(result)
      const needsSetup = !result.r_installed || !result.python_installed
      setIsOpen(needsSetup)
    } catch (err) {
      console.error('Failed to check install status:', err)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const handleInstallHomebrew = async () => {
    setProgress(p => ({ ...p, homebrew: 'installing' }))
    setErrorMessages(e => ({ ...e, homebrew: '' }))
    try {
      await invoke<string>('install_homebrew')
      setProgress(p => ({ ...p, homebrew: 'success' }))
      await checkStatus()
    } catch (err) {
      setProgress(p => ({ ...p, homebrew: 'error' }))
      setErrorMessages(e => ({ ...e, homebrew: String(err) }))
    }
  }

  const handleInstallR = async () => {
    setProgress(p => ({ ...p, r: 'installing' }))
    setErrorMessages(e => ({ ...e, r: '' }))
    try {
      await invoke<string>('install_r')
      setProgress(p => ({ ...p, r: 'success' }))
      await checkStatus()
    } catch (err) {
      setProgress(p => ({ ...p, r: 'error' }))
      setErrorMessages(e => ({ ...e, r: String(err) }))
    }
  }

  const handleInstallPython = async () => {
    setProgress(p => ({ ...p, python: 'installing' }))
    setErrorMessages(e => ({ ...e, python: '' }))
    try {
      await invoke<string>('install_python')
      setProgress(p => ({ ...p, python: 'success' }))
      await checkStatus()
    } catch (err) {
      setProgress(p => ({ ...p, python: 'error' }))
      setErrorMessages(e => ({ ...e, python: String(err) }))
    }
  }

  const handleDismiss = () => {
    setIsOpen(false)
    onDismiss?.()
  }

  const allInstalled = status?.r_installed && status?.python_installed

  if (checking || !isOpen) return null

  const isMac = status?.homebrew_installed !== undefined && !status?.winget_available
  const needsHomebrew = isMac && !status?.homebrew_installed
  const canInstall = isMac ? status?.homebrew_installed : status?.winget_available

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '32px',
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--font-size-xl)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text)',
            }}
          >
            Engine Setup Required
          </h2>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Method Studio requires R and Python to run statistical analyses. One or more engines were not found on your system.
          </p>
        </div>

        {/* Status items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          <StatusRow
            label="R"
            installed={status?.r_installed ?? false}
            version={status?.r_version}
            installState={progress.r}
            errorMessage={errorMessages.r}
            canInstall={!!canInstall && !status?.r_installed}
            onInstall={handleInstallR}
            manualUrl="https://cran.r-project.org/"
          />
          <StatusRow
            label="Python"
            installed={status?.python_installed ?? false}
            version={status?.python_version}
            installState={progress.python}
            errorMessage={errorMessages.python}
            canInstall={!!canInstall && !status?.python_installed}
            onInstall={handleInstallPython}
            manualUrl="https://www.python.org/downloads/"
          />
          {needsHomebrew && (
            <HomebrewRow
              installState={progress.homebrew}
              errorMessage={errorMessages.homebrew}
              onInstall={handleInstallHomebrew}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={checkStatus}
            disabled={checking}
            style={{
              padding: '6px 14px',
              fontSize: 'var(--font-size-sm)',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              color: 'var(--color-text-muted)',
              cursor: checking ? 'not-allowed' : 'pointer',
            }}
          >
            {checking ? 'Checking...' : 'Re-check'}
          </button>
          <button
            onClick={handleDismiss}
            style={{
              padding: '6px 18px',
              fontSize: 'var(--font-size-sm)',
              background: allInstalled ? 'var(--color-accent)' : 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              color: allInstalled ? 'white' : 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            {allInstalled ? 'Continue' : 'Skip for now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatusRowProps {
  label: string
  installed: boolean
  version: string | null | undefined
  installState: InstallState
  errorMessage?: string
  canInstall: boolean
  onInstall: () => void
  manualUrl: string
}

function StatusRow({
  label,
  installed,
  version,
  installState,
  errorMessage,
  canInstall,
  onInstall,
  manualUrl,
}: StatusRowProps) {
  const isInstalling = installState === 'installing'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '12px',
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
      }}
    >
      {/* Status icon */}
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: '1px',
          background: installed ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: 'white',
          fontWeight: 'bold',
        }}
      >
        {installed ? '✓' : '!'}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text)',
            }}
          >
            {label}
          </span>
          {installed && version && (
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {version}
            </span>
          )}
          {!installed && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Not found
            </span>
          )}
        </div>
        {errorMessage && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-error, #ef4444)',
              wordBreak: 'break-word',
            }}
          >
            {errorMessage}
          </p>
        )}
      </div>

      {/* Action */}
      {!installed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
          {canInstall && (
            <button
              onClick={onInstall}
              disabled={isInstalling}
              style={{
                padding: '4px 12px',
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: isInstalling ? 'not-allowed' : 'pointer',
                opacity: isInstalling ? 0.7 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {isInstalling ? 'Installing...' : `Install ${label}`}
            </button>
          )}
          <a
            href={manualUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-accent)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Install manually
          </a>
        </div>
      )}
    </div>
  )
}

interface HomebrewRowProps {
  installState: InstallState
  errorMessage?: string
  onInstall: () => void
}

function HomebrewRow({ installState, errorMessage, onInstall }: HomebrewRowProps) {
  const isInstalling = installState === 'installing'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '12px',
        background: 'var(--color-surface-raised)',
        border: '1px solid var(--color-border)',
        borderRadius: '6px',
      }}
    >
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: '1px',
          background: 'var(--color-warning, #f59e0b)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: 'white',
          fontWeight: 'bold',
        }}
      >
        !
      </div>
      <div style={{ flex: 1 }}>
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--color-text)',
          }}
        >
          Homebrew
        </span>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Required to install R and Python automatically on macOS.
        </p>
        {errorMessage && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-error, #ef4444)',
            }}
          >
            {errorMessage}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
        <button
          onClick={onInstall}
          disabled={isInstalling}
          style={{
            padding: '4px 12px',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: isInstalling ? 'not-allowed' : 'pointer',
            opacity: isInstalling ? 0.7 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {isInstalling ? 'Installing...' : 'Install Homebrew'}
        </button>
        <a
          href="https://brew.sh"
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-accent)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Install manually
        </a>
      </div>
    </div>
  )
}
