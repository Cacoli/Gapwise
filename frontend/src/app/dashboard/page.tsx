'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface GapResult {
  topic: string
  coverage_score: number
  is_gap: boolean
  subtopics?: string
}

interface QuizSession {
  session_id: string
  topic: string
  score: number
  total: number
  created_at: string
}

interface UploadedFile {
  id: string
  file_name: string
  file_size: number
  status: 'done' | 'pending' | 'processing' | 'failed'
  chunks_count?: number
  created_at: string
}

function scoreColor(pct: number) {
  if (pct >= 70) return 'var(--gw-teal-light)'
  if (pct >= 45) return 'var(--gw-amber)'
  return '#F0997B'
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 86400000) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatBytes(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function DashboardPage() {
  const router  = useRouter()
  const supabase = createClient()

  const [userId,   setUserId]   = useState<string | null>(null)
  const [gaps,     setGaps]     = useState<GapResult[]>([])
  const [sessions, setSessions] = useState<QuizSession[]>([])
  const [uploads,  setUploads]  = useState<UploadedFile[]>([])
  const [loading,  setLoading]  = useState(true)

  // derived stats
  const coveragePct = gaps.length
    ? Math.round(gaps.reduce((s, g) => s + g.coverage_score, 0) / gaps.length * 100)
    : 0
  const gapCount     = gaps.filter(g => g.is_gap).length
  const priorityGaps = [...gaps].filter(g => g.is_gap).sort((a, b) => a.coverage_score - b.coverage_score).slice(0, 3)
  const topTopics    = [...gaps].sort((a, b) => b.coverage_score - a.coverage_score).slice(0, 8)
  const avgScore     = sessions.length
    ? Math.round(sessions.reduce((s, q) => s + q.score / q.total, 0) / sessions.length * 100)
    : null

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

    Promise.all([
  fetch(`${API}/api/v1/gaps/?user_id=${userId}&t=${Date.now()}`)
    .then(r => r.ok ? r.json() : [])
    .then(d => Array.isArray(d) ? d : d.gaps ?? d.data ?? d.results ?? []),
fetch(`${API}/api/v1/quiz/session/history/${userId}?t=${Date.now()}`)    .then(r => r.ok ? r.json() : [])
    .then(d => Array.isArray(d) ? d : d.sessions ?? d.data ?? d.results ?? []),
  supabase.from('uploaded_files').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(6)
    .then(({ data }) => data ?? []),
]).then(([g, s, u]) => {
  setGaps(Array.isArray(g) ? g : [])
  setSessions(Array.isArray(s) ? s : [])
  setUploads(Array.isArray(u) ? u : [])
}).finally(() => setLoading(false))
  }, [userId])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--gw-muted)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Page title */}
      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--gw-text)', margin: 0 }}>Overview</h1>
        <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: '4px 0 0' }}>Your study gap summary</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {[
          { label: 'Coverage',      icon: 'ti-chart-bar',       value: `${coveragePct}%`,                        color: 'var(--gw-teal-light)', accent: 'var(--gw-teal)'  },
          { label: 'Gaps found',    icon: 'ti-alert-triangle',  value: String(gapCount),                         color: '#F0997B',              accent: 'var(--gw-coral)' },
          { label: 'Quiz avg',      icon: 'ti-clipboard-check', value: avgScore !== null ? `${avgScore}%` : '—', color: 'var(--gw-amber)',       accent: 'var(--gw-amber)' },
          { label: 'Files indexed', icon: 'ti-file-text',       value: String(uploads.length),                   color: 'var(--gw-text)',        accent: 'var(--gw-muted2)'},
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--gw-bg2)',
            border: '0.5px solid var(--gw-border)',
            borderTop: `2px solid ${c.accent}`,
            borderRadius: 'var(--gw-radius)',
            padding: '16px',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--gw-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i className={`ti ${c.icon}`} style={{ fontSize: '14px' }} aria-hidden />
              {c.label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 500, color: c.color, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', alignItems: 'start' }}>

        {/* Left col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Topic coverage */}
          <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="ti ti-topology-star" style={{ color: 'var(--gw-muted2)' }} aria-hidden />
                Topic coverage
              </span>
              <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', background: 'var(--gw-teal-dim)', color: 'var(--gw-teal-light)' }}>
                {gaps.length} topics
              </span>
            </div>
            {topTopics.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gw-muted)', textAlign: 'center', padding: '20px 0' }}>
                Upload notes and run gap analysis to see coverage
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {topTopics.map(t => {
                  const pct = Math.round(t.coverage_score * 100)
                  return (
                    <div key={t.topic}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--gw-text)' }}>{t.topic}</span>
                        <span style={{ fontSize: '12px', color: 'var(--gw-muted)' }}>{pct}%</span>
                      </div>
                      <div style={{ height: '3px', background: 'var(--gw-bg3)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: scoreColor(pct), borderRadius: '2px', transition: 'width 0.8s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Priority gaps */}
          <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="ti ti-alert-circle" style={{ color: 'var(--gw-muted2)' }} aria-hidden />
                Priority gaps
              </span>
              {priorityGaps.length > 0 && (
                <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '20px', background: 'var(--gw-coral-dim)', color: '#F0997B' }}>
                  needs attention
                </span>
              )}
            </div>
            {priorityGaps.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gw-muted)', textAlign: 'center', padding: '20px 0' }}>
                No critical gaps detected yet
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {priorityGaps.map(g => (
                  <div key={g.topic} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 12px',
                    background: 'var(--gw-coral-dim)',
                    border: '0.5px solid rgba(216,90,48,0.18)',
                    borderRadius: 'var(--gw-radius-sm)',
                  }}>
                    <i className="ti ti-circle-x" style={{ color: '#F0997B', fontSize: '15px', marginTop: '1px', flexShrink: 0 }} aria-hidden />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: 'var(--gw-text)' }}>{g.topic}</div>
                      {g.subtopics && <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '2px' }}>{g.subtopics}</div>}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#F0997B', background: 'rgba(216,90,48,0.15)', padding: '2px 7px', borderRadius: '10px' }}>
                      {Math.round(g.coverage_score * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <button onClick={() => router.push('/dashboard/quiz')} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: 'var(--gw-radius-sm)',
                fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                background: 'var(--gw-teal)', border: 'none', color: '#fff',
              }}>
                <i className="ti ti-bolt" aria-hidden /> Generate gap quizzes
              </button>
              <button onClick={() => router.push('/dashboard/gaps')} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: 'var(--gw-radius-sm)',
                fontSize: '13px', cursor: 'pointer',
                background: 'transparent', border: '0.5px solid var(--gw-border2)', color: 'var(--gw-text)',
              }}>
                View all gaps <i className="ti ti-arrow-right" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Quiz history */}
          <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="ti ti-history" style={{ color: 'var(--gw-muted2)' }} aria-hidden />
              Recent quizzes
            </div>
            {sessions.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gw-muted)', textAlign: 'center', padding: '16px 0' }}>No quiz sessions yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {sessions.slice(0, 5).map(s => {
                  const pct = Math.round(s.score / s.total * 100)
                  const col = pct >= 70 ? 'var(--gw-teal-light)' : pct >= 50 ? 'var(--gw-amber)' : '#F0997B'
                  return (
                    <div key={s.session_id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 12px', background: 'var(--gw-bg3)',
                      borderRadius: 'var(--gw-radius-sm)', border: '0.5px solid var(--gw-border)',
                    }}>
                      <div>
                        <div style={{ fontSize: '13px', color: 'var(--gw-text)' }}>{s.topic}</div>
                        <div style={{ fontSize: '11px', color: 'var(--gw-muted)' }}>{formatDate(s.created_at)}</div>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: col }}>{s.score}/{s.total}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <button onClick={() => router.push('/dashboard/quiz')} style={{
              width: '100%', marginTop: '12px', padding: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              background: 'transparent', border: '0.5px solid var(--gw-border2)',
              borderRadius: 'var(--gw-radius-sm)', fontSize: '13px',
              color: 'var(--gw-text)', cursor: 'pointer',
            }}>
              <i className="ti ti-player-play" aria-hidden /> Start new quiz
            </button>
          </div>

          {/* Recent uploads */}
          <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="ti ti-upload" style={{ color: 'var(--gw-muted2)' }} aria-hidden />
              Recent uploads
            </div>
            {uploads.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--gw-muted)', textAlign: 'center', padding: '16px 0' }}>No files uploaded yet</p>
            ) : (
              uploads.slice(0, 4).map(f => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 12px', background: 'var(--gw-bg3)',
                  borderRadius: 'var(--gw-radius-sm)', border: '0.5px solid var(--gw-border)',
                  marginBottom: '8px',
                }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--gw-text)' }}>{f.file_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--gw-muted)' }}>
                      {formatBytes(f.file_size)}{f.chunks_count ? ` · ${f.chunks_count} chunks` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '10px',
                    background: f.status === 'done' ? 'var(--gw-teal-dim)' : f.status === 'failed' ? 'var(--gw-coral-dim)' : 'var(--gw-amber-dim)',
                    color: f.status === 'done' ? 'var(--gw-teal-light)' : f.status === 'failed' ? '#F0997B' : 'var(--gw-amber)',
                  }}>
                    {f.status}
                  </span>
                </div>
              ))
            )}
            <button onClick={() => router.push('/dashboard/notes')} style={{
              width: '100%', marginTop: '4px', padding: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              background: 'transparent', border: '0.5px solid var(--gw-border2)',
              borderRadius: 'var(--gw-radius-sm)', fontSize: '13px',
              color: 'var(--gw-text)', cursor: 'pointer',
            }}>
              <i className="ti ti-folder-open" aria-hidden /> Manage uploads
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}