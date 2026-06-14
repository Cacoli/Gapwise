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

export default function GapsPage() {
  const router   = useRouter()
  const supabase = createClient()

  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

  const [userId,     setUserId]     = useState<string | null>(null)
  const [gaps,       setGaps]       = useState<GapResult[]>([])
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState<'all' | 'gaps' | 'covered'>('all')
  const [analyzing,  setAnalyzing]  = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    fetch(`${API}/api/v1/gaps/?user_id=${userId}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => Array.isArray(d) ? d : d.gaps ?? d.data ?? d.results ?? [])
      .then(d => setGaps(d))
      .finally(() => setLoading(false))
  }, [userId])

  const runAnalysis = async () => {
    if (!userId) return
    setAnalyzing(true)
    setAnalyzeErr('')
    try {
      const res = await fetch(`${API}/api/v1/gaps/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail ?? 'Analysis failed')
      }
      const data = await res.json()
      setGaps(data.topics ?? [])
    } catch (e: any) {
      setAnalyzeErr(e.message ?? 'Something went wrong')
    } finally {
      setAnalyzing(false)
    }
  }

  const filtered = gaps.filter(g => {
    if (filter === 'gaps')    return g.is_gap
    if (filter === 'covered') return !g.is_gap
    return true
  }).sort((a, b) => a.coverage_score - b.coverage_score)

  const totalTopics  = gaps.length
  const coveredCount = gaps.filter(g => !g.is_gap).length
  const gapCount     = gaps.filter(g => g.is_gap).length
  const avgCoverage  = gaps.length
    ? Math.round(gaps.reduce((s, g) => s + g.coverage_score, 0) / gaps.length * 100)
    : 0

  function scoreColor(pct: number) {
    if (pct >= 70) return 'var(--gw-teal-light)'
    if (pct >= 45) return 'var(--gw-amber)'
    return '#F0997B'
  }

  function scoreBg(pct: number) {
    if (pct >= 70) return 'var(--gw-teal-dim)'
    if (pct >= 45) return 'var(--gw-amber-dim)'
    return 'var(--gw-coral-dim)'
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--gw-muted)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--gw-text)', margin: 0 }}>Gap Visualizer</h1>
          <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: '4px 0 0' }}>Topic coverage across your syllabus</p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 16px', borderRadius: 'var(--gw-radius-sm)',
            fontSize: '13px', fontWeight: 500,
            cursor: analyzing ? 'not-allowed' : 'pointer',
            background: analyzing ? 'var(--gw-muted2)' : 'var(--gw-teal)',
            border: 'none', color: '#fff',
          }}
        >
          <i className="ti ti-refresh" aria-hidden />
          {analyzing ? 'Analysing...' : 'Run analysis'}
        </button>
      </div>

      {analyzeErr && (
        <div style={{ fontSize: '13px', color: '#F0997B', padding: '10px 14px', background: 'var(--gw-coral-dim)', borderRadius: 'var(--gw-radius-sm)' }}>
          {analyzeErr}
        </div>
      )}

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {[
          { label: 'Total topics', value: String(totalTopics),  color: 'var(--gw-text)',       accent: 'var(--gw-muted2)', icon: 'ti-list'         },
          { label: 'Covered',      value: String(coveredCount), color: 'var(--gw-teal-light)', accent: 'var(--gw-teal)',   icon: 'ti-circle-check' },
          { label: 'Gaps',         value: String(gapCount),     color: '#F0997B',              accent: 'var(--gw-coral)',  icon: 'ti-circle-x'     },
          { label: 'Avg coverage', value: `${avgCoverage}%`,    color: 'var(--gw-amber)',      accent: 'var(--gw-amber)',  icon: 'ti-chart-bar'    },
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

      {/* Overall progress */}
      {gaps.length > 0 && (
        <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="ti ti-chart-bar" style={{ color: 'var(--gw-muted2)' }} aria-hidden />
            Overall progress
          </div>
          <div style={{ height: '8px', background: 'var(--gw-bg3)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${avgCoverage}%`,
              background: 'linear-gradient(90deg, var(--gw-teal) 0%, var(--gw-teal-light) 100%)',
              borderRadius: '4px',
              transition: 'width 1s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--gw-muted)' }}>
            <span>{coveredCount} of {totalTopics} topics covered</span>
            <span>{avgCoverage}% average coverage</span>
          </div>
        </div>
      )}

      {/* Filter + topic list */}
      <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
          {(['all', 'gaps', 'covered'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px', borderRadius: 'var(--gw-radius-sm)',
                fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                border: '0.5px solid',
                borderColor: filter === f ? 'var(--gw-teal)' : 'var(--gw-border)',
                background: filter === f ? 'var(--gw-teal-dim)' : 'transparent',
                color: filter === f ? 'var(--gw-teal-light)' : 'var(--gw-muted)',
                transition: 'all 0.15s',
              }}
            >
              {f === 'all' ? `All (${totalTopics})` : f === 'gaps' ? `Gaps (${gapCount})` : `Covered (${coveredCount})`}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--gw-muted)', fontSize: '13px' }}>
            {gaps.length === 0
              ? 'No gap analysis run yet. Upload notes and click Run analysis.'
              : 'No topics match this filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(g => {
              const pct = Math.round(g.coverage_score * 100)
              return (
                <div key={g.topic} style={{
                  padding: '14px 16px',
                  background: 'var(--gw-bg3)',
                  border: '0.5px solid var(--gw-border)',
                  borderRadius: 'var(--gw-radius-sm)',
                  display: 'flex', flexDirection: 'column', gap: '8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <i
                        className={g.is_gap ? 'ti ti-circle-x' : 'ti ti-circle-check'}
                        style={{ fontSize: '16px', color: g.is_gap ? '#F0997B' : 'var(--gw-teal-light)', flexShrink: 0 }}
                        aria-hidden
                      />
                      <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--gw-text)' }}>{g.topic}</span>
                    </div>
                    <span style={{
                      fontSize: '12px', fontWeight: 500,
                      padding: '3px 10px', borderRadius: '10px',
                      background: scoreBg(pct), color: scoreColor(pct),
                    }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ height: '3px', background: 'var(--gw-bg2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${pct}%`,
                      background: scoreColor(pct), borderRadius: '2px',
                      transition: 'width 0.8s ease',
                    }} />
                  </div>
                  {g.subtopics && (
                    <div style={{ fontSize: '12px', color: 'var(--gw-muted)', paddingLeft: '26px' }}>
                      {g.subtopics}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {gapCount > 0 && (
        <div style={{
          background: 'var(--gw-coral-dim)',
          border: '0.5px solid rgba(216,90,48,0.2)',
          borderRadius: 'var(--gw-radius)',
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gw-text)' }}>
              {gapCount} topic{gapCount > 1 ? 's' : ''} need attention
            </div>
            <div style={{ fontSize: '12px', color: 'var(--gw-muted)', marginTop: '2px' }}>
              Generate targeted quizzes to close these gaps
            </div>
          </div>
          <button
            onClick={() => router.push('/dashboard/quiz')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: 'var(--gw-radius-sm)',
              fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              background: 'var(--gw-teal)', border: 'none', color: '#fff', flexShrink: 0,
            }}
          >
            <i className="ti ti-bolt" aria-hidden /> Generate quizzes
          </button>
        </div>
      )}

    </div>
  )
}