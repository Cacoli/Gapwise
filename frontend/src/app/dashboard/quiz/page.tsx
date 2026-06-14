'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Question {
  question_id: string
  question: string
  options: string[]
  correct: string
  topic: string
}

interface EvalResult {
  question_id: string
  is_correct: boolean
  correct_answer: string
  explanation?: string
}

interface UploadedFile {
  id: string
  file_name: string
  status: string
}

type Stage = 'setup' | 'quiz' | 'result'

export default function QuizPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [userId,     setUserId]     = useState<string | null>(null)
  const [files,      setFiles]      = useState<UploadedFile[]>([])
  const [fileId,     setFileId]     = useState('')
  const [numQ,       setNumQ]       = useState<number | ''>('')
  const [stage,      setStage]      = useState<Stage>('setup')
  const [questions,  setQuestions]  = useState<Question[]>([])
  const [current,    setCurrent]    = useState(0)
  const [answers,    setAnswers]    = useState<Record<string, string>>({})
  const [revealed,   setRevealed]   = useState<Record<string, boolean>>({})
  const [results,    setResults]    = useState<EvalResult[]>([])
  const [loading,    setLoading]    = useState(false)
  const [streaming,  setStreaming]  = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error,      setError]      = useState('')
  const [quizLabel,  setQuizLabel]  = useState('') // file name shown on results

  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)

      const { data: fileRows } = await supabase
        .from('uploaded_files')
        .select('id, file_name, status')
        .eq('user_id', data.user.id)
        .order('created_at', { ascending: false })

      setFiles((fileRows ?? []).filter(f => f.status === 'done'))
    })
  }, [])

  const startQuiz = async () => {
    if (!fileId) { setError('Select a file first'); return }
    if (!numQ || numQ < 1 || numQ > 20) { setError('Enter a number between 1 and 20'); return }
    setError('')
    setLoading(true)
    setStreaming(true)
    setStreamText('')
    try {
      const selectedFile = files.find(f => f.id === fileId)
      const res = await fetch(`${API}/api/v1/quiz/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, file_id: fileId, num_questions: numQ }),
      })
      if (!res.ok) throw new Error('Failed to generate quiz')

      const contentType = res.headers.get('content-type') ?? ''

      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk
            const lines = chunk.split('\n').filter(l => l.startsWith('data:'))
            for (const line of lines) {
              const raw = line.replace(/^data:\s*/, '')
              if (raw === '[DONE]') break
              try {
                const parsed = JSON.parse(raw)
                if (parsed.delta) setStreamText(prev => prev + parsed.delta)
              } catch {}
            }
          }
        }

        let fullJson = ''
        const allLines = buffer.split('\n').filter(l => l.startsWith('data:'))
        for (const line of allLines) {
          const raw = line.replace(/^data:\s*/, '')
          if (raw === '[DONE]') break
          try {
            const parsed = JSON.parse(raw)
            if (parsed.full) { fullJson = parsed.full; break }
          } catch {}
        }

        if (!fullJson) throw new Error('No questions in stream response')

        let clean = fullJson.trim()
        if (clean.startsWith('```')) {
          const parts = clean.split('```')
          clean = parts[1]
          if (clean.startsWith('json')) clean = clean.slice(4)
          clean = clean.trim()
        }

        const qs: Question[] = JSON.parse(clean)
        if (qs.length === 0) throw new Error('No questions returned')
        qs.forEach(q => { if (!q.question_id) q.question_id = crypto.randomUUID() })
        qs.forEach(q => { if (!q.topic) q.topic = selectedFile?.file_name ?? 'General' })
        setQuestions(qs)
      } else {
        const data = await res.json()
        const qs = Array.isArray(data) ? data : data.questions ?? data.data ?? []
        if (qs.length === 0) throw new Error('No questions returned')
        setQuestions(qs)
      }

      setQuizLabel(selectedFile?.file_name ?? 'this document')
      setAnswers({})
      setRevealed({})
      setResults([])
      setCurrent(0)
      setStage('quiz')
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
      setStreaming(false)
      setStreamText('')
    }
  }

  const selectAnswer = (qid: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [qid]: answer }))
  }

  const submitQuiz = async () => {
    setLoading(true)
    setError('')
    try {
      const allRevealed: Record<string, boolean> = {}
      questions.forEach(q => { allRevealed[q.question_id] = true })
      setRevealed(allRevealed)

      const payload = questions.map(q => ({
        question_id:     q.question_id,
        question:        q.question,
        selected_answer: answers[q.question_id] ?? '',
        correct_answer:  q.correct,
        topic:           q.topic,
      }))
      const res = await fetch(`${API}/api/v1/quiz/evaluate/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, file_id: fileId, answers: payload }),
      })
      if (!res.ok) throw new Error('Failed to evaluate quiz')
      const data = await res.json()
      setResults(data.results ?? [])
      setStage('result')
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStage('setup')
    setQuestions([])
    setAnswers({})
    setRevealed({})
    setResults([])
    setCurrent(0)
    setError('')
  }

  const answered   = Object.keys(answers).length
  const allDone    = answered === questions.length && questions.length > 0
  const score      = results.filter(r => r.is_correct).length
  const scorePct   = results.length ? Math.round(score / results.length * 100) : 0
  const scoreColor = scorePct >= 70 ? 'var(--gw-teal-light)' : scorePct >= 50 ? 'var(--gw-amber)' : '#F0997B'
  const currentQ   = questions[current]

  const getOptionState = (qid: string, opt: string, correct: string) => {
    if (!revealed[qid]) return answers[qid] === opt ? 'selected' : 'idle'
    if (opt === correct) return 'correct'
    if (answers[qid] === opt) return 'wrong'
    return 'idle'
  }

  const optionStyles: Record<string, React.CSSProperties> = {
    idle:     { borderColor: 'var(--gw-border)',          background: 'var(--gw-bg3)',       color: 'var(--gw-text)' },
    selected: { borderColor: 'var(--gw-teal)',            background: 'var(--gw-teal-dim)',  color: 'var(--gw-teal-light)' },
    correct:  { borderColor: 'var(--gw-teal)',            background: 'var(--gw-teal-dim)',  color: 'var(--gw-teal-light)' },
    wrong:    { borderColor: 'var(--gw-coral, #F0997B)',  background: 'var(--gw-coral-dim)', color: '#F0997B' },
  }

  const badgeStyles: Record<string, React.CSSProperties> = {
    idle:     { borderColor: 'var(--gw-border2)', background: 'transparent',    color: 'var(--gw-muted)' },
    selected: { borderColor: 'var(--gw-teal)',    background: 'var(--gw-teal)', color: '#fff' },
    correct:  { borderColor: 'var(--gw-teal)',    background: 'var(--gw-teal)', color: '#fff' },
    wrong:    { borderColor: '#F0997B',           background: '#F0997B',        color: '#fff' },
  }

  // ── Setup ────────────────────────────────────────────────────────────────
  if (stage === 'setup') return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--gw-text)', margin: 0 }}>Quiz</h1>
        <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: '4px 0 0' }}>Generate a quiz from one of your uploaded files</p>
      </div>

      <div style={{
        background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
        borderRadius: 'var(--gw-radius)', padding: '24px', maxWidth: '520px',
        display: 'flex', flexDirection: 'column', gap: '20px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '13px', color: 'var(--gw-muted)' }}>File</label>
          {files.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--gw-muted)' }}>
              No processed files found. Upload a file in Notes first.
            </div>
          ) : (
            <select
              value={fileId}
              onChange={e => setFileId(e.target.value)}
              style={{
                background: 'var(--gw-bg3)', border: '0.5px solid var(--gw-border2)',
                borderRadius: 'var(--gw-radius-sm)', padding: '10px 14px',
                fontSize: '14px', color: 'var(--gw-text)', outline: 'none', width: '100%',
              }}
            >
              <option value="">Select a file...</option>
              {files.map(f => (
                <option key={f.id} value={f.id}>{f.file_name}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '13px', color: 'var(--gw-muted)' }}>Number of questions</label>
          <input
            type="number"
            min={1}
            max={20}
            placeholder="e.g. 5"
            value={numQ}
            onChange={e => {
              const val = parseInt(e.target.value)
              if (!e.target.value) { setNumQ(''); return }
              setNumQ(Math.min(20, val))
            }}
            style={{
              background: 'var(--gw-bg3)', border: '0.5px solid var(--gw-border2)',
              borderRadius: 'var(--gw-radius-sm)', padding: '10px 14px',
              fontSize: '14px', color: 'var(--gw-text)', outline: 'none', width: '120px',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--gw-muted)' }}>Between 1 and 20</span>
        </div>

        {streaming && (
          <div style={{
            padding: '12px 14px', background: 'var(--gw-teal-dim)',
            borderRadius: 'var(--gw-radius-sm)', border: '0.5px solid var(--gw-teal)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--gw-teal-light)',
                animation: 'gwPulse 1s ease-in-out infinite',
              }} />
              <span style={{ fontSize: '12px', color: 'var(--gw-teal-light)' }}>Generating questions...</span>
            </div>
            {streamText && (
              <div style={{ fontSize: '11px', color: 'var(--gw-muted)', fontFamily: 'monospace', marginTop: '6px', maxHeight: '48px', overflow: 'hidden' }}>
                {streamText.slice(-120)}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ fontSize: '13px', color: '#F0997B', padding: '10px 14px', background: 'var(--gw-coral-dim)', borderRadius: 'var(--gw-radius-sm)' }}>
            {error}
          </div>
        )}

        <button onClick={startQuiz} disabled={loading} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '11px', borderRadius: 'var(--gw-radius-sm)',
          fontSize: '14px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? 'var(--gw-muted2)' : 'var(--gw-teal)',
          border: 'none', color: '#fff',
        }}>
          <i className="ti ti-bolt" aria-hidden />
          {loading ? 'Generating...' : 'Generate quiz'}
        </button>
      </div>

      <style>{`
        @keyframes gwPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.8)} }
        @keyframes gwSlideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .gw-feedback { animation: gwSlideIn 0.2s ease; }
      `}</style>
    </div>
  )

  // ── Quiz ─────────────────────────────────────────────────────────────────
  if (stage === 'quiz') return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--gw-muted)' }}>Question {current + 1} of {questions.length}</span>
          <span style={{ fontSize: '13px', color: 'var(--gw-muted)' }}>{answered} answered</span>
        </div>
        <div style={{ height: '3px', background: 'var(--gw-bg3)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${(answered / questions.length) * 100}%`,
            background: 'var(--gw-teal)', borderRadius: '2px', transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {currentQ && (() => {
        const userAns = answers[currentQ.question_id]
        return (
          <div style={{
            background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
            borderRadius: 'var(--gw-radius)', padding: '24px',
            display: 'flex', flexDirection: 'column', gap: '20px',
          }}>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--gw-teal-light)', background: 'var(--gw-teal-dim)', padding: '3px 8px', borderRadius: '10px' }}>
                {currentQ.topic}
              </span>
              <p style={{ fontSize: '16px', color: 'var(--gw-text)', margin: '12px 0 0', lineHeight: 1.5 }}>
                {currentQ.question}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {currentQ.options.map((opt, i) => {
                const state = getOptionState(currentQ.question_id, opt, currentQ.correct)
                return (
                  <button key={i} onClick={() => selectAnswer(currentQ.question_id, opt)}
                    style={{
                      textAlign: 'left', padding: '12px 16px',
                      borderRadius: 'var(--gw-radius-sm)',
                      cursor: 'pointer',
                      fontSize: '14px', border: '0.5px solid',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: '10px',
                      ...optionStyles[state],
                    }}
                  >
                    <span style={{
                      width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 500, border: '0.5px solid',
                      transition: 'all 0.15s',
                      ...badgeStyles[state],
                    }}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '9px 16px', borderRadius: 'var(--gw-radius-sm)',
          fontSize: '13px', cursor: current === 0 ? 'not-allowed' : 'pointer',
          background: 'transparent', border: '0.5px solid var(--gw-border)',
          color: current === 0 ? 'var(--gw-muted2)' : 'var(--gw-text)',
        }}>
          <i className="ti ti-arrow-left" aria-hidden /> Previous
        </button>

        {current < questions.length - 1 ? (
          <button onClick={() => setCurrent(c => c + 1)} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 16px', borderRadius: 'var(--gw-radius-sm)',
            fontSize: '13px', cursor: 'pointer',
            background: 'var(--gw-teal)', border: 'none', color: '#fff',
          }}>
            Next <i className="ti ti-arrow-right" aria-hidden />
          </button>
        ) : (
          <button onClick={submitQuiz} disabled={loading || !allDone} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 16px', borderRadius: 'var(--gw-radius-sm)',
            fontSize: '13px', fontWeight: 500,
            cursor: (loading || !allDone) ? 'not-allowed' : 'pointer',
            background: (loading || !allDone) ? 'var(--gw-muted2)' : 'var(--gw-teal)',
            border: 'none', color: '#fff',
          }}>
            <i className="ti ti-check" aria-hidden />
            {loading ? 'Saving...' : `Finish (${answered}/${questions.length})`}
          </button>
        )}
      </div>

      {/* Dot navigator */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {questions.map((q, i) => {
          const hasAnswer = !!answers[q.question_id]
          return (
            <button key={q.question_id} onClick={() => setCurrent(i)} title={`Q${i + 1}`} style={{
              width: '28px', height: '28px', borderRadius: '50%',
              fontSize: '11px', fontWeight: 500, cursor: 'pointer',
              border: current === i ? '2px solid var(--gw-teal)' : '0.5px solid var(--gw-border)',
              background: hasAnswer ? 'var(--gw-teal-dim)' : 'transparent',
              color: hasAnswer ? 'var(--gw-teal-light)' : 'var(--gw-muted)',
            }}>
              {i + 1}
            </button>
          )
        })}
      </div>

      {!allDone && (
        <div style={{ fontSize: '12px', color: 'var(--gw-muted)' }}>
          Answer all questions to submit — {questions.length - answered} remaining
        </div>
      )}

      {error && (
        <div style={{ fontSize: '13px', color: '#F0997B', padding: '10px 14px', background: 'var(--gw-coral-dim)', borderRadius: 'var(--gw-radius-sm)' }}>
          {error}
        </div>
      )}

      <style>{`
        @keyframes gwSlideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .gw-feedback { animation: gwSlideIn 0.2s ease; }
      `}</style>
    </div>
  )

  // ── Result ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{
        background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
        borderRadius: 'var(--gw-radius)', padding: '28px 24px',
        textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      }}>
        <div style={{ fontSize: '48px', fontWeight: 500, color: scoreColor, lineHeight: 1 }}>{scorePct}%</div>
        <div style={{ fontSize: '14px', color: 'var(--gw-muted)' }}>
          {score} of {results.length} correct on <span style={{ color: 'var(--gw-text)' }}>{quizLabel}</span>
        </div>
        <div style={{ marginTop: '4px', fontSize: '13px', color: scoreColor }}>
          {scorePct >= 70 ? 'Great work!' : scorePct >= 50 ? 'Getting there — keep reviewing' : 'This document needs more review'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {results.map((r, i) => {
          const q = questions.find(q => q.question_id === r.question_id)
          return (
            <div key={r.question_id} style={{
              background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
              borderRadius: 'var(--gw-radius)', padding: '16px 18px',
              borderLeft: `3px solid ${r.is_correct ? 'var(--gw-teal)' : '#F0997B'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                <i className={r.is_correct ? 'ti ti-circle-check' : 'ti ti-circle-x'}
                  style={{ fontSize: '16px', color: r.is_correct ? 'var(--gw-teal-light)' : '#F0997B', flexShrink: 0, marginTop: '2px' }} aria-hidden />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {q?.topic && (
                    <span style={{ fontSize: '11px', color: 'var(--gw-teal-light)', background: 'var(--gw-teal-dim)', padding: '2px 8px', borderRadius: '10px', alignSelf: 'flex-start' }}>
                      {q.topic}
                    </span>
                  )}
                  <span style={{ fontSize: '14px', color: 'var(--gw-text)', lineHeight: 1.5 }}>
                    {q?.question ?? `Question ${i + 1}`}
                  </span>
                </div>
              </div>
              <div style={{ paddingLeft: '26px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {!r.is_correct && (
                  <div style={{ fontSize: '12px', color: '#F0997B' }}>Your answer: {answers[r.question_id] || '—'}</div>
                )}
                <div style={{ fontSize: '12px', color: 'var(--gw-teal-light)' }}>Correct: {r.correct_answer}</div>
                {r.explanation && (
                  <div style={{ fontSize: '12px', color: 'var(--gw-muted)', marginTop: '4px', lineHeight: 1.5 }}>{r.explanation}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={reset} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '10px 18px', borderRadius: 'var(--gw-radius-sm)',
          fontSize: '13px', fontWeight: 500, cursor: 'pointer',
          background: 'var(--gw-teal)', border: 'none', color: '#fff',
        }}>
          <i className="ti ti-refresh" aria-hidden /> New quiz
        </button>
        <button onClick={() => router.push('/dashboard/gaps')} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '10px 18px', borderRadius: 'var(--gw-radius-sm)',
          fontSize: '13px', cursor: 'pointer',
          background: 'transparent', border: '0.5px solid var(--gw-border2)', color: 'var(--gw-text)',
        }}>
          <i className="ti ti-chart-radar" aria-hidden /> View gaps
        </button>
      </div>
    </div>
  )
}