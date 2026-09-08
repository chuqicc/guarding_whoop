import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseAnnotationDocument, UnsupportedAnnotationFile, type AnnotationDocument } from '../utils/annotationDocument'
import { computeAgreement } from '../utils/agreement'
import { csvRow, download } from '../utils/export'
import { useStore } from '../store/useStore'
import { isEditableTarget } from '../utils/isEditableTarget'
import DiffGrid from '../components/DiffGrid'
import { buildDiffRuns, isReviewable, type DiffRun } from '../utils/diffRuns'
import type { AttackerId } from '../store/useStore'

type Side = 'a' | 'b'

export default function ComparePage({ onBack }: { onBack: () => void }) {
  const [docA, setDocA] = useState<AnnotationDocument | null>(null)
  const [docB, setDocB] = useState<AnnotationDocument | null>(null)
  const [errA, setErrA] = useState<string | null>(null)
  const [errB, setErrB] = useState<string | null>(null)
  const [selected, setSelected] = useState<DiffRun | null>(null)

  const setCurrentFrame = useStore(s => s.setCurrentFrame)
  const framesLoaded = useStore(s => s.frames.length > 0)

  const load = async (side: Side, file: File) => {
    const setDoc = side === 'a' ? setDocA : setDocB
    const setErr = side === 'a' ? setErrA : setErrB
    try {
      const doc = parseAnnotationDocument(await file.text(), file.name)
      setDoc(doc)
      setErr(null)
    } catch (e) {
      setDoc(null)
      setErr(e instanceof UnsupportedAnnotationFile ? e.message : `读取失败：${String(e)}`)
    }
  }

  // Comparing different quarters produces numbers that look fine and mean
  // nothing, so it is refused rather than warned about.
  const mismatch = useMemo(() => {
    if (!docA || !docB) return null
    if (docA.gameId !== docB.gameId) return `两份文件不是同一场比赛（${docA.gameId} vs ${docB.gameId}）`
    if (docA.quarter !== docB.quarter) return `两份文件不是同一节（Q${docA.quarter} vs Q${docB.quarter}）`
    return null
  }, [docA, docB])

  const report = useMemo(
    () => (docA && docB && !mismatch ? computeAgreement(docA, docB) : null),
    [docA, docB, mismatch],
  )

  const runs = useMemo(() => {
    if (!report || !docA || !docB) return []
    const ordered = [...new Set([...docA.buckets.keys(), ...docB.buckets.keys()])].sort((x, y) => y - x)
    return buildDiffRuns(report.cells, ordered)
  }, [report, docA, docB])

  const reviewable = useMemo(() => runs.filter(r => isReviewable(r.status)), [runs])

  const jumpTo = useCallback((run: DiffRun) => {
    setSelected(run)
    const frame = docA?.buckets.get(run.startBucket)?.frameStart
      ?? docB?.buckets.get(run.startBucket)?.frameStart
    if (frame !== undefined && framesLoaded) setCurrentFrame(frame)
  }, [docA, docB, framesLoaded, setCurrentFrame])

  const step = useCallback((delta: number) => {
    if (reviewable.length === 0) return
    const i = selected ? reviewable.findIndex(
      r => r.defenderId === selected.defenderId && r.startBucket === selected.startBucket,
    ) : -1
    const next = (i + delta + reviewable.length) % reviewable.length
    jumpTo(reviewable[next])
  }, [reviewable, selected, jumpTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.key === 'n') { e.preventDefault(); step(1) }
      if (e.key === 'p') { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const nameOf = (doc: AnnotationDocument | null, id: AttackerId | undefined) => {
    if (id === undefined) return ''
    if (id === 'GUARD_NONE') return 'GUARD_NONE'
    return doc?.players[id as number]?.jersey ? `#${doc.players[id as number].jersey}` : String(id)
  }

  const exportReport = () => {
    if (!report) return
    const header = csvRow([
      'game_id', 'quarter', 'annotator_a', 'annotator_b',
      'defender_id', 'defender_jersey', 'status',
      'start_bucket', 'end_bucket', 'duration_s', 'frame_start',
      'answer_a', 'answer_b',
    ])
    const rows = reviewable.map(r => csvRow([
      report.gameId, report.quarter, report.annotatorA, report.annotatorB,
      r.defenderId, docA?.players[r.defenderId]?.jersey ?? '', r.status,
      r.startBucket, r.endBucket, r.durationS,
      docA?.buckets.get(r.startBucket)?.frameStart ?? '',
      nameOf(docA, r.a), nameOf(docB, r.b),
    ]))
    download(
      [header, ...rows].join('\n'),
      `agreement_${report.gameId}_Q${report.quarter}.csv`,
      'text/csv',
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-page)', color: 'var(--text-1)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
      }}>
        <button onClick={onBack} style={btn()}>← 返回</button>
        <strong style={{ fontSize: 14 }}>对比标注者</strong>
        {report && (
          <button onClick={exportReport} style={{ ...btn(), marginLeft: 'auto' }}>
            ⬇ 导出分歧清单 CSV
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, padding: 12, flexShrink: 0 }}>
        <DropSide label="标注者 A" doc={docA} error={errA} onFile={f => load('a', f)} />
        <DropSide label="标注者 B" doc={docB} error={errB} onFile={f => load('b', f)} />
      </div>

      {mismatch && (
        <div role="alert" style={banner('var(--accent-danger)')}>
          ⚠ {mismatch} —— 拒绝比对，否则算出的数字没有意义。
        </div>
      )}

      {report && report.annotatorA && report.annotatorA === report.annotatorB && (
        <div role="alert" style={banner('var(--confidence-mid)')}>
          ⚠ 两份文件的标注者名字相同（{report.annotatorA}），无法区分 A/B。请确认没有传错文件。
        </div>
      )}

      {report && report.nDefenseMismatch > 0 && (
        <div role="alert" style={banner('#7b3fa0')}>
          ⚠ 有 {report.defenseMismatchBuckets.length} 个 bucket 两人对「谁在防守」判断不同
          （{report.nDefenseMismatch} 个单元格已排除）。这是整回合级别的分歧，不是单元格级别的。
        </div>
      )}

      {report && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0 12px 10px' }}>
            <Card
              value={`${(report.rawAgreement * 100).toFixed(1)}%`}
              label="原始一致率"
              sub={`n = ${report.nCompared}`}
            />
            <Card
              value={report.kappaPooled === null ? '—' : report.kappaPooled.toFixed(3)}
              label="Cohen's κ（合并）"
              sub={report.kappaPooled === null ? '只用了一个类别，κ 无定义' : `按防守者平均 ${report.kappaMeanPerDefender?.toFixed(3) ?? '—'}`}
            />
            <Card
              value={report.switchEvents.f1.toFixed(3)}
              label="换防事件 F1"
              sub={`±${report.switchEvents.toleranceBuckets} bucket · A ${report.switchEvents.nA} / B ${report.switchEvents.nB} · 匹配 ${report.switchEvents.matched}`}
            />
            <Card
              value={`${(report.deadLive.agreement * 100).toFixed(1)}%`}
              label="死球判定一致率"
              sub={`n = ${report.deadLive.nCompared}`}
            />
            <Card value={String(report.nCoverageMismatch)} label="仅一方标注" sub="不计入 κ" muted />
            <Card value={String(report.nDeadExcluded)} label="死球排除" sub="不计入归属统计" muted />
            <Card value={String(report.nDefenseMismatch)} label="攻防归属分歧" sub="已排除" muted />
          </div>

          <details style={{ padding: '0 12px 10px', fontSize: 12, color: 'var(--text-3)' }}>
            <summary style={{ cursor: 'pointer' }}>
              指标说明与局限（{report.caveats.length} 条 · 写论文前请先读）
            </summary>
            <ul style={{ margin: '8px 0 0 18px', lineHeight: 1.6 }}>
              {report.caveats.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
            <div style={{ marginTop: 8 }}>
              <strong>边缘分布</strong>（用来判断机会一致有多大）：
              {report.marginals.map(m => (
                <span key={m.category} style={{ marginLeft: 8 }}>
                  {m.category}: A {m.aCount} / B {m.bCount}
                </span>
              ))}
            </div>
          </details>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12,
          }}>
            <button onClick={() => step(-1)} style={btn()}>← p 上一处</button>
            <button onClick={() => step(1)} style={btn()}>n 下一处 →</button>
            <span style={{ color: 'var(--text-3)' }}>
              共 {reviewable.length} 处待讨论
              {selected && ` 当前：#${docA?.players[selected.defenderId]?.jersey ?? selected.defenderId} ${selected.startBucket.toFixed(1)}`}
            </span>
            {!framesLoaded && (
              <span style={{ color: 'var(--text-4)', marginLeft: 'auto' }}>
                （未加载追踪数据，点击色带无法跳转回放）
              </span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <DiffGrid
              report={report} docA={docA!} docB={docB!}
              selectedRun={selected} onSelectRun={jumpTo}
            />
          </div>
        </>
      )}
    </div>
  )
}

