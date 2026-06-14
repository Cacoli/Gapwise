'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface UploadedFile {
  id: string
  file_name: string
  file_type: string
  storage_path: string
  status: 'done' | 'pending' | 'processing' | 'failed'
  chunks_count?: number
  created_at: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 86400000) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function pushDeletedFile(fileName: string) {
  try {
    const raw = localStorage.getItem('gw_deleted_files')
    const existing = raw ? JSON.parse(raw) : []
    const updated = [
      { file_name: fileName, deleted_at: new Date().toISOString() },
      ...existing,
    ].filter((f: any) => Date.now() - new Date(f.deleted_at).getTime() < 30 * 86400000)
    localStorage.setItem('gw_deleted_files', JSON.stringify(updated))
  } catch {}
}

export default function NotesPage() {
  const router   = useRouter()
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [userId,       setUserId]       = useState<string | null>(null)
  const [files,        setFiles]        = useState<UploadedFile[]>([])
  const [loading,      setLoading]      = useState(true)
  const [uploading,    setUploading]    = useState(false)
  const [reprocessing, setReprocessing] = useState<string | null>(null)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [error,        setError]        = useState('')
  const [dragOver,     setDragOver]     = useState(false)

  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUserId(data.user.id)
    })
  }, [])

  useEffect(() => {
    if (!userId) return
    fetchFiles()
  }, [userId])

  const fetchFiles = async () => {
    const { data } = await supabase
      .from('uploaded_files')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    setFiles(data ?? [])
    setLoading(false)
  }

  const handleUpload = async (file: File) => {
    if (!userId) return
    setError('')
    setUploading(true)
    try {
      const ext         = file.name.split('.').pop() ?? ''
      const storagePath = `${userId}/${Date.now()}_${file.name}`

      const { error: storageErr } = await supabase.storage
        .from('user-upload')
        .upload(storagePath, file)
      if (storageErr) throw new Error(storageErr.message)

      const { data: row, error: dbErr } = await supabase
        .from('uploaded_files')
        .insert({
          user_id:      userId,
          file_name:    file.name,
          file_type:    ext,
          storage_path: storagePath,
          status:       'pending',
        })
        .select()
        .single()
      if (dbErr) throw new Error(dbErr.message)

      await fetch(`${API}/api/v1/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id:      row.id,
          user_id:      userId,
          file_name:    file.name,
          file_type:    ext,
          storage_path: storagePath,
        }),
      })

      await fetchFiles()
    } catch (e: any) {
      setError(e.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  const deleteFile = async (id: string, storagePath: string, fileName: string) => {
    setDeleting(id)
    setError('')
    try {
      await supabase.storage.from('user-upload').remove([storagePath])

      const res = await fetch(`${API}/api/v1/ingest/${id}?user_id=${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Backend delete failed')

      await supabase.from('quiz_sessions').delete().eq('file_id', id)
      await supabase.from('topics').delete().eq('user_id', userId)

      // Save to localStorage for Recently Deleted tab
      pushDeletedFile(fileName)

      setFiles(prev => prev.filter(f => f.id !== id))
      window.location.href = '/dashboard'
    } catch (e: any) {
      setError(e.message ?? 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const reprocessFile = async (f: UploadedFile) => {
    setReprocessing(f.id)
    setError('')
    try {
      await supabase.from('uploaded_files').update({ status: 'pending' }).eq('id', f.id)
      await fetch(`${API}/api/v1/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id:      f.id,
          user_id:      userId,
          file_name:    f.file_name,
          file_type:    f.file_type,
          storage_path: f.storage_path,
        }),
      })
      await fetchFiles()
    } catch (e: any) {
      setError(e.message ?? 'Re-process failed')
    } finally {
      setReprocessing(null)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--gw-muted)' }}>
      Loading...
    </div>
  )

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div>
        <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--gw-text)', margin: 0 }}>Notes</h1>
        <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: '4px 0 0' }}>Upload your study notes to analyse gaps and generate quizzes</p>
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--gw-teal)' : 'var(--gw-border2)'}`,
          borderRadius: 'var(--gw-radius)',
          padding: '36px 24px',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: dragOver ? 'var(--gw-teal-dim)' : 'var(--gw-bg2)',
          transition: 'all 0.15s',
        }}
      >
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" onChange={onFileChange} style={{ display: 'none' }} />
        <i className="ti ti-cloud-upload" style={{ fontSize: '28px', color: 'var(--gw-muted2)', display: 'block', marginBottom: '10px' }} aria-hidden />
        {uploading ? (
          <p style={{ fontSize: '14px', color: 'var(--gw-teal-light)', margin: 0 }}>Uploading...</p>
        ) : (
          <>
            <p style={{ fontSize: '14px', color: 'var(--gw-text)', margin: '0 0 4px' }}>Drop a file or click to browse</p>
            <p style={{ fontSize: '12px', color: 'var(--gw-muted)', margin: 0 }}>PDF, TXT, MD supported</p>
          </>
        )}
      </div>

      {error && (
        <div style={{ fontSize: '13px', color: '#F0997B', padding: '10px 14px', background: 'var(--gw-coral-dim)', borderRadius: 'var(--gw-radius-sm)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '13px', color: 'var(--gw-muted)', marginBottom: '4px' }}>
          {files.length} file{files.length !== 1 ? 's' : ''} uploaded
        </div>
        {files.length === 0 ? (
          <div style={{ background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)', borderRadius: 'var(--gw-radius)', padding: '32px', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--gw-muted)', margin: 0 }}>No files yet — upload your first note above</p>
          </div>
        ) : (
          files.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--gw-bg2)', border: '0.5px solid var(--gw-border)',
              borderRadius: 'var(--gw-radius)', padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <i className="ti ti-file-text" style={{ fontSize: '18px', color: 'var(--gw-muted2)', flexShrink: 0 }} aria-hidden />
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--gw-text)' }}>{f.file_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--gw-muted)', marginTop: '2px' }}>
                    {f.chunks_count ? `${f.chunks_count} chunks · ` : ''}{formatDate(f.created_at)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 500, padding: '3px 8px', borderRadius: '10px',
                  background: f.status === 'done' ? 'var(--gw-teal-dim)' : f.status === 'failed' ? 'var(--gw-coral-dim)' : 'var(--gw-amber-dim)',
                  color: f.status === 'done' ? 'var(--gw-teal-light)' : f.status === 'failed' ? '#F0997B' : 'var(--gw-amber)',
                }}>
                  {f.status}
                </span>
                <button
                  onClick={() => reprocessFile(f)}
                  disabled={reprocessing === f.id}
                  title="Re-process"
                  style={{
                    background: 'transparent', border: 'none', padding: '4px',
                    cursor: reprocessing === f.id ? 'not-allowed' : 'pointer',
                    color: 'var(--gw-muted2)',
                  }}
                >
                  <i className={reprocessing === f.id ? 'ti ti-loader-2' : 'ti ti-refresh'} style={{ fontSize: '15px' }} aria-hidden />
                </button>
                <button
                  onClick={() => deleteFile(f.id, f.storage_path, f.file_name)}
                  disabled={deleting === f.id}
                  title="Delete file"
                  style={{
                    background: 'transparent', border: 'none', padding: '4px',
                    cursor: deleting === f.id ? 'not-allowed' : 'pointer',
                    color: deleting === f.id ? 'var(--gw-muted2)' : '#F0997B',
                  }}
                >
                  <i className={deleting === f.id ? 'ti ti-loader-2' : 'ti ti-trash'} style={{ fontSize: '15px' }} aria-hidden />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}