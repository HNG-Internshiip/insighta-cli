import fs   from "fs";
import path  from "path";
import os    from "os";

const DIR  = path.join(os.homedir(), ".insighta");
const FILE = path.join(DIR, "credentials.json");

export interface Credentials {
  access_token:  string;
  refresh_token: string;
  username:      string;
  role:          string;
}

export function saveCredentials(creds: Credentials): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  try { fs.unlinkSync(FILE); } catch { /* already gone */ }
}