function DropSide({ label, doc, error, onFile }: {
  label: string
  doc: AnnotationDocument | null
  error: string | null
  onFile: (f: File) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <label
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false)
        const f = e.dataTransfer.files[0]; if (f) onFile(f)
      }}
      style={{
        flex: 1, minHeight: 74, cursor: 'pointer', borderRadius: 6, padding: 10,
        background: 'var(--bg-panel)',
        border: `1px dashed ${over ? 'var(--accent, #4a90d9)' : error ? 'var(--accent-danger)' : 'var(--border)'}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>{label}</div>
      {doc ? (
        <div style={{ fontSize: 12 }}>
          <strong style={{ fontSize: 14 }}>{doc.annotator || '（未填写标注者姓名）'}</strong>
          <div style={{ color: 'var(--text-3)', marginTop: 2 }}>
            {doc.gameId} · Q{doc.quarter} · {doc.buckets.size} buckets ·{' '}
            <span style={{ textTransform: 'uppercase' }}>{doc.sourceFormat}</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: error ? 'var(--accent-danger)' : 'var(--text-3)' }}>
          {error ?? '把导出的 JSON 或 CSV 拖到这里'}
        </div>
      )}
      <input
        type="file" accept=".json,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}

function Card({ value, label, sub, muted }: {
  value: string; label: string; sub?: string; muted?: boolean
}) {
  return (
    <div style={{
      background: 'var(--bg-panel)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '8px 12px', minWidth: 132,
      opacity: muted ? 0.75 : 1,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: muted ? 'var(--text-2)' : 'var(--text-1)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const btn = (): React.CSSProperties => ({
  background: 'var(--bg-surface)', color: 'var(--text-1)',
  border: '1px solid var(--border)', borderRadius: 4,
  padding: '3px 10px', fontSize: 12, cursor: 'pointer',
})

const banner = (color: string): React.CSSProperties => ({
  margin: '0 12px 10px', padding: '7px 12px', borderRadius: 5,
  background: 'var(--bg-panel)', borderLeft: `3px solid ${color}`,
  fontSize: 12, color: 'var(--text-2)',
})
