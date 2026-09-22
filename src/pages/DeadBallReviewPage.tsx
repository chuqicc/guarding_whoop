import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnnotationDocument } from '../utils/annotationDocument'
import { compareDeadSpans } from '../utils/deadSpans'
import { compareDefenseSpans } from '../utils/defenseSpans'
import { isEditableTarget } from '../utils/isEditableTarget'
import type { LoadedTracking } from '../components/TrackingDropZone'
import { fmtClock } from '../utils/timelineScale'
import { useResizable } from '../hooks/useResizable'
import ResizeHandle from '../components/ResizeHandle'
import CourtCanvas from '../components/CourtCanvas'
import VideoPanel from '../components/VideoPanel'
import DeadBallStrip from '../components/DeadBallStrip'
import DefenseTeamStrip from '../components/DefenseTeamStrip'

/**
 * Step through disagreements with the court and video in view.
 *
 * Everything here comes from the compare flow, which parsed the tracking file
 * itself. Nothing touches the annotation store — not the frames, not the
 * playhead, not the video — so an annotator can have a quarter open in the
 * other tab of their workflow and be entirely unaffected.
 *
 * Video is positioned by hand. There is no video-to-tracking sync anywhere in
 * this codebase (the README used to claim otherwise), so the game clock is
 * shown large: broadcast footage has a clock on screen, and that is the only
 * practical way to find the same moment by hand.
 */

type ReviewMode = 'dead' | 'defense'

/** Both kinds of disagreement reduce to this, so one stepper serves both. */
interface ReviewRegion {
  startBucket: number
  endBucket: number
  durationS: number
  frameStart?: number
  saidA: string
  saidB: string
}

interface Props {
  docA: AnnotationDocument | null
  docB: AnnotationDocument | null
  tracking: LoadedTracking | null
  videoUrl: string | null
  setVideoFile: (f: File | null) => void
  onBack: () => void
}

