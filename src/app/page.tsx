'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import CustomDropdown from '@/components/CustomDropdown'

// Dynamically import heavy, browser-only components to completely bypass SSR build crashes
const FileUploader = dynamic(() => import('@/components/FileUploader'), { ssr: false })
const PhotoEditor = dynamic(() => import('@/components/PhotoEditor'), { ssr: false })
const PdfEditor = dynamic(() => import('@/components/PdfEditor'), { ssr: false })
const BatchProcessor = dynamic(() => import('@/components/BatchProcessor'), { ssr: false })
const AiConverter = dynamic(() => import('@/components/AiConverter'), { ssr: false })
const QrGenerator = dynamic(() => import('@/components/QrGenerator'), { ssr: false })
const PaletteExtractor = dynamic(() => import('@/components/PaletteExtractor'), { ssr: false })

type AppMode = 'image' | 'pdf' | 'batch' | 'ai' | 'qr' | 'palette'

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>('image')
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

  const navOptions = [
    { value: 'image', label: 'Single Image' },
    { value: 'batch', label: 'Batch Processor' },
    { value: 'pdf', label: 'PDF Tools' },
    { value: 'ai', label: 'AI Converter' },
    { value: 'palette', label: 'Color Palette' },
    { value: 'qr', label: 'QR Code' }
  ]

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 sm:p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        
        <header className="text-center space-y-4 sm:space-y-6">
          <div className="px-2">
            <h1 className="text-2xl sm:text-3xl font-light tracking-widest text-slate-700">ZS CONVERTER</h1>
            <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto mt-2">
              A fast, private, browser-based toolkit. Developed by Zulkarnain Saurav{' '}
              <a 
                href="mailto:zulkarnain.saurav@gmail.com" 
                title="zulkarnain.saurav@gmail.com"
                className="inline-flex items-center align-middle hover:text-slate-800 transition-colors mx-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </a>
              (+8801615201545)
            </p>
          </div>

          <div className="relative w-full max-w-full mx-auto flex flex-col items-center">
            
            {/* Mobile Nav: Dropdown (Visible only on small screens) */}
            <div className="w-full max-w-xs sm:hidden relative z-[100]">
              <CustomDropdown
                value={appMode}
                onChange={(val) => setAppMode(val as AppMode)}
                options={navOptions}
                direction="down"
              />
            </div>

            {/* Desktop Nav: Button Row (Visible only on sm and larger screens) */}
            <div className="hidden sm:inline-flex flex-wrap justify-center bg-slate-200/50 p-1 rounded-lg gap-1 max-w-full shadow-inner">
              <button 
                onClick={() => setAppMode('image')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'image' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Single Image
              </button>
              <button 
                onClick={() => setAppMode('batch')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'batch' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Batch Processor
              </button>
              <button 
                onClick={() => setAppMode('pdf')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'pdf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                PDF Tools
              </button>
              <button 
                onClick={() => setAppMode('ai')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'ai' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                AI File Converter
              </button>
              <button 
                onClick={() => setAppMode('palette')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'palette' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Color Palette
              </button>
              <button 
                onClick={() => setAppMode('qr')} 
                className={`flex-shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all whitespace-nowrap ${appMode === 'qr' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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