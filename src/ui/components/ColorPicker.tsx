import { useCallback, useEffect, useRef, useState } from 'react';
import { useColorPicker } from '../hooks/useGameState';
import { setColorPickerRgb, createBlock } from '../hooks/useCommands';
import './ColorPicker.css';

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) { rr = c; gg = x; }
  else if (h < 120) { rr = x; gg = c; }
  else if (h < 180) { gg = c; bb = x; }
  else if (h < 240) { gg = x; bb = c; }
  else if (h < 300) { rr = x; bb = c; }
  else { rr = c; bb = x; }
  return [rr + m, gg + m, bb + m];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export function ColorPicker() {
  const { open, r, g, b } = useColorPicker();
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(r, g, b));
  const [hexInput, setHexInput] = useState(() => toHex(r, g, b));
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const svDrag = useRef(false);
  const hueDrag = useRef(false);

  useEffect(() => { setHsv(rgbToHsv(r, g, b)); setHexInput(toHex(r, g, b)); }, [r, g, b]);

  const pushRgb = useCallback((nr: number, ng: number, nb: number) => {
    setColorPickerRgb(nr, ng, nb); setHexInput(toHex(nr, ng, nb));
  }, []);

  const updateFromHsv = useCallback((h: number, s: number, v: number) => {
    setHsv([h, s, v]); const [nr, ng, nb] = hsvToRgb(h, s, v); pushRgb(nr, ng, nb);
  }, [pushRgb]);

  const handleSv = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = svRef.current?.getBoundingClientRect(); if (!rect) return;
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    updateFromHsv(hsv[0], s, v);
  }, [hsv, updateFromHsv]);

  const handleHue = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = hueRef.current?.getBoundingClientRect(); if (!rect) return;
    const h = Math.max(0, Math.min(359.9, ((e.clientX - rect.left) / rect.width) * 360));
    updateFromHsv(h, hsv[1], hsv[2]);
  }, [hsv, updateFromHsv]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (svDrag.current) handleSv(e); if (hueDrag.current) handleHue(e); };
    const onUp = () => { svDrag.current = false; hueDrag.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [handleSv, handleHue]);

  if (!open) return null;
  const hex = toHex(r, g, b);
  const hueColor = `hsl(${hsv[0]}, 100%, 50%)`;

  return (
    <div className="color-picker-panel">
      <h2 className="cp-title">CREATE BLOCK</h2>
      <div className="cp-preview-area">
        <div className="cp-preview" style={{ backgroundColor: hex }} />
        <input className="cp-hex-input" value={hexInput}
          onChange={e => { setHexInput(e.target.value); const p = hexToRgb(e.target.value); if (p) pushRgb(...p); }}
          onKeyDown={e => e.stopPropagation()} />
      </div>
      <div ref={svRef} className="cp-sv-area"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onMouseDown={e => { svDrag.current = true; handleSv(e); }}>
        <div className="cp-sv-thumb" style={{ left: `${hsv[1]*100}%`, top: `${(1-hsv[2])*100}%` }} />
      </div>
      <div ref={hueRef} className="cp-hue-bar" onMouseDown={e => { hueDrag.current = true; handleHue(e); }}>
        <div className="cp-hue-thumb" style={{ left: `${(hsv[0]/360)*100}%` }} />
      </div>
      <div className="cp-sliders">
        {([['R', 'cp-label-r', r, (v: number) => pushRgb(v, g, b)],
           ['G', 'cp-label-g', g, (v: number) => pushRgb(r, v, b)],
           ['B', 'cp-label-b', b, (v: number) => pushRgb(r, g, v)]] as const).map(([label, cls, val, setter]) => (
          <div key={label} className="cp-slider-row">
            <span className={`cp-label ${cls}`}>{label}</span>
            <input type="range" min="0" max="1" step="0.004" value={val}
              onChange={e => setter(parseFloat(e.target.value))} />
            <span className="cp-value">{Math.round(val * 255)}</span>
          </div>
        ))}
      </div>
      <button className="cp-create-btn" onClick={createBlock}>Create Block</button>
      <span className="cp-hint">C: close</span>
    </div>
  );
}
