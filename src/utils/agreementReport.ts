import type { AgreementReport } from './agreement'
import type { AnnotationDocument } from './annotationDocument'
import type { DeadComparison } from './deadSpans'
import type { DefenseComparison } from './defenseSpans'
import { fmtClock } from './timelineScale'

/**
 * A self-contained HTML reliability report.
 *
 * The existing CSV export carries four ID columns and the disagreement rows,
 * which is a work list, not something you can hand to a collaborator or put in
 * an appendix. This produces one file that opens in any browser, prints, and
 * states every figure together with the denominator and the caveat that
 * belongs to it — including the caveats that make the headline number look
 * worse, since those are the ones a reader needs most.
 *
 * Deliberately inlines its own styles and uses no scripts: it has to survive
 * being emailed, and it must render the same for someone who has never seen
 * the tool.
 */

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const num = (v: number | null, digits = 2) => (v === null ? '—' : v.toFixed(digits))

export interface ReportInput {
  report: AgreementReport
  docA: AnnotationDocument
  docB: AnnotationDocument
  dead: DeadComparison
  defense: DefenseComparison
}

/**
 * A paragraph the author can adapt for a methods section.
 *
 * States the switch-event figure first and says plainly why the per-bucket rate
 * is inflated — a reviewer will ask, and a report that raises it first reads as
 * careful rather than as caught out.
 */
export function methodsParagraph({ report, docA, docB }: ReportInput): string {
  const { switchEvents: sw } = report
  const offset = sw.medianOffsetBuckets
  const offsetNote = offset === null || offset === 0
    ? ''
    : ` The median timing offset was ${Math.abs(offset).toFixed(1)} bucket(s)` +
      ` (${esc(offset > 0 ? docA.annotator || 'A' : docB.annotator || 'B')} consistently earlier).`

  return (
    `Two annotators independently coded the same quarter ` +
    `(${esc(report.gameId)} Q${report.quarter}). ` +
    `Agreement on defensive assignment was ${pct(report.rawAgreement)} ` +
    `of defender-half-seconds (n = ${report.nCompared}), with Cohen's κ = ${num(report.kappaPooled)}. ` +
    `Because the annotation tool carries an assignment forward until it is changed, ` +
    `adjacent buckets are highly autocorrelated and this per-bucket figure is inflated; ` +
    `the primary measure of annotation quality is therefore agreement on switch events ` +
    `(the moments a defender changes target), matched within ±${sw.toleranceBuckets} buckets ` +
    `(±${(sw.toleranceBuckets * 0.5).toFixed(1)} s): ` +
    `F1 = ${num(sw.f1)} (precision ${num(sw.precision)}, recall ${num(sw.recall)}; ` +
    `${esc(docA.annotator || 'A')} recorded ${sw.nA} and ` +
    `${esc(docB.annotator || 'B')} recorded ${sw.nB}, of which ${sw.matched} matched).` +
    `${offsetNote} ` +
    `Agreement on whether play was live was ${pct(report.deadLive.agreement)} ` +
    `(n = ${report.deadLive.nCompared} buckets, κ = ${num(report.deadLive.kappa)}). ` +
    `${report.nCoverageMismatch} cell(s) annotated by only one coder and ` +
    `${report.nDeadExcluded} cell(s) in dead-ball buckets were excluded from the ` +
    `assignment figures; ${report.nDefenseMismatch} cell(s) were excluded because the ` +
    `coders disagreed about which team was defending.`
  )
}

function statCard(value: string, label: string, sub: string, lead = false): string {
  return `<div class="card${lead ? ' lead' : ''}">
    <div class="value">${esc(value)}</div>
    <div class="label">${esc(label)}</div>
    <div class="sub">${esc(sub)}</div>
  </div>`
}

