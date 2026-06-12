export interface VisibleProjection {
  text: string;
  sourceOffsets: number[];
}

export interface PreviewSelectionPayload {
  selectedText: string;
  leftContext?: string;
  rightContext?: string;
}

export interface LocatedPreviewSelection {
  start: number;
  end: number;
}

export function buildVisibleProjection(source: string): VisibleProjection {
  let text = "";
  const sourceOffsets: number[] = [];
  let i = 0;
  let atLineStart = true;

  const append = (char: string, offset: number) => {
    text += char;
    sourceOffsets.push(offset);
  };

  while (i < source.length) {
    if (atLineStart) {
      const skipped = getBlockMarkerLength(source, i);
      if (skipped > 0) {
        i += skipped;
      }
      atLineStart = false;
    }

    if (source.startsWith("{==", i)) {
      const highlightEnd = source.indexOf("==}{>>", i + 3);
      if (highlightEnd !== -1) {
        const commentEnd = source.indexOf("<<}", highlightEnd + 6);
        if (commentEnd !== -1) {
          for (let j = i + 3; j < highlightEnd; j++) {
            append(source[j], j);
          }
          i = commentEnd + 3;
          continue;
        }
      }
    }

    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\r") {
      i++;
      continue;
    }

    if (ch === "\n") {
      append("\n", i);
      i++;
      atLineStart = true;
      continue;
    }

    if (ch === "\\" && next) {
      append(next, i + 1);
      i += 2;
      continue;
    }

    if (ch === "`") {
      const tickCount = countRun(source, i, "`");
      const closing = source.indexOf("`".repeat(tickCount), i + tickCount);
      if (closing !== -1) {
        for (let j = i + tickCount; j < closing; j++) {
          append(source[j], j);
        }
        i = closing + tickCount;
        continue;
      }
    }

    if (ch === "!" && next === "[") {
      const imageEnd = findMarkdownLinkEnd(source, i + 1);
      if (imageEnd !== -1) {
        i = imageEnd;
        continue;
      }
    }

    if (ch === "[") {
      const closeBracket = findClosingBracket(source, i);
      if (closeBracket !== -1 && source[closeBracket + 1] === "(") {
        const closeParen = findClosingParen(source, closeBracket + 1);
        if (closeParen !== -1) {
          for (let j = i + 1; j < closeBracket; j++) {
            append(source[j], j);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (isFormattingMarker(ch)) {
      i++;
      continue;
    }

    append(ch, i);
    i++;
  }

  return { text, sourceOffsets };
}

export function locatePreviewSelection(
  source: string,
  payload: PreviewSelectionPayload
): LocatedPreviewSelection | undefined {
  const projection = buildVisibleProjection(source);
  const selectedText = normalizePreviewText(payload.selectedText).trim();
  if (!selectedText) {
    return undefined;
  }

  const leftContext = normalizePreviewText(payload.leftContext || "");
  const rightContext = normalizePreviewText(payload.rightContext || "");
  const contextSizes = [0, 8, 16, 32, 64, 128, 256];

  for (const contextSize of contextSizes) {
    const left = contextSize === 0 ? "" : leftContext.slice(-contextSize);
    const right = contextSize === 0 ? "" : rightContext.slice(0, contextSize);
    const query = left + selectedText + right;
    const queryMatches = findAll(projection.text, query);
    const selectedStarts = queryMatches
      .map(index => index + left.length)
      .filter(index => projection.text.slice(index, index + selectedText.length) === selectedText);
    const uniqueStarts = Array.from(new Set(selectedStarts));

    if (uniqueStarts.length === 1) {
      return sourceRangeFromProjection(projection, uniqueStarts[0], selectedText.length);
    }
  }

  return undefined;
}

function sourceRangeFromProjection(
  projection: VisibleProjection,
  projectionStart: number,
  length: number
): LocatedPreviewSelection | undefined {
  if (length <= 0) {
    return undefined;
  }

  const projectionEnd = projectionStart + length - 1;
  const start = projection.sourceOffsets[projectionStart];
  const last = projection.sourceOffsets[projectionEnd];
  if (start === undefined || last === undefined) {
    return undefined;
  }

  for (let i = projectionStart + 1; i <= projectionEnd; i++) {
    if (projection.sourceOffsets[i] !== projection.sourceOffsets[i - 1] + 1) {
      return undefined;
    }
  }

  return { start, end: last + 1 };
}

function normalizePreviewText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

function findAll(text: string, query: string): number[] {
  if (!query) {
    return [];
  }

  const matches: number[] = [];
  let index = text.indexOf(query);
  while (index !== -1) {
    matches.push(index);
    index = text.indexOf(query, index + 1);
  }
  return matches;
}

function getBlockMarkerLength(source: string, offset: number): number {
  const lineEnd = source.indexOf("\n", offset);
  const line = source.slice(offset, lineEnd === -1 ? source.length : lineEnd);
  const match = line.match(/^([ \t]{0,3})(#{1,6}[ \t]+|>[ \t]?|([-+*]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?)/);
  return match ? match[0].length : 0;
}

function countRun(source: string, offset: number, char: string): number {
  let count = 0;
  while (source[offset + count] === char) {
    count++;
  }
  return count;
}

function findMarkdownLinkEnd(source: string, openBracket: number): number {
  const closeBracket = findClosingBracket(source, openBracket);
  if (closeBracket === -1 || source[closeBracket + 1] !== "(") {
    return -1;
  }
  const closeParen = findClosingParen(source, closeBracket + 1);
  return closeParen === -1 ? -1 : closeParen + 1;
}

function findClosingBracket(source: string, openBracket: number): number {
  for (let i = openBracket + 1; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i++;
      continue;
    }
    if (source[i] === "]") {
      return i;
    }
    if (source[i] === "\n") {
      return -1;
    }
  }
  return -1;
}

function findClosingParen(source: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i++;
      continue;
    }
    if (source[i] === "(") {
      depth++;
    } else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    } else if (source[i] === "\n") {
      return -1;
    }
  }
  return -1;
}

function isFormattingMarker(char: string): boolean {
  return char === "*" || char === "_" || char === "~";
}
