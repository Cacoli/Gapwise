'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface QuizSession {
  id: string
  score: number
  total_questions: number
  completed_at: string
  file_name: string
}

interface GapTopic {
  id: string
  name: string
  coverage_score: number
  is_gap: boolean
  created_at: string
}

interface DeletedFile {
  file_name: string
  deleted_at: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 86400000) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function pctColor(p: number) {
  if (p >= 70) return 'var(--gw-teal-light)'
  if (p >= 40) return 'var(--gw-amber)'
  return '#F0997B'
}

function ScoreRing({ pct }: { pct: number }) {
  const r = 16
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" style={{ flexShrink: 0 }}>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--gw-bg3)" strokeWidth="3" />
      <circle
        cx="22" cy="22" r={r} fill="none"
        stroke={pctColor(pct)} strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
      <text x="22" y="26" textAnchor="middle" fontSize="10" fontWeight="600" fill={pctColor(pct)}>
        {pct}%
      </text>
    </svg>
  )
}

function ScoreBadge({ pct }: { pct: number }) {
  const label = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Fair' : 'Needs work'
  return (
    <span style={{
      fontSize: '11px', padding: '3px 10px', borderRadius: '10px', fontWeight: 500,
      background: pct >= 70 ? 'var(--gw-teal-dim)' : pct >= 40 ? 'rgba(245,176,65,0.12)' : 'var(--gw-coral-dim)',
      color: pctColor(pct), whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div style={{
      background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
      borderRadius: 'var(--gw-radius)', padding: '40px 32px',
      textAlign: 'center', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '10px',
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: '28px', color: 'var(--gw-muted2)' }} aria-hidden />
      <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: 0 }}>{message}</p>
    </div>
  )
}

