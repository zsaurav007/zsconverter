'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { ChevronDown } from 'lucide-react'

export interface DropdownOption { value: string; label: string }
interface CustomDropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  direction?: 'down' | 'up'
  searchable?: boolean
  searchPlaceholder?: string
  ariaLabel?: string
}

export default function CustomDropdown({ options, value, onChange, disabled=false, direction='down', searchable=false, searchPlaceholder='Search…', ariaLabel='Choose an option' }: CustomDropdownProps) {
  const [isOpen,setIsOpen]=useState(false)
  const [query,setQuery]=useState('')
  const [active,setActive]=useState(0)
  const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), search=useRef<HTMLInputElement>(null)
  const id=useId()
  const selected=options.find(o=>o.value===value)
  const filtered=options.filter(o=>!searchable || `${o.value} ${o.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const activeIndex=Math.min(active,Math.max(0,filtered.length-1))
  const open=isOpen && !disabled
  useEffect(()=>{
    const outside=(event:Event)=>{ if(!root.current?.contains(event.target as Node))setIsOpen(false) }
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside)}
  },[])
  useEffect(()=>{if(disabled)setIsOpen(false)},[disabled])
  useEffect(()=>{if(open && searchable)search.current?.focus()},[open,searchable])
  useEffect(()=>{if(open)document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({block:'nearest'})},[activeIndex,open,id,query])
  const show=()=>{setQuery('');setActive(Math.max(0,options.findIndex(o=>o.value===value)));setIsOpen(true)}
  const choose=(option:DropdownOption)=>{onChange(option.value);setIsOpen(false);trigger.current?.focus()}
  const keyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();setIsOpen(false);trigger.current?.focus();return}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault()
      if(!open){show();return}
      setActive(n=>filtered.length ? (Math.min(n,filtered.length-1)+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length : 0)
    } else if(event.key==='Home' && open && !searchable){event.preventDefault();setActive(0)}
    else if(event.key==='End' && open && !searchable){event.preventDefault();setActive(filtered.length-1)}
    else if(event.key==='Enter' && open){event.preventDefault();if(filtered[activeIndex])choose(filtered[activeIndex])}
  }
  return <div ref={root} style={{position:'relative',width:'100%'}} onKeyDown={keyDown}>
    <button ref={trigger} type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${id}-list`:undefined}
      onClick={()=>open?setIsOpen(false):show()} style={{width:'100%',padding:'11px 13px',border:'1px solid #cbd5e1',borderRadius:8,background:'#fff',color:'#334155',fontSize:14,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,opacity:disabled?.5:1,cursor:disabled?'not-allowed':'pointer'}}>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selected?.label ?? 'Select an option'}</span>
      <ChevronDown aria-hidden="true" style={{width:16,height:16,flexShrink:0,transform:(open !== (direction==='up'))?'rotate(180deg)':'none'}} />
    </button>
    {open && <div style={{position:'absolute',zIndex:100,width:'100%',top:direction==='down'?'100%':'auto',bottom:direction==='up'?'100%':'auto',marginTop:direction==='down'?4:0,marginBottom:direction==='up'?4:0,background:'#fff',border:'1px solid #cbd5e1',borderRadius:9,boxShadow:'0 12px 28px #17394a26',overflow:'hidden',maxHeight:'none'}}>
      {searchable && <div style={{padding:8,borderBottom:'1px solid #e2e8f0'}}>
        <input ref={search} type="search" value={query} placeholder={searchPlaceholder} aria-label={searchPlaceholder} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={filtered.length?`${id}-option-${activeIndex}`:undefined}
          onChange={event=>{setQuery(event.target.value);setActive(0)}} style={{width:'100%',height:40,minWidth:0,padding:'8px 10px',fontSize:14,fontWeight:400,border:'1px solid #cbd5e1',borderRadius:6,background:'#fff',color:'#172b3a'}} />
      </div>}
      <div id={`${id}-list`} role="listbox" aria-label={ariaLabel} style={{maxHeight:'min(280px,40vh)',overflowY:'auto',overscrollBehavior:'contain'}}>
        {filtered.map((option,index)=><button key={option.value} id={`${id}-option-${index}`} type="button" role="option" aria-selected={value===option.value} tabIndex={-1}
          onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)} style={{display:'block',width:'100%',textAlign:'left',padding:'11px 14px',border:0,borderRadius:0,fontSize:14,fontWeight:value===option.value?700:400,whiteSpace:'normal',background:index===activeIndex?'#eaf5f2':value===option.value?'#f1f5f9':'#fff',color:'#334155'}}>{option.label}</button>)}
        {!filtered.length && <p role="status" style={{padding:14,margin:0,color:'#64748b',fontSize:14}}>No matching options.</p>}
      </div>
    </div>}
  </div>
}
