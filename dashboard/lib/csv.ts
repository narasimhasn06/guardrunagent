export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((line) => line.map(csvEscape).join(",")).join("\r\n");
}
