'use client'

import { useEffect, useState } from 'react'

type Props = { message: string; busy?: boolean; className?: string }

export default function ActionStatus({ message, busy = false, className = 'import-status' }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(Boolean(message))
    if (!message || busy) return
    const timer = window.setTimeout(() => setVisible(false), 10000)
    return () => window.clearTimeout(timer)
  }, [message, busy])

  return <>
    {message ? <p className={className}>{message}</p> : null}
    <div className={`admin-action-feedback ${className.includes('import-inline-status') ? 'line-feedback' : ''}`} data-status={className.includes('error') ? 'error' : className.includes('success') ? 'success' : 'info'} role="status" aria-live="polite" aria-atomic="true" hidden={!visible}>
      {message}
    </div>
  </>
}
