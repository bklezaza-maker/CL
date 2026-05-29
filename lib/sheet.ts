interface FaqEntry {
  question: string;
  answer: string;
  tags: string;
}

interface FaqCache {
  data: FaqEntry[];
  fetchedAt: number;
}

let cache: FaqCache | null = null;
const CACHE_TTL_MS = 60_000;

export async function fetchFaq(): Promise<FaqEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    console.error("[sheet] SHEET_CSV_URL not set");
    return cache?.data ?? [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    const entries = parseCsv(text);

    cache = { data: entries, fetchedAt: Date.now() };
    console.log(`[sheet] fetched ${entries.length} FAQ entries`);
    return entries;
  } catch (err) {
    console.error("[sheet] fetch failed:", err);
    return cache?.data ?? [];
  }
}

function parseCsv(text: string): FaqEntry[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const entries: FaqEntry[] = [];

  // skip header row (line 0)
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 2) continue;
    entries.push({
      question: cols[0]?.trim() ?? "",
      answer: cols[1]?.trim() ?? "",
      tags: cols[2]?.trim() ?? "",
    });
  }

  return entries;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function faqToText(entries: FaqEntry[]): string {
  if (entries.length === 0) return "(ไม่มีข้อมูล FAQ)";
  return entries
    .map((e) => `Q: ${e.question}\nA: ${e.answer}`)
    .join("\n\n");
}
