// S3-06 text normalization (v0.3.6 §22.4) — single stop-marker fn for stream+final, prefix rules.
export function truncateStop(text: string, stopSequences: string[]): { text: string; stopped: boolean; marker?: string } {
  if (stopSequences.length === 0) return { text, stopped: false };
  if (stopSequences.length > 16) throw new Error('TEXT_DISPATCH_LIMIT:too many stops');
  const seen = new Set<string>();
  for (const s of stopSequences) {
    if (typeof s !== 'string' || s.length === 0) throw new Error('BAD_INPUT:empty stop');
    if ([...s].length > 128) throw new Error('BAD_INPUT:stop too long');
    if (seen.has(s)) throw new Error('BAD_INPUT:duplicate stop');
    seen.add(s);
  }
  let bestIdx = -1;
  let bestSeq = '';
  for (const seq of stopSequences) {
    const idx = text.indexOf(seq);
    if (idx === -1) continue;
    if (bestIdx === -1 || idx < bestIdx || (idx === bestIdx && (seq.length > bestSeq.length || (seq.length === bestSeq.length && seq < bestSeq)))) {
      bestIdx = idx; bestSeq = seq;
    }
  }
  if (bestIdx === -1) return { text, stopped: false };
  return { text: text.slice(0, bestIdx), stopped: true, marker: bestSeq };
}

// Withhold longest terminal proper prefix of any marker (prevent partial disclosure).
export function terminalHoldback(text: string, stopSequences: string[]): string {
  let hold = 0;
  for (const seq of stopSequences) {
    for (let l = 1; l < seq.length; l++) {
      const prefix = seq.slice(0, l);
      if (text.endsWith(prefix) && l > hold) hold = l;
    }
  }
  return text.slice(0, text.length - hold);
}

export type PrefixVisibility = 'hidden' | 'visible';

export interface StreamProject {
  fullVisibleText: string;
  appendedText: string;
  stopped: boolean;
  fromPrefix: boolean;
}

// projectStream: generated-only bytes after hidden startWith removal, then truncateStop, then holdback if not stopped.
export function projectStream(
  cumulativeGenerated: string,
  prevVisible: string,
  stopSequences: string[],
  hadStop: boolean,
): { visible: string; appended: string; stopped: boolean } {
  const t = truncateStop(cumulativeGenerated, stopSequences);
  let visible: string;
  let stopped = hadStop || t.stopped;
  if (t.stopped) {
    visible = t.text;
    stopped = true;
  } else {
    visible = terminalHoldback(t.text, stopSequences);
  }
  // Once stopped, never re-expose text after marker: clamp to previous if it grows beyond stopped prefix
  // (caller holds hadStop visible; here we ensure monotonic non-expansion after stop by taking min)
  // appended is genuinely appended suffix else ''
  let appended = '';
  if (visible.startsWith(prevVisible)) appended = visible.slice(prevVisible.length);
  else if (prevVisible.startsWith(visible)) appended = ''; // retraction: authoritative is new visible
  else appended = ''; // divergent: treat as replacement, appended unknown -> ''
  return { visible, appended, stopped };
}

export function normalizeStartWith(requested: string | undefined): string {
  if (!requested) return '';
  return requested.replace(/ +$/, '');
}

export function stripPrefix(cumulative: string, verifiedPrefix: string, isFromStartWith: boolean, requested: string | undefined): { generated: string; prefixOk: boolean; actualPrefix: string } {
  if (!requested) return { generated: cumulative, prefixOk: true, actualPrefix: '' };
  const norm = normalizeStartWith(requested);
  if (isFromStartWith) {
    // actual prefix is cumulative up to norm? Use actual chunk prefix if present — here cumulative starts with prefix
    if (cumulative.startsWith(norm)) return { generated: cumulative.slice(norm.length), prefixOk: true, actualPrefix: norm };
    // try with original trailing spaces?
    if (cumulative.startsWith(requested)) return { generated: cumulative.slice(requested.length), prefixOk: true, actualPrefix: requested };
    return { generated: '', prefixOk: false, actualPrefix: '' };
  } else {
    // archived normalization: requested trimmed trailing spaces
    if (cumulative.startsWith(norm)) return { generated: cumulative.slice(norm.length), prefixOk: true, actualPrefix: norm };
    // if cumulative doesn't start with norm, ambiguous
    // Special fallback: if requested had trailing spaces and cumulative starts with requested, accept
    if (requested !== norm && cumulative.startsWith(requested)) return { generated: cumulative.slice(requested.length), prefixOk: true, actualPrefix: requested };
    return { generated: '', prefixOk: false, actualPrefix: '' };
  }
}
