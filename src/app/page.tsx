'use client'

import { useState } from 'react'
import FileUploader from '@/components/FileUploader'
import PhotoEditor from '@/components/PhotoEditor'
import PdfEditor from '@/components/PdfEditor'
import BatchProcessor from '@/components/BatchProcessor'
import AiConverter from '@/components/AiConverter'
import QrGenerator from '@/components/QrGenerator'
import PaletteExtractor from '@/components/PaletteExtractor'

export default function Home() {
  const [appMode, setAppMode] = useState<'image' | 'pdf' | 'batch' | 'ai' | 'qr' | 'palette'>('image')
  const [activeFile, setActiveFile] = useState<File | null>(null)

  const handleFileSelect = (file: File) => {
    setActiveFile(file)
  }

  const handleCancel = () => setActiveFile(null)

  const handleComplete = (finalImageUrl: string) => {
    const link = document.createElement('a')
    link.href = finalImageUrl
    link.download = `zsconverter-output-${Date.now()}.png`
    link.click()
    setActiveFile(null)
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="text-center space-y-6">
          <div>
            <h1 className="text-3xl font-light tracking-wider text-slate-600">ZS CONVERTER</h1>
            <p className="text-sm text-slate-500 max-w-lg mx-auto mt-2">
              A fast, private, browser-based media toolkit. Developed by Zulkarnain Saurav (+8801615201545).
            </p>
          </div>

          <div className="inline-flex bg-slate-200/50 p-1 rounded-lg flex-wrap justify-center gap-1 max-w-full">
            <button onClick={() => setAppMode('image')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'image' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Single Image
            </button>
            <button onClick={() => setAppMode('batch')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'batch' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Batch Processor
            </button>
            <button onClick={() => setAppMode('pdf')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'pdf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              PDF Tools
            </button>
            <button onClick={() => setAppMode('ai')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'ai' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              AI Converter
            </button>
            <button onClick={() => setAppMode('palette')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'palette' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Color Palette
            </button>
            <button onClick={() => setAppMode('qr')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'qr' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              QR Code
            </button>
          </div>
        </header>

        {appMode === 'image' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {!activeFile ? (
              <FileUploader onFileSelect={handleFileSelect} />
            ) : (
              <PhotoEditor file={activeFile} onCancel={handleCancel} onComplete={handleComplete} />
            )}
          </div>
        )}

        {appMode === 'batch' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <BatchProcessor />
          </div>
        )}

        {appMode === 'pdf' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PdfEditor />
          </div>
        )}

        {appMode === 'ai' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <AiConverter />
          </div>
        )}

        {appMode === 'palette' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PaletteExtractor />
          </div>
        )}

        {appMode === 'qr' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <QrGenerator />
          </div>
        )}
      </div>
    </main>
  )
}