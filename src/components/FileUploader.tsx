'use client'

import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud } from 'lucide-react'

interface FileUploaderProps {
  onFileSelect: (file: File) => void
}

export default function FileUploader({ onFileSelect }: FileUploaderProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0])
    }
  }, [onFileSelect])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp']
    },
    maxFiles: 1
  })

  return (
    <div 
      {...getRootProps()} 
      className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
        isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-100/50'
      }`}
    >
      <input {...getInputProps()} />
      <UploadCloud className={`w-12 h-12 mb-4 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-400'}`} />
      <h3 className="text-lg font-bold text-slate-700 mb-1">
        {isDragActive ? 'Drop your image here' : 'Drag & drop an image'}
      </h3>
      <p className="text-xs text-slate-500">
        Supports PNG, JPG, JPEG, and WebP
      </p>
    </div>
  )
}