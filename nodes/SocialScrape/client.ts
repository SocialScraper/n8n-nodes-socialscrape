import { randomUUID } from 'node:crypto';
import { sleep as realSleep } from 'n8n-workflow';
import type {
	BuiltRequest,
	Envelope,
	HttpResponse,
	OperationSpec,
	ParamSpec,
	Requester,
} from './types';

export const USER_AGENT = 'n8n-nodes-socialscrape/0.1.0';
const MAX_RETRIES = 2;
const JOB_POLL_MS = 2000;
const JOB_MAX_WAIT_MS = 180_000;

export class SocialScrapeError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly httpCode: number,
		readonly retryable: boolean,
		readonly requestId: string | undefined,
		readonly body: unknown,
	) {
		super(message);
		this.name = 'SocialScrapeError';
	}
}

export type Sleep = (ms: number) => Promise<void>;

function isEmpty(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
}

function coerce(param: ParamSpec, value: unknown): unknown {
	if (param.type === 'json') {
		if (typeof value !== 'string') return value;
		const parsed = parseJson(value);
		// The nodes turn a SocialScrapeError into n8n's NodeApiError, which names the field for the user.
		if (!parsed.ok) throw new SocialScrapeError(`${param.name} is not valid JSON`, 'invalid_json', 400, false, undefined, undefined);
		return parsed.value;
	}
	return value;
}

/** Turns the node's field values into one request. Empty values are left out. */
export function buildRequest(
	spec: OperationSpec,
	main: Record<string, unknown>,
	extra: Record<string, unknown>,
	cursor?: string,
): BuiltRequest {
	const qs: BuiltRequest['qs'] = {};
	const body: Record<string, unknown> = {};
	let path = spec.path;
	for (const param of spec.params) {
		const source = param.where === 'main' ? main : extra;
		let value = source[param.name];
		if (isEmpty(value)) continue;
		// "limit" in Additional Fields defaults to 0, which means "not set".
		if (param.name === 'limit' && value === 0) continue;
		if (param.type === 'json' && (value === '[]' || value === '{}') && param.where === 'extra') continue;
		value = coerce(param, value);
		if (param.location === 'path') {
			path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
		} else if (param.location === 'body') {
			body[param.name] = value;
		} else if (typeof value === 'object') {
			qs[param.name] = JSON.stringify(value);
		} else {
			qs[param.name] = value as string | number | boolean;
		}
	}
	if (cursor) qs.cursor = cursor;
	const built: BuiltRequest = { method: spec.method, path, qs };
	if (Object.keys(body).length > 0 || spec.method === 'POST') built.body = body;
	return built;
}

/** The `params` object a monitor stores: every set field, no paging or cache controls. */
export function monitorParams(
	spec: OperationSpec,
	main: Record<string, unknown>,
	extra: Record<string, unknown>,
): Record<string, unknown> {
	const built = buildRequest(spec, main, extra);
	const skip = new Set(['cursor', 'max_age_days', 'raw', 'trim']);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(built.qs)) {
		if (!skip.has(key)) out[key] = value;
	}
	return out;
}

function header(res: HttpResponse, name: string): string | undefined {
	const value = res.headers?.[name];
	return Array.isArray(value) ? value[0] : value;
}

function asEnvelope(body: unknown): Envelope | undefined {
	return body && typeof body === 'object' && 'ok' in (body as object) ? (body as Envelope) : undefined;
}

function toError(res: HttpResponse): SocialScrapeError {
	const env = asEnvelope(res.body);
	if (env && env.ok === false && env.error) {
		return new SocialScrapeError(
			`${env.error.code}: ${env.error.message}`,
			env.error.code,
			res.status,
			env.error.retryable,
			env.request_id,
			res.body,
		);
	}
	return new SocialScrapeError(
		`HTTP ${res.status}`,
		'http_error',
		res.status,
		res.status === 429 || res.status >= 500,
		undefined,
		res.body,
	);
}

