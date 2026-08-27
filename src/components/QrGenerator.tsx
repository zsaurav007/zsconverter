'use client'

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { Settings2, Download, Link2, ScanLine } from 'lucide-react'

export default function QrGenerator() {
  const [text, setText] = useState('https://zsconverter.vercel.app/')
  const [qrUrl, setQrUrl] = useState<string>('')
  const [darkColor, setDarkColor] = useState('#000000')

  useEffect(() => {
    generateQR()
  }, [text, darkColor])

  const generateQR = async () => {
    try {
      const url = await QRCode.toDataURL(text || ' ', {
        width: 1024,
        margin: 2,
        color: { dark: darkColor, light: '#ffffff' }
      })
      setQrUrl(url)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDownload = () => {
    if (!qrUrl) return
    const link = document.createElement('a')
    link.href = qrUrl
    
    // Safely format the text for a valid file name (limit length and remove invalid characters)
    const safeText = text.trim().replace(/[^a-z0-9]/gi, '_').substring(0, 30).replace(/_+/g, '_').replace(/^_|_$/g, '')
    const fileName = `${safeText || 'qr'}_zs_converter.png`
    
    link.download = fileName
    link.click()
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
      <div className="w-full lg:w-80 h-auto lg:h-full bg-slate-50 p-4 lg:p-6 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col gap-4 lg:gap-6 overflow-y-auto">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
          <Settings2 className="w-4 h-4"/> QR Configuration
        </h3>
        
        <div className="space-y-3 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            <Link2 className="w-3 h-3"/> Content URL or Text
          </label>
          <textarea 
            value={text} 
            onChange={(e) => setText(e.target.value)} 
            rows={4} 
            placeholder="Enter URL or text here..." 
            className="w-full p-3 border border-slate-200 rounded text-sm bg-white resize-none"
          />
        </div>

        <div className="space-y-3 flex-shrink-0 pt-2 lg:pt-4 border-t border-slate-200">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Code Color</label>
          <div className="flex gap-2">
            <input type="color" value={darkColor} onChange={(e) => setDarkColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200" />
            <input type="text" value={darkColor.toUpperCase()} onChange={(e) => setDarkColor(e.target.value)} className="flex-1 p-2 border border-slate-200 rounded text-sm bg-white font-mono" />
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-200 flex-shrink-0">
          <button onClick={handleDownload} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] shadow-md transition-colors flex items-center justify-center gap-2">
            <Download className="w-4 h-4"/> Download PNG
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 md:p-8 bg-slate-100 flex flex-col items-center justify-center min-h-[400px] lg:min-h-full">
        {qrUrl ? (
          <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 border border-slate-200 max-w-full">
            <img src={qrUrl} alt="Generated QR Code" className="w-full max-w-[256px] h-auto object-contain" />
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate w-full max-w-[250px] text-center">
              {text || 'Empty'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-400">
            <ScanLine className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm font-bold">Waiting for input...</p>
          </div>
        )}
      </div>
    </div>
  )
}