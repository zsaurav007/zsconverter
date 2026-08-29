'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import JSZip from 'jszip'
import { Settings2, UploadCloud, Layers, Eraser, Trash2, Maximize, X, Download, Eye, Loader2, FileArchive } from 'lucide-react'
import { removeBackground, Config } from '@imgly/background-removal'
import CustomDropdown from './CustomDropdown'

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })

const optimizeImageForAI = async (imageSrc: string): Promise<string> => {
  const img = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return imageSrc
  
  const MAX_DIM = 1200
  let width = img.width
  let height = img.height

  if (width > MAX_DIM || height > MAX_DIM) {
    if (width > height) {
      height = Math.round((height * MAX_DIM) / width)
      width = MAX_DIM
    } else {
      width = Math.round((width * MAX_DIM) / height)
      height = MAX_DIM
    }
  }
  
  canvas.width = width
  canvas.height = height
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.95)
}

interface ProcessedResult {
  blob: Blob | null
  extension: string
  url: string
  width: number
  height: number
}

export default function BatchProcessor() {
  const [files, setFiles] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const [exportFormat, setExportFormat] = useState('image/webp-lossless')
  const [quality, setQuality] = useState(90)
  
  // Resizing State
  const [resizeWidth, setResizeWidth] = useState<number | ''>('')
  const [resizeHeight, setResizeHeight] = useState<number | ''>('')
  const [maintainRatio, setMaintainRatio] = useState(true)
  const [presetSize, setPresetSize] = useState('custom')
  
  const [enableBgRemoval, setEnableBgRemoval] = useState(false)
  const [bgModel, setBgModel] = useState('briaai/RMBG-1.4')

  // Preview & Individual Actions State
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewData, setPreviewData] = useState<ProcessedResult | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)

  // Batch Zip State
  const [batchZipUrl, setBatchZipUrl] = useState<string | null>(null)
  const [batchZipName, setBatchZipName] = useState<string | null>(null)

  const hfCache = useRef<any>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles])
  }, [])
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, 
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
  })

  // Clear ZIP download if settings or files change to prevent stale downloads
  useEffect(() => {
    if (batchZipUrl) {
      URL.revokeObjectURL(batchZipUrl)
      setBatchZipUrl(null)
      setBatchZipName(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, exportFormat, quality, resizeWidth, resizeHeight, maintainRatio, enableBgRemoval, bgModel])

  const removeFile = (indexToRemove: number) => {
    setFiles(files.filter((_, index) => index !== indexToRemove))
    if (previewIndex === indexToRemove) setPreviewIndex(null)
  }
  
  const clearAll = () => {
    setFiles([])
    setPreviewIndex(null)
  }

  const handlePresetChange = (val: string) => {
    setPresetSize(val)
    if (val !== 'custom') {
      const [w, h] = val.split('x').map(Number)
      setResizeWidth(w)
      setResizeHeight(h)
      setMaintainRatio(false) 
    }
  }

  // Master processing engine for Individual previews, downloads, and batch
  const processSingleFile = async (file: File): Promise<ProcessedResult> => {
    const fileUrl = URL.createObjectURL(file)
    let urlToProcess = fileUrl
    let finalWidth = 0
    let finalHeight = 0

    try {
      if (enableBgRemoval) {
        const optimized = await optimizeImageForAI(urlToProcess)
        let removedSuccessfully = false

        if (bgModel === 'briaai/RMBG-1.4') {
          try {
            if (!hfCache.current) {
              const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
              env.allowLocalModels = false;
              
              const model = await AutoModel.from_pretrained(bgModel, {
                config: { model_type: 'custom' } as any,
              });
              
              const processor = await AutoProcessor.from_pretrained(bgModel, {
                config: {
                  do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
                  image_mean: [0.5, 0.5, 0.5], feature_extractor_type: "ImageFeatureExtractor",
                  image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098,
                  size: { width: 1024, height: 1024 }
                } as any
              });
              
              hfCache.current = { model, processor, RawImage };
            }

            const { model, processor, RawImage } = hfCache.current;
            const imageToProcess = await RawImage.fromURL(optimized);
            const { pixel_values } = await processor(imageToProcess);
            
            const outputs = await model({ input: pixel_values });
            const outTensor = Object.values(outputs)[0] as any;
            
            if (!outTensor || !outTensor.data) throw new Error("Invalid tensor output");

            const maskWidth = outTensor.dims[3];
            const maskHeight = outTensor.dims[2];

            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = maskWidth;
            maskCanvas.height = maskHeight;
            const maskCtx = maskCanvas.getContext('2d');
            if (!maskCtx) throw new Error("Mask Context failed");

            const imgData = maskCtx.createImageData(maskWidth, maskHeight);
            for (let j = 0; j < outTensor.data.length; j++) {
               const val = Math.max(0, Math.min(255, Math.round(outTensor.data[j] * 255)));
               imgData.data[j * 4] = 0;     // R
               imgData.data[j * 4 + 1] = 0; // G
               imgData.data[j * 4 + 2] = 0; // B
               imgData.data[j * 4 + 3] = val; // Alpha
            }
            maskCtx.putImageData(imgData, 0, 0);

            const originalImg = await createImage(urlToProcess);
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = originalImg.width;
            finalCanvas.height = originalImg.height;
            const finalCtx = finalCanvas.getContext('2d');
            if (!finalCtx) throw new Error("Final context failed");

            finalCtx.drawImage(originalImg, 0, 0);
            finalCtx.globalCompositeOperation = 'destination-in';
            finalCtx.drawImage(maskCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
            
            urlToProcess = finalCanvas.toDataURL('image/png');
            removedSuccessfully = true;
          } catch (hfError) {
            console.warn("Manual RMBG-1.4 engine failed. Falling back to Imgly...", hfError);
          }
        }

        if (!removedSuccessfully) {
          const fallbackModel = bgModel === 'briaai/RMBG-1.4' ? 'isnet' : bgModel;
          const bgConfig: Config = { model: fallbackModel as any, output: { format: "image/png" } }
          const imageBlob = await removeBackground(optimized, bgConfig)
          urlToProcess = URL.createObjectURL(imageBlob)
        }
      }

      const img = await createImage(urlToProcess)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return { blob: null, extension: '', url: '', width: 0, height: 0 }

      let targetWidth = img.width
      let targetHeight = img.height
      
      const rw = typeof resizeWidth === 'number' ? resizeWidth : null;
      const rh = typeof resizeHeight === 'number' ? resizeHeight : null;

      if (rw || rh) {
        if (maintainRatio) {
          if (rw && rh) {
            const ratio = Math.min(rw / img.width, rh / img.height);
            targetWidth = Math.max(1, Math.round(img.width * ratio));
            targetHeight = Math.max(1, Math.round(img.height * ratio));
          } else if (rw) {
            targetWidth = rw;
            targetHeight = Math.max(1, Math.round((img.height * rw) / img.width));
          } else if (rh) {
            targetHeight = rh;
            targetWidth = Math.max(1, Math.round((img.width * rh) / img.height));
          }
        } else {
          targetWidth = rw || img.width;
          targetHeight = rh || img.height;
        }
      }

      finalWidth = targetWidth;
      finalHeight = targetHeight;
      canvas.width = targetWidth
      canvas.height = targetHeight

      if (exportFormat === 'image/jpeg') {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, targetWidth, targetHeight)
      }
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

      let mimeType = exportFormat
      let compressionTarget = quality / 100
      if (exportFormat === 'image/webp-lossless' || exportFormat === 'image/png') compressionTarget = 1.0 
      if (exportFormat === 'image/webp-lossless') mimeType = 'image/webp'

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), mimeType, compressionTarget)
      })

      const extension = mimeType.split('/')[1]
      const newUrl = canvas.toDataURL(mimeType, compressionTarget)

      return { blob, extension, url: newUrl, width: finalWidth, height: finalHeight }
    } finally {
      URL.revokeObjectURL(fileUrl)
    }
  }

  // --- Dynamic Preview Rendering ---
  useEffect(() => {
    let isMounted = true
    let timer: NodeJS.Timeout

    if (previewIndex !== null && files[previewIndex]) {
      setIsPreviewLoading(true)
      timer = setTimeout(async () => {
        try {
          const result = await processSingleFile(files[previewIndex])
          if (isMounted) setPreviewData(result)
        } catch (e) {
          console.error("Preview generation failed")
        } finally {
          if (isMounted) setIsPreviewLoading(false)
        }
      }, 500) // Debounce generation to avoid lag while adjusting sliders
    }

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [previewIndex, files, exportFormat, quality, resizeWidth, resizeHeight, maintainRatio, enableBgRemoval, bgModel])

  const handleSingleDownload = async (index: number) => {
    setDownloadingIndex(index)
    try {
      const file = files[index]
      const { blob, extension } = await processSingleFile(file)
      if (blob) {
        const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
        const finalUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = finalUrl
        link.download = `${originalName}_zs_converter.${extension}`
        link.click()
        URL.revokeObjectURL(finalUrl)
      }
    } catch (e) {
      alert("Failed to process and download image.")
    } finally {
      setDownloadingIndex(null)
    }
  }

  const handleBatchProcess = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProgress({ current: 0, total: files.length })
    const zip = new JSZip()

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const { blob, extension } = await processSingleFile(file)

        if (blob) {
          const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name
          zip.file(`${originalName}_zs_converter.${extension}`, blob)
        }
        setProgress({ current: i + 1, total: files.length })
      }

      const zipContent = await zip.generateAsync({ type: 'blob' })
      const downloadUrl = URL.createObjectURL(zipContent)
      
      setBatchZipUrl(downloadUrl)
      setBatchZipName(`batch_${Date.now()}_zs_converter.zip`)

    } catch (error) {
      alert("An error occurred during batch processing.")
    } finally {
      setIsProcessing(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const isLosslessFormat = exportFormat === 'image/png' || exportFormat === 'image/webp-lossless'

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row h-auto lg:h-[650px] min-h-[650px]">
        
        {/* Settings Panel */}
        <div className="w-full lg:w-80 h-auto lg:h-full bg-slate-50 p-4 lg:p-6 border-t lg:border-t-0 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col gap-4 lg:gap-6 overflow-y-auto order-2 lg:order-1">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest border-b pb-4 flex items-center gap-2 flex-shrink-0">
            <Settings2 className="w-4 h-4"/> Batch Pipeline
          </h3>
          
          <div className="space-y-3 flex-shrink-0">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Output Format</label>
            <CustomDropdown 
              value={exportFormat} 
              onChange={setExportFormat} 
              disabled={isProcessing}
              direction="down"
              options={[
                { value: 'image/png', label: 'PNG (Lossless)' },
                { value: 'image/webp-lossless', label: 'WebP (Lossless)' },
                { value: 'image/webp', label: 'WebP (Lossy Compression)' },
                { value: 'image/jpeg', label: 'JPG / JPEG (Lossy)' }
              ]}
            />
          </div>

          {!isLosslessFormat && (
            <div className="space-y-3 flex-shrink-0">
              <div className="flex justify-between text-xs font-bold text-slate-700 uppercase tracking-wider">
                <span>Quality</span>
                <span className="text-[#6384A3]">{quality}%</span>
              </div>
              <input type="range" min="10" max="100" value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={isProcessing} className="w-full accent-[#6384A3] disabled:opacity-50" />
            </div>
          )}

          {/* Resizing Options */}
          <div className="space-y-3 border-t border-slate-200 pt-4 flex-shrink-0">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Maximize className="w-4 h-4 text-[#6384A3]"/> Dimension & Resizing
            </label>
            
            <CustomDropdown 
              value={presetSize} 
              onChange={handlePresetChange} 
              disabled={isProcessing}
              direction="down"
              options={[
                { value: 'custom', label: 'Custom Freeform' },
                { value: '600x600', label: 'US Passport (2x2 in) - 600x600' },
                { value: '413x531', label: 'UK/EU Passport - 413x531' },
                { value: '354x472', label: 'Stamp Size - 354x472' },
                { value: '1920x1080', label: 'Full HD (1080p) - 1920x1080' },
                { value: '1280x720', label: 'HD (720p) - 1280x720' },
                { value: '1080x1080', label: 'Instagram Square - 1080x1080' },
              ]}
            />

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Width (px)</label>
                <input 
                  type="number" 
                  placeholder="Auto" 
                  value={resizeWidth} 
                  onChange={(e) => { setResizeWidth(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                  disabled={isProcessing} 
                  className="w-full p-2 border border-slate-200 rounded text-sm bg-white disabled:opacity-50" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Height (px)</label>
                <input 
                  type="number" 
                  placeholder="Auto" 
                  value={resizeHeight} 
                  onChange={(e) => { setResizeHeight(e.target.value ? Number(e.target.value) : ''); setPresetSize('custom'); }} 
                  disabled={isProcessing} 
                  className="w-full p-2 border border-slate-200 rounded text-sm bg-white disabled:opacity-50" 
                />
              </div>
            </div>
            
            <label className="flex items-center gap-2 mt-2 text-[11px] font-semibold text-slate-600 cursor-pointer">
              <input 
                type="checkbox" 
                checked={maintainRatio} 
                onChange={(e) => setMaintainRatio(e.target.checked)} 
                disabled={isProcessing} 
                className="w-3.5 h-3.5 accent-[#6384A3] rounded disabled:opacity-50 cursor-pointer" 
              />
              Maintain Aspect Ratio (Fit Inside)
            </label>
          </div>

          {/* Batch AI Removal */}
          <div className="space-y-3 border-t border-slate-200 pt-4 flex-shrink-0">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider cursor-pointer">
              <input type="checkbox" checked={enableBgRemoval} onChange={(e) => setEnableBgRemoval(e.target.checked)} disabled={isProcessing} className="w-4 h-4 accent-[#6384A3] rounded disabled:opacity-50" />
              <Eraser className="w-4 h-4 text-[#6384A3]"/> Remove Background
            </label>
            {enableBgRemoval && (
              <div className="animate-in fade-in space-y-2 pt-2">
                <p className="text-[10px] text-orange-600 font-bold uppercase tracking-widest">Note: AI background Removal on large batches may take a long time.</p>
                <CustomDropdown 
                  value={bgModel} 
                  onChange={setBgModel} 
                  disabled={isProcessing}
                  direction="up"
                  options={[
                    { value: 'briaai/RMBG-1.4', label: 'Pro AI (Best for Objects & Products)' },
                    { value: 'isnet_fp16', label: 'Standard AI (Best for People & Faces)' },
                    { value: 'isnet', label: 'Maximum Detail AI (Best for Hair & Edges)' }
                  ]}
                />
              </div>
            )}
          </div>

          <div className="mt-auto pt-6 border-t border-slate-200 flex-shrink-0 space-y-3">
            <button onClick={handleBatchProcess} disabled={isProcessing || files.length === 0} className="w-full py-3 bg-[#6384A3] text-white font-bold rounded-lg hover:bg-[#4f6a83] disabled:opacity-50 shadow-md transition-colors flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
              {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin"/> {progress.current}/{progress.total} Processing</> : <><Layers className="w-4 h-4"/> Start Batch Job</>}
            </button>
            
            {/* Show Download Button if ZIP is Ready */}
            {batchZipUrl && !isProcessing && (
              <a href={batchZipUrl} download={batchZipName || 'batch_download.zip'} className="w-full py-3 bg-slate-800 text-white font-bold rounded-lg hover:bg-black shadow-md transition-colors flex items-center justify-center gap-2 text-xs uppercase tracking-widest animate-in zoom-in-95">
                <FileArchive className="w-4 h-4" /> Download ZIP
              </a>
            )}
          </div>
        </div>

        {/* Dropzone & Queue */}
        <div className="flex-1 p-4 lg:p-8 flex flex-col relative min-h-[400px] lg:min-h-full order-1 lg:order-2 bg-slate-50">
          {files.length > 0 && !isProcessing && (
            <button onClick={clearAll} className="absolute top-2 lg:top-4 right-2 lg:right-4 z-10 bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition-colors shadow-sm">
              <Trash2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Clear Queue</span>
            </button>
          )}

          <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-6 lg:p-8 mb-4 lg:mb-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-white ${isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-slate-50'} ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}>
            <input {...getInputProps()} />
            <UploadCloud className={`w-8 h-8 lg:w-10 lg:h-10 mb-3 ${isDragActive ? 'text-[#6384A3]' : 'text-slate-400'}`} />
            <h3 className="text-base lg:text-lg font-bold text-slate-700 mb-1">Add Images to Batch</h3>
            <p className="text-xs text-slate-500">Drag & drop files, or tap to browse</p>
          </div>

          {/* Compact Inline Preview Viewer (Light Theme) */}
          {previewIndex !== null && files[previewIndex] && (
            <div className="mb-4 lg:mb-6 bg-white rounded-xl border border-slate-200 p-4 relative shadow-sm flex flex-col sm:flex-row items-center gap-6 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
              <button 
                onClick={() => setPreviewIndex(null)} 
                className="absolute top-2 right-2 text-slate-400 hover:text-slate-800 transition-colors bg-slate-100 rounded-full p-1"
                title="Close Preview"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="w-32 h-32 md:w-40 md:h-40 flex-shrink-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iI2ZmZiI+PC9yZWN0Pgo8cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNlNWU3ZWIiPjwvcmVjdD4KPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNlNWU3ZWIiPjwvcmVjdD4KPC9zdmc+')] rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden relative shadow-inner">
                {isPreviewLoading ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#6384A3] mb-1" />
                    <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">Rendering</span>
                  </div>
                ) : previewData ? (
                  <img src={previewData.url} alt="Live Preview" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-red-500 text-[10px] uppercase font-bold tracking-widest text-center px-2">Preview Failed</span>
                )}
              </div>

              <div className="flex flex-col text-slate-600 text-xs w-full">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-[#6384A3]" />
                  <h4 className="font-bold text-slate-800 uppercase tracking-widest">Live Setup Preview</h4>
                </div>
                <p className="mb-3 truncate max-w-[200px] sm:max-w-xs">{files[previewIndex].name}</p>
                
                {previewData && !isPreviewLoading && (
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div>
                      <span className="block text-[9px] uppercase tracking-widest text-slate-500 mb-0.5">Final Resolution</span>
                      <span className="font-bold text-[#6384A3]">{previewData.width} x {previewData.height} px</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase tracking-widest text-slate-500 mb-0.5">Output Format</span>
                      <span className="font-bold text-[#6384A3]">{previewData.extension.toUpperCase()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="flex-1 bg-white border border-slate-200 rounded-lg p-3 lg:p-4 overflow-y-auto">
              <div className="flex justify-between items-center mb-3 lg:mb-4 border-b pb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{files.length} Files Queued</span>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className={`relative group rounded-lg overflow-hidden border ${previewIndex === index ? 'border-[#6384A3] ring-2 ring-[#6384A3]/30' : 'border-slate-200 hover:border-slate-300'} aspect-square bg-slate-100 flex items-center justify-center transition-all`}>
                    <img src={URL.createObjectURL(file)} alt="Thumbnail" className="w-full h-full object-cover" />
                    
                    {/* Interactive Overlay */}
                    {!isProcessing && (
                      <>
                        <div className="absolute top-1 right-1 flex flex-col gap-1 z-20">
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeFile(index); }} 
                            className="bg-red-500/90 text-white p-1.5 rounded-full w-6 h-6 flex items-center justify-center shadow hover:bg-red-600 transition-colors"
                            title="Remove file"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        
                        <div 
                          className="absolute inset-0 z-10 cursor-pointer" 
                          onClick={() => setPreviewIndex(index)}
                          title="Click to Preview Settings on this Image"
                        />
                      </>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 bg-black/75 text-white text-[10px] p-1.5 flex justify-between px-2 z-20 items-center">
                      <span className="truncate pr-2 cursor-default">{file.name}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSingleDownload(index); }} 
                        disabled={downloadingIndex !== null}
                        className="text-white hover:text-[#6384A3] bg-white/20 p-1 rounded transition-colors disabled:opacity-50"
                        title="Download Individually"
                      >
                        {downloadingIndex === index ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}