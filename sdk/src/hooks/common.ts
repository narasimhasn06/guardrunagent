export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export interface CommonHookInput {
  session_id: string;
}

export async function readHookInput<T extends CommonHookInput>(): Promise<T> {
  const raw = await readStdin();
  return JSON.parse(raw) as T;
}
