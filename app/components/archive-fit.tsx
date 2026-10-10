'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function ArchiveFit({ width, children }: { width: number; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const resize = () => setScale(Math.max(0.8, Math.min(1, element.clientWidth / width)))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [width])
  return <div ref={container} style={{ width: '100%', overflowX: 'auto' }}><div style={{ width, zoom: scale }}>{children}</div></div>
}
