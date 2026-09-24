/**
 * CSV as other systems actually export it: RFC 4180 quoting (commas and line
 * breaks inside quotes, "" for a quote), CRLF or LF, a byte-order mark, and a
 * delimiter that may be a comma, semicolon, tab or pipe.
 */

export interface Table {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [",", ";", "\t", "|"];

/** The delimiter that splits the first line into the most fields, outside quotes. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of CANDIDATES) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string, maxRows = 50_000): Table {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (records.length > maxRows) throw new Error(`The file has more than ${maxRows.toLocaleString()} rows; split it and import in parts`);
    } else field += ch;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) throw new Error("The file is empty");
  const [headerRow, ...rows] = nonEmpty;
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: rows.map((r) => headers.map((_, i) => (r[i] ?? "").trim())), delimiter };
}