export default function DeadBallReviewPage({
  docA, docB, tracking, videoUrl, setVideoFile, onBack,
}: Props) {
  const frames = tracking?.frames ?? []
  const quarterMeta = tracking?.quarterMeta ?? null

  // The playhead is local: moving it must not disturb the annotate session.
  const [currentFrame, setCurrentFrame] = useState(0)
  const [index, setIndex] = useState(0)
  const [chosenMode, setChosenMode] = useState<ReviewMode | null>(null)

  const videoW = useResizable({ axis: 'x', initial: 360, min: 200, max: 900 })
  const mediaH = useResizable({ axis: 'y', initial: 300, min: 180, max: 700 })

  const dead = useMemo(
    () => (docA && docB ? compareDeadSpans(docA, docB) : null),
    [docA, docB],
  )
  const defense = useMemo(
    () => (docA && docB ? compareDefenseSpans(docA, docB) : null),
    [docA, docB],
  )

  const nameA = docA?.annotator || 'A'
  const nameB = docB?.annotator || 'B'

  const counts = {
    dead: dead?.disagreements.length ?? 0,
    defense: defense?.disagreements.length ?? 0,
  }

  // Open on the most damaging kind that actually has something to review —
  // landing on an empty list is a dead end, however severe that kind is.
  const mode: ReviewMode = chosenMode ?? (counts.defense > 0 ? 'defense' : 'dead')

  // Both kinds of disagreement reduce to "a stretch of clock, and what each
  // annotator said there", so one stepper serves both.
  const regions: ReviewRegion[] = useMemo(() => {
    if (mode === 'dead') {
      return (dead?.disagreements ?? []).map(d => ({
        startBucket: d.startBucket,
        endBucket: d.endBucket,
        durationS: d.durationS,
        frameStart: d.frameStart,
        saidA: d.deadSide === 'a' ? 'dead' : 'live',
        saidB: d.deadSide === 'a' ? 'live' : 'dead',
      }))
    }
    return (defense?.disagreements ?? []).map(d => ({
      startBucket: d.startBucket,
      endBucket: d.endBucket,
      durationS: d.durationS,
      frameStart: d.frameStart,
      saidA: d.teamA,
      saidB: d.teamB,
    }))
  }, [mode, dead, defense])



  // Borrowed tracking data is only trustworthy if it is the same quarter.
  const trackingMismatch = useMemo(() => {
    if (!docA || !quarterMeta) return null
    if (quarterMeta.gameId !== docA.gameId || quarterMeta.quarter !== docA.quarter) {
      return `Loaded tracking data is ${quarterMeta.gameId} Q${quarterMeta.quarter}, ` +
             `but these annotations are ${docA.gameId} Q${docA.quarter}`
    }
    return null
  }, [docA, quarterMeta])

  const trackingUsable = frames.length > 0 && !trackingMismatch
  const current = regions[index] ?? null

  const goTo = useCallback((i: number) => {
    if (regions.length === 0) return
    const next = (i + regions.length) % regions.length
    setIndex(next)
    const frame = regions[next].frameStart
    if (frame !== undefined && trackingUsable) setCurrentFrame(frame)
  }, [regions, trackingUsable, setCurrentFrame])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.key === 'n') { e.preventDefault(); goTo(index + 1) }
      if (e.key === 'p') { e.preventDefault(); goTo(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, index])

  const clockNow = frames[currentFrame]?.quarterClock

  if (!docA || !docB) {
    return (
      <Shell onBack={onBack} title="Disagreement review">
        <div style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>
          Load two annotators' files on the compare page first, then come back here.
        </div>
      </Shell>
    )
  }

  return (
    <Shell
      onBack={onBack}
      title="Disagreement review"
      subtitle={`${nameA} vs ${nameB} · ${docA.gameId} Q${docA.quarter} · ${regions.length} disagreement(s)`}
    >
      {trackingMismatch && (
        <Banner tone="var(--accent-danger)">
          ⚠ {trackingMismatch}. The court below is showing a different quarter — do not
          read anything into it. Go back and load the matching tracking file.
        </Banner>
      )}
      {!trackingMismatch && frames.length === 0 && (
        <Banner tone="var(--confidence-mid, #b8860b)">
          ⚠ No tracking data loaded. Go back and drop the quarter tracking JSON on the
          compare page — the court and clock stay empty until then.
        </Banner>
      )}

      {/* Video and court side by side, both resizable */}
      <div style={{ display: 'flex', height: mediaH.size, flexShrink: 0 }}>
        <div style={{ width: videoW.size, flexShrink: 0, overflow: 'hidden' }}>
          <VideoPanel src={videoUrl} onPickFile={setVideoFile} />
        </div>
        <ResizeHandle resizable={videoW} label="Resize the video panel" />
        <div style={{
          flex: 1, minWidth: 0, overflow: 'hidden',
          opacity: trackingUsable ? 1 : 0.35,
        }}>
          <CourtCanvas
            readOnly
            frames={frames}
            currentFrame={currentFrame}
            playerDict={tracking?.playerDict ?? {}}
            quarterMeta={quarterMeta}
          />
        </div>
      </div>
      <ResizeHandle resizable={mediaH} label="Resize the video and court row" />

      {/* The clock is the anchor for finding this moment in the video by hand */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 16, justifyContent: 'center',
        padding: '10px 12px',
      }}>
        <span style={{ fontSize: 34, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
          {clockNow !== undefined ? `Q${docA.quarter}  ${fmtClock(clockNow)}` : '—'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
          frame {currentFrame}
          {' · '}scrub the video to this clock reading
        </span>
      </div>

      {/* Which kind of disagreement to walk through */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12,
      }}>
        {([
          ['defense', 'Defending team', counts.defense],
          ['dead', 'Dead ball', counts.dead],
        ] as const).map(([m, label, n]) => (
          <button
            key={m}
            onClick={() => { setChosenMode(m); setIndex(0) }}
            aria-pressed={mode === m}
            style={{
              ...btn(),
              background: mode === m ? 'var(--bg-col-active)' : 'var(--bg-surface)',
              borderColor: mode === m ? 'var(--accent)' : 'var(--border)',
            }}
          >
            {label} ({n})
          </button>
        ))}
        <span style={{ marginLeft: 8, color: 'var(--text-4)', fontSize: 11 }}>
          Defending-team errors mis-orient a whole possession, so review those first.
        </span>
      </div>

      {/* Region stepper */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 12,
      }}>
        <button onClick={() => goTo(index - 1)} disabled={regions.length === 0} style={btn()}>← p</button>
        <button onClick={() => goTo(index + 1)} disabled={regions.length === 0} style={btn()}>n →</button>

        {regions.length === 0 ? (
          <span style={{ color: 'var(--text-3)' }}>
            No {mode === 'dead' ? 'dead-ball' : 'defending-team'} disagreements — {nameA} and{' '}
            {nameB} agree throughout.
          </span>
        ) : current && (
          <>
            <span style={{ color: 'var(--text-3)' }}>
              {index + 1} / {regions.length}
            </span>
            <span style={{ color: 'var(--text-1)' }}>
              <strong>{nameA}</strong>: {current.saidA}
              {'  ·  '}
              <strong>{nameB}</strong>: {current.saidB}
            </span>
            <span style={{ color: 'var(--text-3)' }}>
              {fmtClock(current.startBucket)} → {fmtClock(current.endBucket)}
              {' · '}{current.durationS.toFixed(1)}s
            </span>
          </>
        )}
      </div>

      <DefenseTeamStrip
        docA={docA} docB={docB}
        onJumpToFrame={f => { if (trackingUsable) setCurrentFrame(f) }}
      />
      <DeadBallStrip
        docA={docA} docB={docB}
        onJumpToFrame={f => { if (trackingUsable) setCurrentFrame(f) }}
      />
    </Shell>
  )
}

function Shell({ onBack, title, subtitle, children }: {
  onBack: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-page)', color: 'var(--text-1)', overflow: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
      }}>
        <button onClick={onBack} style={btn()}>← Back to compare</button>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {subtitle && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function Banner({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div role="alert" style={{
      margin: '10px 12px', padding: '8px 12px', borderRadius: 5,
      background: 'var(--bg-panel)', borderLeft: `3px solid ${tone}`,
      fontSize: 12, color: 'var(--text-2)',
    }}>
      {children}
    </div>
  )
}

const btn = (): React.CSSProperties => ({
  background: 'var(--bg-surface)', color: 'var(--text-1)',
  border: '1px solid var(--border)', borderRadius: 4,
  padding: '3px 10px', fontSize: 12, cursor: 'pointer',
})
