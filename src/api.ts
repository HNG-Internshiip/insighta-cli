import axios, { AxiosInstance, AxiosError } from "axios";
import { loadCredentials, saveCredentials, clearCredentials } from "./credentials";

const BASE = "https://insightabe.netlify.app";

function makeClient(token: string): AxiosInstance {
	return axios.create({
		baseURL: BASE,
		headers: {
			Authorization: `Bearer ${token}`,
			"X-API-Version": "1",
			"Content-Type": "application/json",
		},
	});
}

// Auto-refresh interceptor
async function withRefresh<T>(fn: (client: AxiosInstance) => Promise<T>): Promise<T> {
	const creds = loadCredentials();
	if (!creds) throw new Error("Not logged in. Run: insighta login");

	try {
		return await fn(makeClient(creds.access_token));
	} catch (err) {
		const e = err as AxiosError;
		if (e.response?.status !== 401) throw err;

		// Try refresh
		try {
			const res = await axios.post(`${BASE}/auth/refresh`, {
				refresh_token: creds.refresh_token,
			});
			const updated = {
				...creds,
				access_token: res.data.access_token,
				refresh_token: res.data.refresh_token,
			};
			saveCredentials(updated);
			return await fn(makeClient(updated.access_token));
		} catch {
			clearCredentials();
			throw new Error("Session expired. Run: insighta login");
		}
	}
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function apiLogout(refreshToken: string) {
	await axios.post(`${BASE}/auth/logout`, { refresh_token: refreshToken }, {
		headers: { Authorization: `Bearer ${loadCredentials()?.access_token}` },
	});
}

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function listProfiles(params: Record<string, unknown>) {
	return withRefresh(c => c.get("/api/profiles", { params }));
}

export async function getProfile(id: string) {
	return withRefresh(c => c.get(`/api/profiles/${id}`));
}

export async function searchProfiles(q: string, params: Record<string, unknown> = {}) {
	return withRefresh(c => c.get("/api/profiles/search", { params: { q, ...params } }));
}

export async function createProfile(name: string) {
	return withRefresh(c => c.post("/api/profiles", { name }));
}

export async function exportProfiles(params: Record<string, unknown>) {
	return withRefresh(c => c.get("/api/profiles/export", {
		params: { ...params, format: "csv" },
		responseType: "text",
	}));
}