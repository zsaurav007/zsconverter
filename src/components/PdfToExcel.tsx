'use client'

import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { FileText, Download, CheckCircle2, FileSpreadsheet, AlertCircle, X, Loader2 } from 'lucide-react'

// PDF.js typing interfaces
interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

type PageMode = 'all' | 'custom' | 'except'

// Median helper used to derive per-page row/column tolerances
const median = (nums: number[]): number => {
  if (nums.length === 0) return 10
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export default function PdfToExcel() {
  const [activeFile, setActiveFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null)

  // Page Selection States
  const [pageMode, setPageMode] = useState<PageMode>('all')
  const [pageRange, setPageRange] = useState('')

  const showToast = useCallback((message: string) => {
    const id = Date.now()
    setToast({ message, id })
    setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
    }, 3000)
  }, [])

  // Initialize PDF.js worker securely for Next.js
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('pdfjs-dist').then((pdfjsLib) => {
        const isModernBrowser = 'noModule' in HTMLScriptElement.prototype
        pdfjsLib.GlobalWorkerOptions.workerSrc = isModernBrowser
          ? `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
          : `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.js`
      })
    }
  }, [])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setActiveFile(acceptedFiles[0])
      // Reset settings on new file upload
      setPageMode('all')
      setPageRange('')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  })

  // Helper to parse page range strings (e.g. "1-3, 5")
  const parsePageRange = (rangeStr: string, maxPages: number): Set<number> => {
    const pages = new Set<number>()
    if (!rangeStr.trim()) return pages

    const parts = rangeStr.split(',')
    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-')
        const start = parseInt(startStr, 10)
        const end = parseInt(endStr, 10)

        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.max(1, Math.min(start, end))
          const max = Math.min(maxPages, Math.max(start, end))
          for (let i = min; i <= max; i++) pages.add(i)
        }
      } else {
        const num = parseInt(trimmed, 10)
        if (!isNaN(num) && num >= 1 && num <= maxPages) {
          pages.add(num)
        }
      }
    }
    return pages
  }

  const processPdfToExcel = async () => {
    if (!activeFile) return

    // Quick validation before starting
    if ((pageMode === 'custom' || pageMode === 'except') && !pageRange.trim()) {
      alert("Please enter a valid page range.")
      return
    }

    setIsProcessing(true)
    setLoadingText('Initializing extraction...')

    try {
      // Yield to UI so the spinner renders
      await new Promise((r) => setTimeout(r, 50))

      const arrayBuffer = await activeFile.arrayBuffer()
      const pdfjsLib = await import('pdfjs-dist')
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      // Compute valid pages to extract
      const allowedPages = new Set<number>()
      if (pageMode === 'all') {
        for (let i = 1; i <= pdf.numPages; i++) allowedPages.add(i)
      } else {
        const parsedInput = parsePageRange(pageRange, pdf.numPages)
        if (pageMode === 'custom') {
          parsedInput.forEach(p => allowedPages.add(p))
        } else if (pageMode === 'except') {
          for (let i = 1; i <= pdf.numPages; i++) {
            if (!parsedInput.has(i)) allowedPages.add(i)
          }
        }
      }

      if (allowedPages.size === 0) {
        alert("No pages matched your selection. Please adjust your page range.")
        setIsProcessing(false)
        return
      }

      const allRows: string[][] = []

      // Loop through all selected pages
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (!allowedPages.has(pageNum)) continue // Skip excluded pages

        setLoadingText(`Analyzing tables on Page ${pageNum}...`)
        await new Promise((r) => setTimeout(r, 30)) // Yield to UI per page

        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const items = textContent.items as TextItem[]

        const validItems = items.filter((i) => i.str && i.str.trim().length > 0)
        if (validItems.length === 0) continue

        // --- Dynamic tolerances derived from this page's own typography ---
        // Row tolerance: based on the median glyph height on the page, so dense
        // small-font tables and sparse large-font tables are both handled well.
        const heights = validItems.map((i) => Math.abs(i.height) || Math.abs(i.transform[3]) || 10)
        const medianHeight = median(heights)
        const rowTolerance = Math.max(2, medianHeight * 0.45)

        // Column tolerance: based on median character width, so narrow-font
        // columns don't get merged and wide-font columns don't get split.
        const charWidths = validItems.map((i) => i.width / Math.max(1, i.str.trim().length))
        const medianCharWidth = median(charWidths)
        const colTolerance = Math.max(8, medianCharWidth * 2.2)

        // 1. Group items into rows: sort strictly top-to-bottom, then cluster
        // sequentially against the running row (not against every prior row),
        // which avoids accidentally re-merging into a much earlier row.
        const sortedByY = [...validItems].sort((a, b) => b.transform[5] - a.transform[5])

        type RowBucket = { y: number; items: { text: string; x: number }[] }
        const rows: RowBucket[] = []

        sortedByY.forEach((item) => {
          const x = item.transform[4]
          const y = item.transform[5]
          const text = item.str.trim()
          const lastRow = rows[rows.length - 1]

          if (lastRow && Math.abs(lastRow.y - y) <= rowTolerance) {
            lastRow.items.push({ text, x })
            // Nudge the row's reference Y toward incoming items to curb drift
            lastRow.y = (lastRow.y + y) / 2
          } else {
            rows.push({ y, items: [{ text, x }] })
          }
        })

        // 2. Identify columns via sequential X clustering: sort all X
        // positions ascending, then start a new column whenever the gap to
        // the previous cluster exceeds the tolerance. This is more stable
        // than comparing every X to a single fixed seed value.
        const sortedXs = [...new Set(validItems.map((i) => i.transform[4]))].sort((a, b) => a - b)
        const cols: number[] = []
        sortedXs.forEach((x) => {
          if (cols.length === 0 || x - cols[cols.length - 1] > colTolerance) {
            cols.push(x)
          } else {
            // Keep the cluster's reference point centered as more items join it
            cols[cols.length - 1] = (cols[cols.length - 1] + x) / 2
          }
        })

        // 3. Map the data into the calculated grid layout. Rows are already
        // top-to-bottom from step 1; items within each row are sorted
        // left-to-right so multi-fragment cells read in the correct order.
        rows.forEach((row) => {
          const rowData: string[] = new Array(cols.length).fill('')
          const orderedItems = [...row.items].sort((a, b) => a.x - b.x)

          orderedItems.forEach((item) => {
            let closestColIdx = 0
            let minDiff = Infinity
            cols.forEach((c, idx) => {
              const diff = Math.abs(item.x - c)
              if (diff < minDiff) {
                minDiff = diff
                closestColIdx = idx
              }
            })

            if (rowData[closestColIdx]) {
              rowData[closestColIdx] += ' ' + item.text
            } else {
              rowData[closestColIdx] = item.text
            }
          })

          // Trim trailing empty columns from the row to keep the sheet clean
          while (rowData.length > 0 && rowData[rowData.length - 1] === '') {
            rowData.pop()
          }

          if (rowData.length > 0) {
            allRows.push(rowData)
          }
        })

        // Add a blank row spacer between pages
        if (pageNum < pdf.numPages && allowedPages.size > 1) {
          allRows.push([])
        }
      }

      setLoadingText('Compiling Excel spreadsheet...')
      await new Promise((r) => setTimeout(r, 50)) // Final yield before compiling blob

      // Convert 2D Grid to SheetJS Worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(allRows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Extracted Data')

      // Generate File Buffer
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      // Trigger Native Download
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const originalName = activeFile.name.replace(/\.[^/.]+$/, '')
      link.download = `${originalName}_zs_converter.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      showToast('Excel file exported successfully!')
      setActiveFile(null) // Reset the UI
    } catch (error: any) {
      console.error('Extraction failed:', error)
      if (error.name === 'PasswordException') {
        alert('This PDF is password protected. Decrypt it first before extracting data.')
      } else {
        alert('Failed to parse this PDF. Please ensure it contains highlightable text, not just scanned images.')
      }
    } finally {
      setIsProcessing(false)
      setLoadingText('')
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-auto lg:h-[600px]">
        {/* Header */}
        <div className="p-4 lg:p-6 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#6384A3]" /> High-Accuracy PDF to Excel
          </h4>
        </div>

        {/* Work Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-100 overflow-y-auto">
          {!activeFile ? (
            <div className="w-full max-w-xl animate-in fade-in zoom-in-95 duration-200">
              <div
                {...getRootProps()}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-colors p-10 lg:p-16 text-center ${
                  isDragActive ? 'border-[#6384A3] bg-blue-50/50' : 'border-slate-300 hover:border-[#6384A3] hover:bg-white bg-slate-50'
                }`}
              >
                <input {...getInputProps()} />
                <FileText className="w-12 h-12 mb-4 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Select a PDF Document</h3>
                <p className="text-xs text-slate-500 mt-2">Drag & drop your file here, or click to browse</p>
              </div>

              <div className="mt-6 flex items-start gap-3 p-4 bg-amber-50 text-amber-800 rounded-lg border border-amber-200 shadow-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-bold uppercase tracking-wider block mb-1">Advanced Table Mapping:</span>
                  This tool calculates the geometric layout of the PDF to keep tables and columns structurally aligned in Excel. <strong>Note: It cannot extract data from flat images or scanned documents without OCR.</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
              <FileSpreadsheet className="w-12 h-12 text-[#6384A3] mb-3" />
              <h3 className="text-sm font-bold text-slate-800 text-center truncate w-full px-4">
                {activeFile.name}
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 mb-6">
                Ready for Extraction
              </p>

              {/* Advanced Page Selection UI */}
              <div className="w-full space-y-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block text-left">
                  Pages to Extract
                </label>
                <div className="flex bg-slate-200/50 p-1 rounded-lg w-full">
                  <button
                    onClick={() => setPageMode('all')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-colors ${pageMode === 'all' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    All Pages
                  </button>
                  <button
                    onClick={() => setPageMode('custom')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-colors ${pageMode === 'custom' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Custom
                  </button>
                  <button
                    onClick={() => setPageMode('except')}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-colors ${pageMode === 'except' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Exclude
                  </button>
                </div>

                {pageMode !== 'all' && (
                  <div className="animate-in fade-in slide-in-from-top-1 duration-200 pt-1">
                    <input
                      type="text"
                      placeholder="e.g. 1-3, 5, 8-10"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-[#6384A3] focus:ring-1 focus:ring-[#6384A3] transition-all"
                    />
                    <p className="text-[9px] text-slate-500 mt-2 text-left leading-tight">
                      {pageMode === 'custom'
                        ? "Enter the exact pages or ranges you want to extract."
                        : "Enter the pages or ranges you want to SKIP."}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex w-full gap-3 mt-auto">
                <button
                  onClick={() => setActiveFile(null)}
                  className="flex-[0.5] py-3.5 bg-slate-100 text-slate-600 font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-slate-200 transition-colors flex items-center justify-center shadow-sm"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={processPdfToExcel}
                  disabled={isProcessing}
                  className="flex-1 py-3.5 bg-[#6384A3] text-white font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-[#4f6a83] transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Extract to Excel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Synchronous Processing Overlay (Forces above everything) */}
      {isProcessing && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex flex-col items-center justify-center z-[200] animate-in fade-in duration-200">
          <div className="bg-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center min-w-[280px]">
            <Loader2 className="animate-spin w-8 h-8 text-[#6384A3] mb-4" />
            <p className="text-[10px] font-bold text-slate-800 uppercase tracking-widest text-center">
              {loadingText}
            </p>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-5 py-3 rounded-full shadow-2xl z-[300] animate-in slide-in-from-bottom-5 fade-in duration-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 pointer-events-none border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {toast.message}
        </div>
      )}
    </>
  )
}