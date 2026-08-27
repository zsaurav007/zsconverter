'use client'

import PdfEditor from '@/components/PdfEditor'

export default function PdfToolsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            PDF & Document Tools
          </h1>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            Extract high-quality images from PDFs or combine multiple images into a single document entirely in your browser.
          </p>
        </header>

        <PdfEditor />
      </div>
    </main>
  )
}