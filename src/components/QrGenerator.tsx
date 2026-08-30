'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { useDropzone } from 'react-dropzone'
import { 
  Settings2, Download, Link2, ScanLine, QrCode, 
  UploadCloud, Copy, ExternalLink, CheckCircle2, 
  Camera, Image as ImageIcon, X 
} from 'lucide-react'

export default function QrGenerator() {
  // Mode State
  const [mode, setMode] = useState<'generate' | 'scan'>('generate')
  const [scanMethod, setScanMethod] = useState<'file' | 'camera'>('file')

  // Generator State
  const [text, setText] = useState('https://zsconverter.vercel.app/')
  const [qrUrl, setQrUrl] = useState<string>('')
  const [darkColor, setDarkColor] = useState('#000000')
  const [logoImage, setLogoImage] = useState<string | null>(null)

  // Scanner State
  const [scanImage, setScanImage] = useState<string | null>(null)
  const [scannedResult, setScannedResult] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [copied, setCopied] = useState(false)

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // --- GENERATOR LOGIC ---
  useEffect(() => {
    if (mode === 'generate') {
      generateQR()
    }
  }, [text, darkColor, logoImage, mode])

  const generateQR = async () => {
    try {
      // Use higher error correction if a logo is present to ensure it remains scannable
      const errorCorrectionLevel = logoImage ? 'H' : 'M'

      const canvas = document.createElement('canvas')
      await QRCode.toCanvas(canvas, text || ' ', {
        width: 1024,
        margin: 2,
        color: { dark: darkColor, light: '#ffffff' },
        errorCorrectionLevel
      })

      // Draw uploaded logo onto the canvas if it exists
      if (logoImage) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.src = logoImage
          await new Promise((resolve, reject) => { 
            img.onload = resolve
            img.onerror = reject
          })

          const logoSize = canvas.width * 0.25 // Logo takes up 25% of the code
          const offset = (canvas.width - logoSize) / 2

          // Draw a white background square to ensure the logo is visible and scannable
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(offset - 16, offset - 16, logoSize + 32, logoSize + 32)
          
          ctx.drawImage(img, offset, offset, logoSize, logoSize)
        }
      }

      setQrUrl(canvas.toDataURL('image/png'))
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

  // --- FILE SCANNER LOGIC ---
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

  // --- CAMERA SCANNER LOGIC ---
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
    setIsCameraActive(false)
  }, [])

  const startCamera = async () => {
    setCameraError(null)
    setScannedResult(null)
    try {
      let stream: MediaStream;
      try {
        // Broadened constraints to safely prompt on all iOS/Android devices
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      } catch (e) {
        // Fallback if environment explicit facing mode fails
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true') // Crucial for iOS webkit
        await videoRef.current.play()
        setIsCameraActive(true)
        requestAnimationFrame(scanCameraFrame)
      }
    } catch (err) {
      setCameraError("Camera access denied or unavailable. Please check your browser permissions.")
      setIsCameraActive(false)
    }
  }

  const scanCameraFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.srcObject) return // Stop loop if camera was turned off

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" })
        
        if (code) {
          setScannedResult(code.data)
          stopCamera()
          return // Found code, kill loop
        }
      }
    }
    // Continue loop
    requestAnimationFrame(scanCameraFrame)
  }, [stopCamera])

  // Stop camera when unmounting or switching modes
  useEffect(() => {
    if (mode === 'generate' || scanMethod === 'file') {
      stopCamera()
    }
    return () => stopCamera()
  }, [mode, scanMethod, stopCamera])

  // --- UTILS ---
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

            <div className="space-y-3 flex-shrink-0 pt-2 lg:pt-4 border-t border-slate-200 animate-in fade-in">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Center Logo / Image</label>
                {logoImage && (
                  <button onClick={() => setLogoImage(null)} className="text-[9px] text-red-500 font-bold uppercase hover:underline tracking-widest">
                    Remove
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {logoImage ? (
                  <img src={logoImage} alt="Logo" className="w-10 h-10 rounded border border-slate-200 object-cover bg-white" />
                ) : (
                  <div className="w-10 h-10 rounded border border-dashed border-slate-300 flex items-center justify-center bg-slate-50">
                    <ImageIcon className="w-4 h-4 text-slate-400" />
                  </div>
                )}
                <button onClick={() => document.getElementById('logo-upload')?.click()} className="flex-1 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-colors shadow-sm">
                  {logoImage ? 'Change Image' : 'Upload Image'}
                </button>
                <input type="file" id="logo-upload" accept="image/*" className="hidden" onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setLogoImage(URL.createObjectURL(e.target.files[0]))
                  }
                }} />
              </div>
              <p className="text-[9px] text-slate-400 leading-tight">
                * QR codes can only store text. To share a large file/image, upload it to a cloud drive and paste the link in the text box above. You can upload an image here to embed as a logo.
              </p>
            </div>

            <div className="mt-auto pt-6 border-t border-slate-200 flex-shrink-0 animate-in fade-in">
              <button onClick={handleDownload} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] shadow-md transition-colors flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
                <Download className="w-4 h-4"/> Download PNG
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col animate-in fade-in space-y-4">
              
             {/* Sub-toggle for Scan Method */}
             <div className="flex bg-slate-100 p-1 rounded border border-slate-200">
               <button onClick={() => setScanMethod('file')} className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded transition-all ${scanMethod === 'file' ? 'bg-white shadow-sm text-[#6384A3]' : 'text-slate-500 hover:text-slate-700'}`}>
                 <ImageIcon className="w-3 h-3 inline mr-1 mb-0.5" /> Image
               </button>
               <button onClick={() => setScanMethod('camera')} className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded transition-all ${scanMethod === 'camera' ? 'bg-white shadow-sm text-[#6384A3]' : 'text-slate-500 hover:text-slate-700'}`}>
                 <Camera className="w-3 h-3 inline mr-1 mb-0.5" /> Camera
               </button>
             </div>

             <div className="space-y-2">
               <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                 {scanMethod === 'file' ? 'Upload Image to Scan' : 'Live Camera Scan'}
               </label>
               <p className="text-[11px] text-slate-400">
                 {scanMethod === 'file' 
                   ? 'Select an image containing a QR code. It will be scanned locally in your browser.' 
                   : 'Point your camera at a QR code to instantly scan it without saving photos.'}
               </p>
             </div>
             
             {/* Scan Success Box */}
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
             
             {/* Scan Error Box */}
             {(scannedResult?.startsWith('ERROR:') || cameraError) && (
                <div className="mt-auto p-3 bg-red-50 border border-red-100 rounded-lg text-xs font-bold text-red-600">
                  {scannedResult || cameraError}
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
          <div className="w-full h-full flex flex-col relative">
            
            {scanMethod === 'file' ? (
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
            ) : (
              // Live Camera Viewport
              <div className="flex-1 bg-black rounded-xl overflow-hidden relative flex items-center justify-center border border-slate-200 shadow-inner group">
                
                {/* AutoPlay, playsInline, and muted are crucial for iOS camera functionality */}
                <video 
                  ref={videoRef} 
                  className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`} 
                  autoPlay
                  playsInline 
                  muted 
                />

                {!isCameraActive && (
                   <div className="flex flex-col items-center text-slate-400 z-10 absolute">
                     <Camera className="w-12 h-12 mb-4 opacity-50 text-white" />
                     <button onClick={startCamera} className="px-6 py-2.5 bg-[#6384A3] text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-[#4f6a83] transition-colors shadow-lg">
                       Enable Camera
                     </button>
                   </div>
                )}
                
                {isCameraActive && (
                  <>
                    {/* Viewfinder Overlay */}
                    <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center">
                      <div className="w-48 h-48 border-2 border-[#6384A3]/60 relative">
                        <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white" />
                        <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white" />
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white" />
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white" />
                        {/* Animated Scan Line */}
                        <div className="w-full h-0.5 bg-green-400/80 absolute shadow-[0_0_8px_rgba(74,222,128,1)] animate-[scan_2s_ease-in-out_infinite]" />
                      </div>
                      <p className="text-white font-bold text-[10px] uppercase tracking-widest mt-4 drop-shadow-md bg-black/40 px-3 py-1 rounded">Point at QR Code</p>
                    </div>
                    {/* Stop Camera Button (Hidden until hover/touch) */}
                    <button onClick={stopCamera} className="absolute top-4 right-4 z-20 bg-black/60 text-white p-2 rounded-full hover:bg-red-500 transition-colors opacity-100 lg:opacity-0 group-hover:opacity-100">
                       <X className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            )}
            
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}} />
    </div>
  )
}