export default function HistoryPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [userId,        setUserId]        = useState<string | null>(null)
  const [quizSessions,  setQuizSessions]  = useState<QuizSession[]>([])
  const [gapHistory,    setGapHistory]    = useState<GapTopic[]>([])
  const [deletedFiles,  setDeletedFiles]  = useState<DeletedFile[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'quiz' | 'gaps' | 'deleted'>('quiz')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)
    })
  }, [])

  // Load deleted files from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('gw_deleted_files')
      const parsed: DeletedFile[] = raw ? JSON.parse(raw) : []
      // filter out anything older than 30 days
      const fresh = parsed.filter(f => Date.now() - new Date(f.deleted_at).getTime() < 30 * 86400000)
      setDeletedFiles(fresh)
    } catch {}
  }, [])

  useEffect(() => {
    if (!userId) return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: sessions, error: sErr } = await supabase
          .from('quiz_sessions')
          .select('id, score, total_questions, completed_at, file_id')
          .eq('user_id', userId)
          .order('completed_at', { ascending: false })
        if (sErr) throw sErr

        const fileIds = [...new Set((sessions ?? []).map((s: any) => s.file_id).filter(Boolean))]
        let fileMap: Record<string, string> = {}
        if (fileIds.length > 0) {
          const { data: files } = await supabase
            .from('uploaded_files')
            .select('id, file_name')
            .in('id', fileIds)
          ;(files ?? []).forEach((f: any) => { fileMap[f.id] = f.file_name })
        }

        setQuizSessions(
          (sessions ?? []).map((s: any) => ({
            id:              s.id,
            score:           s.score,
            total_questions: s.total_questions,
            completed_at:    s.completed_at,
            file_name:       fileMap[s.file_id] ?? 'Unknown file',
          }))
        )

        const { data: gaps, error: gErr } = await supabase
          .from('topics')
          .select('id, name, coverage_score, is_gap, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
        if (gErr) throw gErr
        setGapHistory(gaps ?? [])

      } catch (e: any) {
        setError(e.message ?? 'Failed to load history')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [userId])

  const tabs: { key: 'quiz' | 'gaps' | 'deleted'; label: string; count: number }[] = [
    { key: 'quiz',    label: 'Quiz Sessions',     count: quizSessions.length },
    { key: 'gaps',    label: 'Gap History',        count: gapHistory.length   },
    { key: 'deleted', label: 'Recently Deleted',   count: deletedFiles.length },
  ]

  const avgQuizScore = quizSessions.length > 0
    ? Math.round(quizSessions.reduce((acc, s) => acc + (s.total_questions > 0 ? s.score / s.total_questions * 100 : 0), 0) / quizSessions.length)
    : null

  const gapCount     = gapHistory.filter(g => g.is_gap).length
  const coveredCount = gapHistory.filter(g => !g.is_gap).length

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '860px' }}>

      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--gw-text)', margin: 0 }}>History</h1>
        <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: '4px 0 0' }}>Your quiz attempts and gap tracking over time</p>
      </div>

      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { label: 'Quizzes Taken',   value: quizSessions.length,                              icon: 'ti-clipboard-list',  color: 'var(--gw-teal-light)' },
            { label: 'Avg Score',       value: avgQuizScore !== null ? `${avgQuizScore}%` : '—', icon: 'ti-chart-bar',       color: avgQuizScore !== null ? pctColor(avgQuizScore) : 'var(--gw-muted)' },
            { label: 'Gaps Identified', value: gapCount, sub: coveredCount > 0 ? `${coveredCount} covered` : undefined, icon: 'ti-alert-triangle', color: gapCount > 0 ? '#F0997B' : 'var(--gw-teal-light)' },
          ].map(card => (
            <div key={card.label} style={{
              background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
              borderRadius: 'var(--gw-radius)', padding: '16px 18px',
              display: 'flex', alignItems: 'center', gap: '14px',
            }}>
              <i className={`ti ${card.icon}`} style={{ fontSize: '22px', color: card.color, flexShrink: 0 }} aria-hidden />
              <div>
                <div style={{ fontSize: '20px', fontWeight: 600, color: card.color, lineHeight: 1 }}>{card.value}</div>
                <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '3px' }}>{card.label}</div>
                {card.sub && <div style={{ fontSize: '11px', color: 'var(--gw-teal-light)', marginTop: '1px' }}>{card.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--gw-border)' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', background: 'transparent', border: 'none',
              borderBottom: activeTab === t.key ? '2px solid var(--gw-teal)' : '2px solid transparent',
              color: activeTab === t.key ? 'var(--gw-teal-light)' : 'var(--gw-muted)',
              display: 'flex', alignItems: 'center', gap: '6px',
              marginBottom: '-1px', transition: 'color 0.15s',
            }}
          >
            {t.label}
            <span style={{
              fontSize: '11px', padding: '1px 6px', borderRadius: '10px',
              background: activeTab === t.key ? 'var(--gw-teal-dim)' : 'var(--gw-bg3)',
              color: activeTab === t.key ? 'var(--gw-teal-light)' : 'var(--gw-muted)',
            }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--gw-muted)', fontSize: '13px' }}>
          <i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} aria-hidden />
          Loading history…
        </div>
      )}

      {error && (
        <div style={{
          fontSize: '13px', color: '#F0997B', padding: '10px 14px',
          background: 'var(--gw-coral-dim)', borderRadius: 'var(--gw-radius-sm)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <i className="ti ti-alert-circle" aria-hidden />
          {error}
        </div>
      )}

      {/* Quiz Sessions */}
      {!loading && !error && activeTab === 'quiz' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {quizSessions.length === 0 ? (
            <EmptyState icon="ti-clipboard-x" message="No quiz sessions yet — take a quiz to see results here" />
          ) : quizSessions.map(s => {
            const p = s.total_questions > 0 ? Math.round(s.score / s.total_questions * 100) : 0
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
                borderRadius: 'var(--gw-radius)', padding: '14px 18px', gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <ScoreRing pct={p} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--gw-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.file_name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '2px' }}>
                      {formatDate(s.completed_at)} · {s.score}/{s.total_questions} correct
                    </div>
                  </div>
                </div>
                <ScoreBadge pct={p} />
              </div>
            )
          })}
        </div>
      )}

      {/* Gap History */}
      {!loading && !error && activeTab === 'gaps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {gapHistory.length === 0 ? (
            <EmptyState icon="ti-map-search" message="No gap data yet — run gap analysis first" />
          ) : gapHistory.map(g => {
            const p = Math.round(g.coverage_score * 100)
            return (
              <div key={g.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
                borderRadius: 'var(--gw-radius)', padding: '14px 18px', gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <i
                    className={`ti ${g.is_gap ? 'ti-circle-x' : 'ti-circle-check'}`}
                    style={{ fontSize: '20px', color: g.is_gap ? '#F0997B' : 'var(--gw-teal-light)', flexShrink: 0 }}
                    aria-hidden
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--gw-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '2px' }}>{formatDate(g.created_at)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {g.is_gap && (
                    <span style={{
                      fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                      background: 'var(--gw-coral-dim)', color: '#F0997B',
                      fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>gap</span>
                  )}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: pctColor(p) }}>{p}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--gw-muted)' }}>coverage</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Recently Deleted */}
      {activeTab === 'deleted' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {deletedFiles.length === 0 ? (
            <EmptyState icon="ti-trash-x" message="No recently deleted files — deleted files appear here for 30 days" />
          ) : deletedFiles.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
              borderRadius: 'var(--gw-radius)', padding: '14px 18px', gap: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <i className="ti ti-file-x" style={{ fontSize: '20px', color: 'var(--gw-muted2)', flexShrink: 0 }} aria-hidden />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: 'var(--gw-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.file_name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '2px' }}>
                    Deleted {formatDate(f.deleted_at)}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                background: 'var(--gw-coral-dim)', color: '#F0997B',
                fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>deleted</span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}