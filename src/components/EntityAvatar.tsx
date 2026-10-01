import React from 'react';

// Soft tinted backgrounds; the same name always lands on the same colour.
const TONES = [
  'bg-violet-500/15 text-violet-500',
  'bg-sky-500/15 text-sky-500',
  'bg-emerald-500/15 text-emerald-600',
  'bg-amber-500/15 text-amber-600',
  'bg-rose-500/15 text-rose-500',
  'bg-indigo-500/15 text-indigo-500',
  'bg-teal-500/15 text-teal-600',
];

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Round initials badge for an entity (school / vendor / parent) in table rows. */
export default function EntityAvatar({ name, size = 28 }: { name: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const tone = TONES[Math.abs(hash) % TONES.length];
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-wide ${tone}`}
    >
      {initialsOf(name)}
    </span>
  );
}
