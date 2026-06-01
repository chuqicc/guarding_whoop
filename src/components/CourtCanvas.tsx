import React, { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Circle, Text, Arrow } from 'react-konva'
import { useStore } from '../store/useStore'
import { COURT_W, COURT_H, COLOR_TEAM_A, COLOR_TEAM_B, COLOR_BALL } from '../constants'
import courtPng from '../assets/court.png'

const COURT_ASPECT = COURT_W / COURT_H   // 94 / 50 = 1.88

function fitStage(containerW: number, containerH: number) {
  if (containerW / containerH > COURT_ASPECT) {
    const h = containerH
    const w = h * COURT_ASPECT
    return { w, h, offsetX: (containerW - w) / 2, offsetY: 0 }
  } else {
    const w = containerW
    const h = w / COURT_ASPECT
    return { w, h, offsetX: 0, offsetY: (containerH - h) / 2 }
  }
}

// Map court feet → stage pixels.
// flipX: mirror left↔right  (new_x = COURT_W - x)
// flipY: mirror top↔bottom  (inverts the existing y-flip, so y=0 appears at top)
function toCanvas(courtX: number, courtY: number, stageW: number, stageH: number, flipX: boolean, flipY: boolean) {
  const x = flipX ? COURT_W - courtX : courtX
  // Normal canvas y: cy = (1 - courtY/H) * stageH  (court y=0 → bottom of canvas)
  // FlipY canvas y:  cy = (courtY/H) * stageH       (court y=0 → top of canvas)
  const cy = flipY
    ? (courtY / COURT_H) * stageH
    : (1 - courtY / COURT_H) * stageH
  return { cx: (x / COURT_W) * stageW, cy }
}

function scaleFt(feet: number, stageW: number) {
  return (feet / COURT_W) * stageW
}

export default function CourtCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 600, h: 288 })
  const [courtImg, setCourtImg] = useState<HTMLImageElement | null>(null)

  const frames          = useStore(s => s.frames)
  const currentFrame    = useStore(s => s.currentFrame)
  const cellAnnotations = useStore(s => s.cellAnnotations)
  const playerDict      = useStore(s => s.playerDict)
  const flipX           = useStore(s => s.flipX)
  const flipY           = useStore(s => s.flipY)
  const toggleFlipX     = useStore(s => s.toggleFlipX)
  const toggleFlipY     = useStore(s => s.toggleFlipY)

  useEffect(() => {
    const img = new window.Image()
    img.src = courtPng
    img.onload = () => setCourtImg(img)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setContainerSize({ w: r.width, h: r.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const { w: stageW, h: stageH, offsetX, offsetY } = fitStage(containerSize.w, containerSize.h)

  const frame = frames[currentFrame]
  const currentBucket = frame?.shotClock !== null && frame?.shotClock !== undefined && !isNaN(frame.shotClock)
    ? Math.floor(frame.shotClock)
    : null

  const activePairs = currentBucket !== null
    ? cellAnnotations.filter(c => c.shotClockBucket === currentBucket)
    : []

  const playerPos: Record<number, { cx: number; cy: number }> = {}
  if (frame) {
    for (const p of frame.players) {
      playerPos[p.id] = toCanvas(p.x, p.y, stageW, stageH, flipX, flipY)
    }
  }

  const playerR = scaleFt(1.2, stageW)

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, height: '100%', overflow: 'hidden', position: 'relative', background: 'var(--bg-cell)' }}
    >
      {/* Flip buttons — top-right corner, inside the court stage area */}
      <div style={{
        position: 'absolute',
        top: offsetY + 5,
        right: containerSize.w - offsetX - stageW + 5,
        zIndex: 20,
        display: 'flex', gap: 3,
      }}>
        <button
          onClick={toggleFlipX}
          title={flipX ? 'Undo left↔right flip' : 'Flip left↔right'}
          style={flipBtnStyle(flipX)}
        >
          ⇆
        </button>
        <button
          onClick={toggleFlipY}
          title={flipY ? 'Undo top↔bottom flip' : 'Flip top↔bottom'}
          style={flipBtnStyle(flipY)}
        >
          ⇅
        </button>
      </div>

      {/* Konva stage centered in container */}
      <div style={{ position: 'absolute', left: offsetX, top: offsetY }}>
        <Stage width={stageW} height={stageH}>

          {/* Layer 1: court image — mirrored when flipped */}
          <Layer listening={false}>
            {courtImg && (
              <KonvaImage
                image={courtImg}
                // Anchor shifts to the opposite edge before scaling, so the image mirrors in place
                x={flipX ? stageW : 0}
                y={flipY ? stageH : 0}
                width={stageW}
                height={stageH}
                scaleX={flipX ? -1 : 1}
                scaleY={flipY ? -1 : 1}
              />
            )}
          </Layer>

          {/* Layer 2: players + ball + arrows */}
          <Layer listening={false}>
            {frame && frame.players.map((p, idx) => {
              const { cx, cy } = toCanvas(p.x, p.y, stageW, stageH, flipX, flipY)
              const isTeamA = idx < 5
              const color = isTeamA ? COLOR_TEAM_A : COLOR_TEAM_B
              const jersey = playerDict[p.id]?.jersey ?? String(p.id)

              return (
                <React.Fragment key={p.id}>
                  <Circle x={cx} y={cy} radius={playerR} fill={color} />
                  <Text
                    x={cx - playerR} y={cy - playerR * 0.55}
                    width={playerR * 2}
                    text={jersey}
                    fontSize={Math.max(8, playerR * 0.9)}
                    fill="white"
                    align="center"
                  />
                </React.Fragment>
              )
            })}

            {/* Ball */}
            {frame && (() => {
              const { cx, cy } = toCanvas(frame.ballX, frame.ballY, stageW, stageH, flipX, flipY)
              const ballZ = isNaN(frame.ballZ) ? 0 : frame.ballZ
              const r = Math.max(
                scaleFt(0.5, stageW),
                Math.min(scaleFt(1.0, stageW), scaleFt(0.5 + ballZ * 0.05, stageW))
              )
              return (
                <>
                  <Circle x={cx} y={cy} radius={r} fill={COLOR_BALL} />
                  <Circle x={cx - r * 0.3} y={cy - r * 0.3} radius={r * 0.25} fill="rgba(255,255,255,0.5)" />
                </>
              )
            })()}

            {/* Defense pair arrows */}
            {activePairs.map(pair => {
              const defPos = playerPos[pair.defenderId]
              if (!defPos) return null

              if (pair.attackerId === 'GUARD_NONE') {
                return (
                  <Text
                    key={pair.id}
                    x={defPos.cx - 10} y={defPos.cy - playerR - 14}
                    text="∅" fontSize={14} fill="#aaa"
                  />
                )
              }

              const attPos = playerPos[pair.attackerId as number]
              if (!attPos) return null

              return (
                <Arrow
                  key={pair.id}
                  points={[defPos.cx, defPos.cy, attPos.cx, attPos.cy]}
                  stroke="#4a90d9"
                  strokeWidth={Math.max(1, scaleFt(0.3, stageW))}
                  dash={[6, 4]}
                  fill="#4a90d9"
                  pointerLength={8}
                  pointerWidth={8}
                />
              )
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}

function flipBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#c8860a' : 'var(--bg-panel)',
    color: active ? '#fff' : 'var(--text-3)',
    border: `1px solid ${active ? '#c8860a' : 'var(--border)'}`,
    borderRadius: 4, padding: '2px 6px',
    cursor: 'pointer', fontSize: 14, lineHeight: '1',
    userSelect: 'none',
  }
}
