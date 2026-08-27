'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
}

interface CustomDropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  direction?: 'down' | 'up'
}

export default function CustomDropdown({ options, value, onChange, disabled = false, direction = 'down' }: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(opt => opt.value === value) || options[0]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full p-2.5 border border-slate-200 rounded text-sm bg-white font-semibold flex justify-between items-center transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#6384A3]'}`}
      >
        <span className="truncate">{selectedOption?.label}</span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen && direction === 'down' ? 'rotate-180' : ''} ${isOpen && direction === 'up' ? 'rotate-0' : ''} ${!isOpen && direction === 'up' ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div 
          className={`absolute z-[100] w-full bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden animate-in fade-in ${
            direction === 'up' 
              ? 'bottom-full mb-1 slide-in-from-bottom-2' 
              : 'top-full mt-1 slide-in-from-top-2'
          }`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${value === option.value ? 'bg-slate-50 text-[#6384A3] font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}