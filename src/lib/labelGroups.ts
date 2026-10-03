// Helpers for showing grouped options (e.g. products grouped by lab) compactly.

export type GroupedOption = { value: string; label: string; group?: string };

/** Shared leading words of labels ("STEM Starter Lab Android", "… Windows" → "STEM Starter Lab"). */
export function commonPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  const words = labels.map((l) => l.split(' '));
  const out: string[] = [];
  for (let i = 0; i < words[0].length; i++) {
    const w = words[0][i];
    if (words.every((ws) => ws[i] === w && ws.length > i + 1)) out.push(w);
    else break;
  }
  return out.join(' ');
}

/** Consecutive options with the same group, in order; ungrouped options come back separately. */
export function splitGroups<T extends GroupedOption>(options: T[]): {
  ungrouped: T[];
  groups: Array<{ key: string; title: string; items: Array<T & { short: string }> }>;
} {
  const ungrouped: T[] = [];
  const groups: Array<{ key: string; title: string; items: Array<T & { short: string }> }> = [];
  for (const opt of options) {
    if (!opt.group) { ungrouped.push(opt); continue; }
    const last = groups[groups.length - 1];
    if (last && last.key === opt.group) last.items.push({ ...opt, short: opt.label });
    else groups.push({ key: opt.group, title: '', items: [{ ...opt, short: opt.label }] });
  }
  for (const g of groups) {
    g.title = commonPrefix(g.items.map((i) => i.label));
    if (g.title) for (const i of g.items) i.short = i.label.slice(g.title.length).trim() || i.label;
  }
  return { ungrouped, groups };
}
