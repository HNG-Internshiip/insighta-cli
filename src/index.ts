#!/usr/bin/env node
import { Command }    from "commander";
import chalk          from "chalk";
import ora            from "ora";
import Table          from "cli-table3";
import http           from "http";
import crypto         from "crypto";
import open           from "open";
import fs             from "fs";
import path           from "path";
import axios          from "axios";
import { saveCredentials, loadCredentials,
         clearCredentials }               from "./credentials";
import { listProfiles, getProfile,
         searchProfiles, createProfile,
         exportProfiles, apiLogout }      from "./api";

const BASE    = process.env.INSIGHTA_API_URL || "https://insightabe.netlify.app";
const program = new Command();

program
  .name("insighta")
  .description("Insighta Labs CLI")
  .version("3.0.1");

// ── insighta login ────────────────────────────────────────────────────────────
program.command("login").description("Authenticate via GitHub OAuth").action(async () => {
  const spin = ora("Starting GitHub OAuth flow...").start();

  const verifier  = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state     = crypto.randomBytes(16).toString("hex");

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url     = new URL(req.url!, "http://localhost");
        const code    = url.searchParams.get("code");
        const cbState = url.searchParams.get("state");

        if (!code || cbState !== state) {
          res.end("<h2>Invalid callback. Please try again.</h2>");
          server.close();
          reject(new Error("Invalid OAuth state"));
          return;
        }

        // Send code + verifier + redirect_uri to backend callback
        const cbRes = await axios.get(`${BASE}/auth/github/callback`, {
          params: { code, state, code_verifier: verifier, redirect_uri: callbackUrl },
        });

        const { access_token, refresh_token, username, role } = cbRes.data;
        saveCredentials({ access_token, refresh_token, username, role });

        res.end(`<h2>Logged in as @${username}. You can close this tab.</h2>`);
        server.close();
        spin.succeed(chalk.green(`Logged in as @${username} (${role})`));
        resolve();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Authentication failed";
        res.end(`<h2>${msg}. Please try again.</h2>`);
        server.close();
        reject(new Error(msg));
      }
    });

    let callbackUrl = "";

    server.listen(0, "127.0.0.1", async () => {
      const port  = (server.address() as { port: number }).port;
      callbackUrl = `http://127.0.0.1:${port}/callback`;

      try {
        // Ask backend for the GitHub OAuth URL
        // Backend stores PKCE state in DB and returns the GitHub URL
        const urlRes = await axios.get(`${BASE}/auth/github/url`, {
          params: {
            code_challenge: challenge,
            state,
            redirect_uri:   callbackUrl,
          },
        });

        const ghUrl = urlRes.data.url as string;
        spin.text = `Opening browser on port ${port}...`;

        open(ghUrl).catch(() => {
          spin.warn(`Open this URL in your browser:\n${ghUrl}`);
        });
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.on("error", reject);
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 5 minutes"));
    }, 5 * 60_000);
  });
});

// ── insighta logout ───────────────────────────────────────────────────────────
program.command("logout").description("Log out and clear credentials").action(async () => {
  const creds = loadCredentials();
  if (!creds) { console.log(chalk.yellow("Not logged in.")); return; }
  const spin = ora("Logging out...").start();
  try { await apiLogout(creds.refresh_token); } catch { /* ignore */ }
  clearCredentials();
  spin.succeed(chalk.green("Logged out."));
});

// ── insighta whoami ───────────────────────────────────────────────────────────
program.command("whoami").description("Show current user").action(() => {
  const creds = loadCredentials();
  if (!creds) { console.log(chalk.yellow("Not logged in.")); return; }
  console.log(chalk.cyan(`@${creds.username}`) + chalk.gray(` (${creds.role})`));
});

// ── insighta profiles ─────────────────────────────────────────────────────────
const profiles = program.command("profiles").description("Profile commands");

