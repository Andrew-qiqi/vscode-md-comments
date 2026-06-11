export interface ParsedMeta {
  author: string;
  date: string;
  type: string;
  body: string;
}

export interface CommentMatch {
  id: string;
  start: number;
  end: number;
  highlighted: string;
  rawMeta: string;
  meta: ParsedMeta;
  full: string;
}

export const COMMENT_REGEX = /\{==([\s\S]+?)==\}\{>>([\s\S]+?)<<\}/g;

export function parseMeta(meta: string): ParsedMeta {
  const newFmt = meta.match(/^([^|]+)\|([^|]+)\|([A-Z]+):\s*([\s\S]*)$/);
  if (newFmt) {
    return {
      author: newFmt[1].trim(),
      date: newFmt[2].trim(),
      type: newFmt[3].trim(),
      body: newFmt[4].trim(),
    };
  }

  const oldFmt = meta.match(/^([^|]+)\|([^|:]+):\s*([\s\S]*)$/);
  if (oldFmt) {
    return {
      author: oldFmt[1].trim(),
      date: oldFmt[2].trim(),
      type: "NOTE",
      body: oldFmt[3].trim(),
    };
  }

  return { author: "", date: "", type: "NOTE", body: meta };
}

export function getCommentHash(commentStr: string): string {
  let hash = 0;
  for (let i = 0; i < commentStr.length; i++) {
    const chr = commentStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function parseAllComments(text: string): CommentMatch[] {
  const regex = new RegExp(COMMENT_REGEX);
  let m: RegExpExecArray | null;
  const matches: CommentMatch[] = [];
  const seenHashes: Record<string, number> = {};

  while ((m = regex.exec(text))) {
    const full = m[0];
    const highlighted = m[1];
    const rawMeta = m[2];
    const meta = parseMeta(rawMeta);
    
    const hash = getCommentHash(full);
    let id = `comment-${hash}`;
    if (seenHashes[hash] === undefined) {
      seenHashes[hash] = 0;
    } else {
      seenHashes[hash]++;
      id += `-${seenHashes[hash]}`;
    }

    matches.push({
      id,
      start: m.index,
      end: m.index + full.length,
      highlighted,
      rawMeta,
      meta,
      full
    });
  }

  return matches;
}
