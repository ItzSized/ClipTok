'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Petits contrôles de formulaire homogènes (thème sombre) pour les panneaux d'édition. */

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="pb-4 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-zinc-400 flex justify-between gap-2">
        {label}
        {hint && <span className="text-zinc-600 font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">{format ? format(value) : Math.round(value * 100) / 100}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(Math.min(max, Math.max(min, 0)))}
        className="w-full accent-fuchsia-500 cursor-pointer"
      />
    </div>
  );
}

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="font-semibold text-zinc-400">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-zinc-500 uppercase">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-8 h-8 rounded-lg bg-transparent border border-white/10 cursor-pointer"
        />
      </span>
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between gap-3 text-xs w-full">
      <span className="font-semibold text-zinc-400">{label}</span>
      <span className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-fuchsia-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-500 cursor-pointer ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-black/40 border border-white/10 rounded-lg p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1 ${
            value === o.value ? 'bg-white text-black' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 0.01,
  min,
  max,
  className = '',
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      className={`bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-white outline-none focus:border-fuchsia-500 w-full ${className}`}
    />
  );
}

export function ProgressBar({ percent, message }: { percent: number; message?: string }) {
  const indeterminate = percent < 0;
  return (
    <div className="flex flex-col gap-1.5">
      {message && (
        <div className="flex justify-between text-xs text-zinc-400">
          <span className="truncate">{message}</span>
          {!indeterminate && <span className="font-mono">{Math.round(percent)}%</span>}
        </div>
      )}
      <div className="h-1.5 w-full bg-black/60 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r from-fuchsia-500 to-orange-400 transition-all duration-300 ${indeterminate ? 'animate-pulse w-full opacity-60' : ''}`}
          style={indeterminate ? undefined : { width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

export function formatTime(seconds: number, withMs = false) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${m}:${String(sec).padStart(2, '0')}`;
  if (!withMs) return base;
  return `${base}.${String(Math.floor((s % 1) * 100)).padStart(2, '0')}`;
}