export function buildAgreementReportHTML(input: ReportInput): string {
  const { report, docA, docB, dead, defense } = input
  const nameA = docA.annotator || 'A'
  const nameB = docB.annotator || 'B'
  const players = { ...docB.players, ...docA.players }
  const sw = report.switchEvents

  const perDefenderRows = [...report.perDefender]
    .map(d => ({ ...d, nDisagree: d.nCompared - d.nAgree }))
    .sort((a, b) => b.nDisagree - a.nDisagree)
    .map(d => `<tr>
      <td>#${esc(players[d.defenderId]?.jersey ?? d.defenderId)} ${esc(players[d.defenderId]?.name ?? '')}</td>
      <td class="n">${d.nCompared}</td>
      <td class="n">${pct(d.rawAgreement)}</td>
      <td class="n">${num(d.kappa)}</td>
      <td class="n">${d.nDisagree}</td>
    </tr>`).join('')

  const defenseRows = defense.disagreements.map(d => `<tr>
      <td>${esc(fmtClock(d.startBucket))} → ${esc(fmtClock(d.endBucket))}</td>
      <td class="n">${d.durationS.toFixed(1)}s</td>
      <td>${esc(nameA)}: ${esc(d.teamA)}</td>
      <td>${esc(nameB)}: ${esc(d.teamB)}</td>
    </tr>`).join('')

  const deadRows = dead.disagreements.map(d => `<tr>
      <td>${esc(fmtClock(d.startBucket))} → ${esc(fmtClock(d.endBucket))}</td>
      <td class="n">${d.durationS.toFixed(1)}s</td>
      <td>${esc(d.deadSide === 'a' ? nameA : nameB)} called it dead</td>
      <td>${esc(d.deadSide === 'a' ? nameB : nameA)} called it live</td>
    </tr>`).join('')

  const marginalRows = report.marginals.map(m => `<tr>
      <td>${esc(m.category)}</td>
      <td class="n">${m.aCount}</td>
      <td class="n">${m.bCount}</td>
    </tr>`).join('')

  const section = (title: string, body: string) =>
    `<section><h2>${esc(title)}</h2>${body}</section>`

  const emptyOr = (rows: string, headers: string[], emptyMsg: string) =>
    rows
      ? `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="none">${esc(emptyMsg)}</p>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Inter-annotator agreement — ${esc(report.gameId)} Q${report.quarter}</title>
<style>
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         color: #1a1d2a; max-width: 900px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 22px; margin: 0 0 .2rem; }
  h2 { font-size: 15px; margin: 2rem 0 .6rem; padding-bottom: .3rem;
       border-bottom: 1px solid #d8dbe4; }
  .meta { color: #667; margin-bottom: 1.5rem; }
  .cards { display: flex; flex-wrap: wrap; gap: .6rem; }
  .card { border: 1px solid #d8dbe4; border-radius: 6px; padding: .6rem .8rem; min-width: 150px; }
  .card.lead { border-color: #3a7bc8; border-width: 2px; }
  .card .value { font-size: 22px; font-weight: 700; }
  .card .label { font-size: 12px; color: #556; }
  .card .sub { font-size: 11px; color: #889; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: .4rem; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e6e8ef; }
  th { color: #556; font-weight: 600; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .none { color: #778; font-style: italic; }
  .caveats li { margin-bottom: .4rem; }
  .methods { background: #f4f6fa; border-left: 3px solid #3a7bc8; padding: .8rem 1rem;
             border-radius: 0 4px 4px 0; }
  footer { margin-top: 2.5rem; color: #889; font-size: 11px;
           border-top: 1px solid #d8dbe4; padding-top: .8rem; }
  @media print { body { margin: 0; max-width: none; } h2 { page-break-after: avoid; } }
</style></head><body>

<h1>Inter-annotator agreement</h1>
<div class="meta">
  ${esc(nameA)} vs ${esc(nameB)} · ${esc(report.gameId)} Q${report.quarter}
  · generated ${esc(new Date().toISOString().slice(0, 10))}
</div>

${section('Summary', `
  <p>Ordered by how much each figure can be trusted.</p>
  <div class="cards">
    ${statCard(num(sw.f1), 'Switch-event F1', `precision ${num(sw.precision)} · recall ${num(sw.recall)}`, true)}
    ${statCard(pct(report.deadLive.agreement), 'Dead-ball agreement', `n = ${report.deadLive.nCompared} · κ ${num(report.deadLive.kappa)}`)}
    ${statCard(num(report.kappaPooled), "Cohen's κ", `mean per defender ${num(report.kappaMeanPerDefender)}`)}
    ${statCard(pct(report.rawAgreement), 'Raw agreement', `n = ${report.nCompared} · inflated by carry-forward`)}
  </div>`)}

${section('What was excluded', `
  <table><thead><tr><th>Reason</th><th class="n">Cells</th></tr></thead><tbody>
    <tr><td>Compared</td><td class="n">${report.nCompared}</td></tr>
    <tr><td>Only one annotator filled it in</td><td class="n">${report.nCoverageMismatch}</td></tr>
    <tr><td>In a bucket either called dead</td><td class="n">${report.nDeadExcluded}</td></tr>
    <tr><td>Annotators named different defending teams</td><td class="n">${report.nDefenseMismatch}</td></tr>
  </tbody></table>`)}

${section(`Defending team (${defense.disagreements.length} stretch(es))`, `
  <p>The most damaging disagreement: the defending team sets the direction a
  possession is mirrored into, so one wrong stretch re-orients a whole possession.</p>
  ${emptyOr(defenseRows, ['Clock', 'Duration', nameA, nameB], 'The two agreed throughout.')}`)}

${section(`Switch timing (F1 ${num(sw.f1)})`, `
  <p>${esc(nameA)} recorded ${sw.nA} switch(es), ${esc(nameB)} recorded ${sw.nB};
  ${sw.matched} matched within ±${sw.toleranceBuckets} buckets.
  ${sw.medianOffsetBuckets !== null && sw.medianOffsetBuckets !== 0
    ? `Median offset ${sw.medianOffsetBuckets > 0 ? '+' : ''}${sw.medianOffsetBuckets.toFixed(1)} bucket(s)
       (${esc(sw.medianOffsetBuckets > 0 ? nameA : nameB)} consistently earlier).`
    : ''}</p>`)}

${section(`Dead ball (${dead.disagreements.length} stretch(es))`, `
  ${emptyOr(deadRows, ['Clock', 'Duration', '', ''], 'The two agreed throughout.')}`)}

${section('By defender', `
  <p>Where the two stop agreeing — the noisiest defender indicates which part of
  the protocol is underspecified.</p>
  ${emptyOr(perDefenderRows,
    ['Defender', 'Compared', 'Agreement', 'κ', 'Disagreements'],
    'No defender had any comparable buckets.')}`)}

${section('Marginals', `
  <p>How the categories were distributed, so a reader can judge how much room
  chance agreement had.</p>
  ${emptyOr(marginalRows, ['Category', nameA, nameB], 'Nothing was compared.')}`)}

${section('Limitations', `
  <ul class="caveats">${report.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`)}

${section('Draft methods paragraph', `
  <div class="methods">${esc(methodsParagraph(input))}</div>`)}

<footer>
  Generated by NBA Guard Annotation. Figures should be recomputed independently
  before publication.
</footer>
</body></html>`
}