export interface CallOptions {
	baseUrl: string;
	sleep?: Sleep;
	jobMaxWaitMs?: number;
}

/** One logical request: retries retryable failures, waits out a 202 job, returns the final envelope. */
export async function call(
	requester: Requester,
	built: BuiltRequest,
	options: CallOptions,
): Promise<Envelope> {
	const sleep = options.sleep ?? realSleep;
	const base = options.baseUrl.replace(/\/+$/, '');
	const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
	if (built.method === 'POST') headers['Idempotency-Key'] = randomUUID();
	const send = (url: string): Promise<HttpResponse> =>
		requester({ method: built.method, url, qs: built.qs, body: built.body, headers });

	let attempt = 0;
	let res = await send(base + built.path);
	for (;;) {
		const failed = res.status >= 400 || asEnvelope(res.body)?.ok === false;
		if (!failed) break;
		const err = toError(res);
		if (!err.retryable || attempt >= MAX_RETRIES) throw err;
		attempt += 1;
		const wait = Number(header(res, 'retry-after'));
		await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * 2 ** attempt);
		res = await send(base + built.path);
	}

	if (res.status === 202) {
		const data = asEnvelope(res.body)?.data as { job_id?: string } | undefined;
		if (data?.job_id) return pollJob(requester, data.job_id, options);
	}
	const env = asEnvelope(res.body);
	if (!env) throw new SocialScrapeError('The API answered with something that is not an envelope', 'http_error', res.status, false, undefined, res.body);
	return env;
}

async function pollJob(requester: Requester, jobId: string, options: CallOptions): Promise<Envelope> {
	const sleep = options.sleep ?? realSleep;
	const base = options.baseUrl.replace(/\/+$/, '');
	const limit = options.jobMaxWaitMs ?? JOB_MAX_WAIT_MS;
	let waited = 0;
	for (;;) {
		await sleep(JOB_POLL_MS);
		waited += JOB_POLL_MS;
		const res = await requester({
			method: 'GET',
			url: `${base}/v1/jobs/${encodeURIComponent(jobId)}`,
			headers: { 'User-Agent': USER_AGENT },
		});
		if (res.status >= 400 || asEnvelope(res.body)?.ok === false) throw toError(res);
		if (res.status !== 202) return res.body as Envelope;
		if (waited >= limit) {
			throw new SocialScrapeError(
				`Job ${jobId} is still running after ${Math.round(limit / 1000)} seconds; poll /v1/jobs/${jobId} later`,
				'job_pending',
				202,
				true,
				undefined,
				res.body,
			);
		}
	}
}

export interface RunResult {
	/** What to emit: one entry per output item. */
	items: unknown[];
	pages: number;
	creditsCharged: number;
	creditsRemaining: number | null | undefined;
}

export interface RunOptions extends CallOptions {
	maxPages: number;
	includeEnvelope: boolean;
	cursor?: string;
}

/** Runs one operation, following the cursor for up to maxPages pages. */
export async function run(
	requester: Requester,
	spec: OperationSpec,
	main: Record<string, unknown>,
	extra: Record<string, unknown>,
	options: RunOptions,
): Promise<RunResult> {
	const items: unknown[] = [];
	let cursor = options.cursor;
	let pages = 0;
	let charged = 0;
	let remaining: number | null | undefined;
	for (;;) {
		const env = await call(requester, buildRequest(spec, main, extra, cursor), options);
		pages += 1;
		charged += env.credits_charged ?? 0;
		remaining = env.credits_remaining;
		if (options.includeEnvelope) {
			items.push(env);
		} else if (spec.paginated && Array.isArray((env.data as { items?: unknown[] } | undefined)?.items)) {
			items.push(...(env.data as { items: unknown[] }).items);
		} else {
			items.push(env.data);
		}
		const more = spec.paginated && env.has_more === true && typeof env.cursor === 'string' && env.cursor !== '';
		if (!more || pages >= options.maxPages) break;
		cursor = env.cursor as string;
	}
	return { items, pages, creditsCharged: charged, creditsRemaining: remaining };
}
