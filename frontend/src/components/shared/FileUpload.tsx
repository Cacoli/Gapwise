'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ALLOWED_EXTENSIONS = ['.pdf', '.md', '.txt']
const MAX_SIZE_MB = 10

export default function FileUpload({ onUploadComplete }: { onUploadComplete?: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext))
      return 'File type not allowed. Use PDF, MD, or TXT.'
    if (file.size > MAX_SIZE_MB * 1024 * 1024)
      return `File too large. Max ${MAX_SIZE_MB}MB allowed.`
    return null
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    setError('')
    setSuccess('')

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      setUploading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated. Please log in.')
      setUploading(false)
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    const storagePath = `${user.id}/${Date.now()}_${file.name}`

    const { error: storageError } = await supabase.storage
      .from('user-upload')
      .upload(storagePath, file)

    if (storageError) {
      setError('Upload failed: ' + storageError.message)
      setUploading(false)
      return
    }

    const { error: dbError } = await supabase
      .from('uploaded_files')
      .insert({
        user_id: user.id,
        file_name: file.name,
        file_type: ext,
        storage_path: storagePath,
        status: 'pending',
      })

    if (dbError) {
  setError('Failed to save file info: ' + dbError.message)
} else {
  // Trigger ingestion pipeline
  const { data: fileRecord } = await supabase
    .from('uploaded_files')
    .select('id')
    .eq('storage_path', storagePath)
    .single()

  if (fileRecord) {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/ingest/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: fileRecord.id,
        user_id: user.id,
        file_name: file.name,
        file_type: ext,
        storage_path: storagePath,
      })
    })
  }

  setSuccess(`"${file.name}" uploaded and processing started!`)
  onUploadComplete?.()
}

    setUploading(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white">Upload Files</CardTitle>
        <p className="text-gray-400 text-sm">
          Supports PDF, Markdown (.md), and Text (.txt) — max 10MB
        </p>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-blue-500 bg-blue-950'
              : 'border-gray-700 hover:border-gray-500'
          }`}
        >
          <p className="text-4xl mb-3">📄</p>
          <p className="text-white font-medium">Drag & drop your file here</p>
          <p className="text-gray-400 text-sm mt-1">or click to browse</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.md,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {uploading && <p className="text-blue-400 text-sm mt-3">Uploading...</p>}
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mt-3">✅ {success}</p>}
      </CardContent>
    </Card>
  )
}