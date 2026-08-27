'use client'

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { useDropzone } from 'react-dropzone'
import { Settings2, Download, Link2, ScanLine, QrCode, UploadCloud, Copy, ExternalLink, CheckCircle2 } from 'lucide-react'

export default function QrGenerator() {
  // Mode State
  const [mode, setMode] = useState<'generate' | 'scan'>('generate')

  // Generator State
  const [text, setText] = useState('https://zsconverter.vercel.app/')
  const [qrUrl, setQrUrl] = useState<string>('')
  const [darkColor, setDarkColor] = useState('#000000')

  // Scanner State
  const [scanImage, setScanImage] = useState<string | null>(null)
  const [scannedResult, setScannedResult] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [copied, setCopied] = useState(false)

  // --- GENERATOR LOGIC ---
  useEffect(() => {
    if (mode === 'generate') {
      generateQR()
    }
  }, [text, darkColor, mode])

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
    
    const safeText = text.trim().replace(/[^a-z0-9]/gi, '_').substring(0, 30).replace(/_+/g, '_').replace(/^_|_$/g, '')
    const fileName = `${safeText || 'qr'}_zs_converter.png`
    
    link.download = fileName
    link.click()
  }

  // --- SCANNER LOGIC ---
  const onDropScan = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    const file = acceptedFiles[0]
    setIsScanning(true)
    setScannedResult(null)

    const imageUrl = URL.createObjectURL(file)
    setScanImage(imageUrl)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setIsScanning(false)
        return
      }

      // Scale down if image is massive to prevent memory spikes on old devices
      const MAX_DIM = 1500
      let width = img.width
      let height = img.height
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM } 
        else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM }
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      
      const imageData = ctx.getImageData(0, 0, width, height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" })
      
      if (code) {
        setScannedResult(code.data)
      } else {
        setScannedResult("ERROR: No valid QR code detected in this image.")
      }
      setIsScanning(false)
    }
    img.src = imageUrl
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropScan,
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] },
    maxFiles: 1
  })

  const copyToClipboard = () => {
    if (scannedResult) {
      navigator.clipboard.writeText(scannedResult)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const isValidUrl = (string: string) => {
    try { new URL(string); return true } 
    catch (_) { return false }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
      
      {/* Sidebar Settings */}
      <div className="w-full lg:w-80 h-auto lg:h-full bg-slate-50 p-4 lg:p-6 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col gap-4 lg:gap-6 overflow-y-auto">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
          <Settings2 className="w-4 h-4"/> QR Studio
        </h3>

        {/* Mode Toggle */}
        <div className="flex bg-slate-200/50 p-1 rounded-lg flex-shrink-0 shadow-inner">
          <button onClick={() => setMode('generate')} className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded transition-all ${mode === 'generate' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <QrCode className="w-3.5 h-3.5 inline mb-0.5 mr-1"/> Generate
          </button>
          <button onClick={() => setMode('scan')} className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded transition-all ${mode === 'scan' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <ScanLine className="w-3.5 h-3.5 inline mb-0.5 mr-1"/> Scan
          </button>
        </div>
        
        {mode === 'generate' ? (
          <>
            <div className="space-y-3 flex-shrink-0 animate-in fade-in">
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

            <div className="space-y-3 flex-shrink-0 pt-2 lg:pt-4 border-t border-slate-200 animate-in fade-in">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Code Color</label>
              <div className="flex gap-2">
                <input type="color" value={darkColor} onChange={(e) => setDarkColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 p-0 bg-transparent" />
                <input type="text" value={darkColor.toUpperCase()} onChange={(e) => setDarkColor(e.target.value)} className="flex-1 p-2 border border-slate-200 rounded text-sm bg-white font-mono uppercase" />
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-slate-200 flex-shrink-0 animate-in fade-in">
              <button onClick={handleDownload} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] shadow-md transition-colors flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
                <Download className="w-4 h-4"/> Download PNG
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col animate-in fade-in space-y-4">
             <div className="space-y-2">
               <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                 Upload Image to Scan
               </label>
               <p className="text-xs text-slate-400">Select an image containing a QR code. It will be scanned locally in your browser.</p>
             </div>
             
             {scannedResult && !scannedResult.startsWith('ERROR:') && (
               <div className="mt-auto border border-green-200 bg-green-50 rounded-lg p-4 space-y-3 animate-in slide-in-from-bottom-2">
                 <h4 className="text-[10px] font-bold text-green-700 uppercase tracking-widest flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> Scan Success</h4>
                 <div className="p-2 bg-white rounded border border-green-100 max-h-32 overflow-y-auto">
                   <p className="text-sm font-mono text-slate-700 break-all">{scannedResult}</p>
                 </div>
                 <div className="flex gap-2">
                   <button onClick={copyToClipboard} className="flex-1 py-2 bg-white border border-green-200 text-green-700 font-bold rounded text-[10px] uppercase tracking-widest hover:bg-green-100 transition-colors flex items-center justify-center gap-1 shadow-sm">
                     {copied ? 'Copied!' : <><Copy className="w-3 h-3"/> Copy</>}
                   </button>
                   {isValidUrl(scannedResult) && (
                     <a href={scannedResult} target="_blank" rel="noopener noreferrer" className="flex-1 py-2 bg-green-600 text-white font-bold rounded text-[10px] uppercase tracking-widest hover:bg-green-700 transition-colors flex items-center justify-center gap-1 shadow-sm">
                       <ExternalLink className="w-3 h-3"/> Open
                     </a>
                   )}
                 </div>
               </div>
             )}
             
             {scannedResult?.startsWith('ERROR:') && (
                <div className="mt-auto p-3 bg-red-50 border border-red-100 rounded-lg text-xs font-bold text-red-600">
                  {scannedResult}
                </div>
             )}
          </div>
        )}
      </div>

      {/* Main Visual Area */}
      <div className="flex-1 p-6 md:p-8 bg-slate-100 flex flex-col items-center justify-center min-h-[400px] lg:min-h-full">
        {mode === 'generate' ? (
          <>
            {qrUrl ? (
              <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 border border-slate-200 max-w-full animate-in zoom-in-95">
                <img src={qrUrl} alt="Generated QR Code" className="w-full max-w-[256px] h-auto object-contain" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate w-full max-w-[250px] text-center">
                  {text || 'Empty'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-slate-400">
                <QrCode className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm font-bold">Waiting for input...</p>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col">
            <div {...getRootProps()} className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors p-6 overflow-hidden relative ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-50'}`}>
              <input {...getInputProps()} />
              
              {scanImage ? (
                <img src={scanImage} alt="Uploaded QR" className="max-w-full max-h-full object-contain drop-shadow-md z-10" />
              ) : (
                <div className="z-10 flex flex-col items-center text-slate-500">
                  <UploadCloud className={`w-10 h-10 lg:w-12 lg:h-12 mb-4 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-300'}`} />
                  <h3 className="text-sm lg:text-base font-bold text-slate-700 mb-1">Upload QR Code Image</h3>
                  <p className="text-xs text-slate-400 mt-1">Drag & drop or tap to browse</p>
                </div>
              )}

              {isScanning && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
                  <ScanLine className="w-8 h-8 text-[#6384A3] animate-pulse mb-3" />
                  <p className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Scanning Code...</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}