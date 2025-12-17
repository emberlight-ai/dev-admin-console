"use client"

import * as React from "react"

export interface GlareHoverProps {
  width?: string
  height?: string
  background?: string
  borderRadius?: string
  borderColor?: string
  children?: React.ReactNode
  glareColor?: string
  glareOpacity?: number
  glareAngle?: number
  glareSize?: number
  transitionDuration?: number
  playOnce?: boolean
  triggerKey?: unknown
  triggerOnHover?: boolean
  className?: string
  style?: React.CSSProperties
}

export default function GlareHover({
  width = "500px",
  height = "500px",
  background = "transparent",
  borderRadius = "10px",
  borderColor = "transparent",
  children,
  glareColor = "#ffffff",
  glareOpacity = 0.5,
  glareAngle = -45,
  glareSize = 320,
  transitionDuration = 800,
  playOnce = false,
  triggerKey,
  triggerOnHover = true,
  className = "",
  style = {},
}: GlareHoverProps) {
  const hex = glareColor.replace("#", "")
  let rgba = glareColor
  if (/^[\dA-Fa-f]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    rgba = `rgba(${r}, ${g}, ${b}, ${glareOpacity})`
  } else if (/^[\dA-Fa-f]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    rgba = `rgba(${r}, ${g}, ${b}, ${glareOpacity})`
  }

  const overlayRef = React.useRef<HTMLDivElement | null>(null)
  const timeoutRef = React.useRef<number | null>(null)
  const lastTriggerKeyRef = React.useRef<unknown>(undefined)
  const didMountRef = React.useRef(false)

  const animateIn = React.useCallback(() => {
    const el = overlayRef.current
    if (!el) return

    el.style.transition = "none"
    el.style.backgroundPosition = "-100% -100%, 0 0"
    el.style.transition = `${transitionDuration}ms ease`
    el.style.backgroundPosition = "100% 100%, 0 0"
  }, [transitionDuration])

  const animateOut = React.useCallback(() => {
    const el = overlayRef.current
    if (!el) return

    if (playOnce) {
      el.style.transition = "none"
      el.style.backgroundPosition = "-100% -100%, 0 0"
    } else {
      el.style.transition = `${transitionDuration}ms ease`
      el.style.backgroundPosition = "-100% -100%, 0 0"
    }
  }, [playOnce, transitionDuration])

  // Programmatic pulse: whenever `triggerKey` changes, play the glare once.
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      lastTriggerKeyRef.current = triggerKey
      return
    }

    if (triggerKey === undefined) return
    if (Object.is(triggerKey, lastTriggerKeyRef.current)) return
    lastTriggerKeyRef.current = triggerKey

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    animateIn()
    timeoutRef.current = window.setTimeout(() => {
      animateOut()
      timeoutRef.current = null
    }, transitionDuration + 30)
  }, [animateIn, animateOut, transitionDuration, triggerKey])

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    // A brighter, wider "specular" streak for a more reflective feel
    background: `linear-gradient(${glareAngle}deg,
        hsla(0,0%,0%,0) 45%,
        ${rgba} 58%,
        rgba(255,255,255,${Math.min(1, glareOpacity + 0.25)}) 62%,
        ${rgba} 68%,
        hsla(0,0%,0%,0) 78%)`,
    backgroundSize: `${glareSize}% ${glareSize}%, 100% 100%`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "-100% -100%, 0 0",
    pointerEvents: "none",
    mixBlendMode: "screen",
    filter: "blur(0.6px)",
  }

  return (
    <div
      className={`relative overflow-hidden border ${triggerOnHover ? "cursor-pointer" : ""} ${className}`}
      style={{
        width,
        height,
        background,
        borderRadius,
        borderColor,
        ...style,
      }}
      onMouseEnter={triggerOnHover ? animateIn : undefined}
      onMouseLeave={triggerOnHover ? animateOut : undefined}
    >
      <div ref={overlayRef} style={overlayStyle} />
      {children}
    </div>
  )
}


