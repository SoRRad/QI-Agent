/**
 * A small RFC 4180 CSV parser.
 *
 * Runs in the browser on an uploaded file, so the file itself never leaves the
 * user's machine: only the columns they map are sent to the server. No
 * dependency, because the cases that matter here are few and all tested —
 * quoted fields containing commas, newlines and doubled quotes; CRLF, LF and
 * lone CR line endings; a UTF-8 byte-order mark from Excel; and semicolon- or
 * tab-delimited exports from locales where the comma is the decimal mark.
 */

export interface CsvResult {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";" | "\t";
  /** Problems that did not stop the parse, e.g. a row with too many cells. */
  warnings: string[];
  /** Set when the file could not be parsed at all. */
  error: string | null;
}

export const MAX_CSV_ROWS = 1000;

/** The delimiter used most often, outside quotes, on the first line. */
function detectDelimiter(text: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts] += 1;
  }
  const best = (Object.entries(counts) as Array<[keyof typeof counts, number]>).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

export function parseCsv(input: string, maxRows = MAX_CSV_ROWS): CsvResult {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  const warnings: string[] = [];

  let field = "";
  let record: string[] = [];
  let quoted = false;
  let fieldStartedQuoted = false;

  const endField = () => {
    record.push(fieldStartedQuoted ? field : field.trim());
    field = "";
    fieldStartedQuoted = false;
  };
  const endRecord = () => {
    endField();
    // Skip blank lines entirely.
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      quoted = true;
      fieldStartedQuoted = true;
      field = "";
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRecord();
    } else if (ch === "\n") {
      endRecord();
    } else {
      field += ch;
    }
    if (records.length > maxRows + 1) break;
  }

  if (quoted) {
    return { headers: [], rows: [], delimiter, warnings, error: "The file ends inside a quoted field: a quotation mark is missing." };
  }
  if (field !== "" || record.length > 0) endRecord();

  const [headerRow, ...body] = records;
  if (!headerRow || headerRow.every((h) => h === "")) {
    return { headers: [], rows: [], delimiter, warnings, error: "The file is empty." };
  }
  const headers = headerRow.map((h, i) => h || `Column ${i + 1}`);

  if (body.length > maxRows) {
    return { headers, rows: [], delimiter, warnings, error: `The file has more than ${maxRows} rows. Upload one measure's periods at a time.` };
  }

  const rows = body.map((row, index) => {
    if (row.length > headers.length) warnings.push(`Row ${index + 2} has more cells than there are headers; the extra cells are ignored.`);
    return headers.map((_, i) => row[i] ?? "");
  });

  return { headers, rows, delimiter, warnings, error: null };
}