profiles
  .command("list")
  .description("List profiles with optional filters")
  .option("--gender <gender>")
  .option("--country <country_id>")
  .option("--age-group <age_group>")
  .option("--min-age <n>",    "Minimum age",          (v) => parseInt(v, 10))
  .option("--max-age <n>",    "Maximum age",          (v) => parseInt(v, 10))
  .option("--sort-by <field>","Sort field",           "created_at")
  .option("--order <order>",  "asc or desc",          "asc")
  .option("--page <n>",       "Page number",          (v) => parseInt(v, 10))
  .option("--limit <n>",      "Results per page",     (v) => parseInt(v, 10))
  .action(async (opts) => {
    const spin = ora("Fetching profiles...").start();
    try {
      const params: Record<string, unknown> = {};
      if (opts.gender)   params.gender    = opts.gender;
      if (opts.country)  params.country_id= opts.country;
      if (opts.ageGroup) params.age_group = opts.ageGroup;
      if (opts.minAge)   params.min_age   = opts.minAge;
      if (opts.maxAge)   params.max_age   = opts.maxAge;
      if (opts.sortBy)   params.sort_by   = opts.sortBy;
      if (opts.order)    params.order     = opts.order;
      if (opts.page)     params.page      = opts.page;
      if (opts.limit)    params.limit     = opts.limit;

      const res = await listProfiles(params);
      const { data, total, page, total_pages } = res.data;
      spin.succeed(`${total} profiles found (page ${page}/${total_pages})`);
      printTable(data);
    } catch (e: unknown) {
      spin.fail(chalk.red(e instanceof Error ? e.message : "Request failed"));
    }
  });

profiles
  .command("get <id>")
  .description("Get a single profile by ID")
  .action(async (id) => {
    const spin = ora("Fetching profile...").start();
    try {
      const res = await getProfile(id);
      spin.stop();
      printTable([res.data.data]);
    } catch (e: unknown) {
      spin.fail(chalk.red(e instanceof Error ? e.message : "Request failed"));
    }
  });

profiles
  .command("search <query>")
  .description("Natural language profile search")
  .option("--page <n>",  "Page number",      (v) => parseInt(v, 10))
  .option("--limit <n>", "Results per page", (v) => parseInt(v, 10))
  .action(async (query, opts) => {
    const spin = ora(`Searching: "${query}"...`).start();
    try {
      const params: Record<string, unknown> = {};
      if (opts.page)  params.page  = opts.page;
      if (opts.limit) params.limit = opts.limit;
      const res = await searchProfiles(query, params);
      const { data, total, page, total_pages } = res.data;
      spin.succeed(`${total} results (page ${page}/${total_pages})`);
      printTable(data);
    } catch (e: unknown) {
      spin.fail(chalk.red(e instanceof Error ? e.message : "Request failed"));
    }
  });

profiles
  .command("create")
  .description("Create a new profile (admin only)")
  .requiredOption("--name <name>")
  .action(async (opts) => {
    const spin = ora(`Creating profile for "${opts.name}"...`).start();
    try {
      const res = await createProfile(opts.name);
      spin.succeed(chalk.green("Profile created"));
      printTable([res.data.data]);
    } catch (e: unknown) {
      spin.fail(chalk.red(e instanceof Error ? e.message : "Request failed"));
    }
  });

profiles
  .command("export")
  .description("Export profiles as CSV")
  .option("--format <fmt>",    "Export format", "csv")
  .option("--gender <gender>")
  .option("--country <country_id>")
  .option("--age-group <age_group>")
  .action(async (opts) => {
    const spin = ora("Exporting profiles...").start();
    try {
      const params: Record<string, unknown> = {};
      if (opts.gender)   params.gender    = opts.gender;
      if (opts.country)  params.country_id= opts.country;
      if (opts.ageGroup) params.age_group = opts.ageGroup;

      const res      = await exportProfiles(params);
      const filename = `profiles_${Date.now()}.csv`;
      const dest     = path.join(process.cwd(), filename);
      fs.writeFileSync(dest, res.data as string);
      spin.succeed(chalk.green(`Saved to ${dest}`));
    } catch (e: unknown) {
      spin.fail(chalk.red(e instanceof Error ? e.message : "Request failed"));
    }
  });

// ── Table renderer ────────────────────────────────────────────────────────────
function printTable(rows: Record<string, unknown>[]) {
  if (!rows?.length) { console.log(chalk.yellow("No results.")); return; }
  const t = new Table({
    head:  Object.keys(rows[0]).map(k => chalk.cyan(k)),
    style: { compact: true },
  });
  rows.forEach(r => t.push(Object.values(r).map(v => String(v ?? ""))));
  console.log(t.toString());
}

program.parse();