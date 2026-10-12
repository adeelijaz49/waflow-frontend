// Pure helpers for the Instagram caption workbench (no Angular, unit-tested).

export type SegmentKind = 'plain' | 'hashtag' | 'mention' | 'url';
export interface Segment {
  kind: SegmentKind;
  text: string;
}

export const CAPTION_LIMITS = { chars: 2200, hashtags: 30, mentions: 20 } as const;
export const FOLD_CHARS = 125;
export const FOLD_LINES = 3;

const WORD = String.raw`\p{L}\p{N}\p{M}_`;
// group 1 = url, 2 = hashtag (needs at least one letter), 3 = mention
const TOKEN_SOURCE = String.raw`(https?:\/\/[^\s]+|www\.[^\s]+)|(?<![${WORD}])(#(?=[${WORD}]*\p{L})[${WORD}]+)|(?<![${WORD}.@])(@[A-Za-z0-9._]+)`;
const URL_TRAILING = new Set(Array.from(`.,;:!?)]}"'»«،؛؟…`));

function trimUrl(url: string): string {
  const chars = Array.from(url);
  while (chars.length > 1 && URL_TRAILING.has(chars[chars.length - 1])) chars.pop();
  return chars.join('');
}

// Splits text into plain / hashtag / mention / url segments.
export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  if (!text) return out;
  const re = new RegExp(TOKEN_SOURCE, 'gu');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let kind: SegmentKind;
    let value = m[0];
    if (m[1]) {
      kind = 'url';
      value = trimUrl(value);
    } else if (m[2]) {
      kind = 'hashtag';
    } else {
      kind = 'mention';
      value = value.replace(/[._]+$/, '');
      if (value.length < 2) {
        re.lastIndex = m.index + 1;
        continue;
      }
    }
    if (m.index > last) out.push({ kind: 'plain', text: text.slice(last, m.index) });
    out.push({ kind, text: value });
    last = m.index + value.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ kind: 'plain', text: text.slice(last) });
  return out;
}

export function lineSegments(text: string): Segment[][] {
  return normalizeNewlines(text)
    .split('\n')
    .map((line) => tokenize(line));
}

export interface CaptionStats {
  chars: number;
  hashtags: number;
  mentions: number;
  urls: number;
  lines: number;
}

// Characters are Unicode code points (an emoji counts as one, like Instagram).
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ch of text) n++;
  return n;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function captionStats(text: string): CaptionStats {
  const normalized = normalizeNewlines(text);
  const stats: CaptionStats = { chars: codePointLength(normalized), hashtags: 0, mentions: 0, urls: 0, lines: 0 };
  if (!normalized) return stats;
  stats.lines = normalized.split('\n').length;
  for (const seg of tokenize(normalized)) {
    if (seg.kind === 'hashtag') stats.hashtags++;
    else if (seg.kind === 'mention') stats.mentions++;
    else if (seg.kind === 'url') stats.urls++;
  }
  return stats;
}

// The part of the caption visible before "...more" (first 3 lines / 125 characters).
export function collapseCaption(text: string): { text: string; truncated: boolean } {
  const lines = normalizeNewlines(text).split('\n');
  let truncated = lines.length > FOLD_LINES;
  let kept = lines.slice(0, FOLD_LINES).join('\n');
  const points = Array.from(kept);
  if (points.length > FOLD_CHARS) {
    kept = points.slice(0, FOLD_CHARS).join('').trimEnd();
    truncated = true;
  }
  return { text: kept, truncated };
}

export type LimitState = 'ok' | 'near' | 'over';
export function limitState(value: number, limit: number): LimitState {
  if (value > limit) return 'over';
  return value >= Math.floor(limit * 0.9) ? 'near' : 'ok';
}

// Copy with the async clipboard API, falling back to a hidden textarea.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.insetInlineStart = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
