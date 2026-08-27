'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import heavy, browser-only components to completely bypass SSR build crashes
const FileUploader = dynamic(() => import('@/components/FileUploader'), { ssr: false })
const PhotoEditor = dynamic(() => import('@/components/PhotoEditor'), { ssr: false })
const PdfEditor = dynamic(() => import('@/components/PdfEditor'), { ssr: false })
const BatchProcessor = dynamic(() => import('@/components/BatchProcessor'), { ssr: false })
const AiConverter = dynamic(() => import('@/components/AiConverter'), { ssr: false })
const QrGenerator = dynamic(() => import('@/components/QrGenerator'), { ssr: false })
const PaletteExtractor = dynamic(() => import('@/components/PaletteExtractor'), { ssr: false })

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
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 sm:p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        
        <header className="text-center space-y-4 sm:space-y-6">
          <div className="px-2">
            <h1 className="text-2xl sm:text-3xl font-light tracking-widest text-slate-700">ZS CONVERTER</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto mt-2">
              A fast, private, browser-based toolkit. Developed by Zulkarnain Saurav (+8801615201545)
            </p>
          </div>

          {/* Responsive Nav Bar: Scrollable horizontally on mobile, wrapped/centered on desktop */}
          <div className="relative w-full max-w-full mx-auto">
            <div className="flex sm:inline-flex flex-nowrap sm:flex-wrap justify-start sm:justify-center bg-slate-200/50 p-1 rounded-lg gap-1 overflow-x-auto max-w-full scroll-smooth w-full sm:w-auto shadow-inner">
              <button 
                onClick={() => setAppMode('image')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'image' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Single Image
              </button>
              <button 
                onClick={() => setAppMode('batch')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'batch' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Batch Processor
              </button>
              <button 
                onClick={() => setAppMode('pdf')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'pdf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                PDF Tools
              </button>
              <button 
                onClick={() => setAppMode('ai')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'ai' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                AI Converter
              </button>
              <button 
                onClick={() => setAppMode('palette')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'palette' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Color Palette
              </button>
              <button 
                onClick={() => setAppMode('qr')} 
                className={`flex-shrink-0 px-4 py-2.5 sm:py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'qr' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                QR Code
              </button>
            </div>
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