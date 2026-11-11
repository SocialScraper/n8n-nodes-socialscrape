import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import { call, monitorParams, SocialScrapeError } from './client';
import { TRIGGER_FIELDS, TRIGGER_SPECS } from './generated';
import { verify } from './signature';
import type { Envelope, Requester } from './types';

interface Stored {
	id: string;
	secret: string;
}

const SEEN_LIMIT = 100;

type HookContext = IHookFunctions | IWebhookFunctions;

function requesterFor(ctx: IHookFunctions): Requester {
	return async (req) => {
		const res = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'socialScrapeApi', {
			method: req.method,
			url: req.url,
			qs: req.qs,
			body: req.body,
			headers: req.headers,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as { statusCode: number; body: unknown; headers?: Record<string, string> };
		return { status: res.statusCode, body: res.body, headers: res.headers };
	};
}

async function baseUrl(ctx: HookContext): Promise<string> {
	const credentials = await ctx.getCredentials('socialScrapeApi');
	return String(credentials.baseUrl || 'https://api.socialscrape.dev');
}

function apiError(ctx: HookContext, error: unknown): never {
	if (error instanceof SocialScrapeError) {
		throw new NodeApiError(ctx.getNode(), (error.body ?? { message: error.message }) as JsonObject, {
			message: error.message,
			httpCode: String(error.httpCode),
		});
	}
	throw new NodeOperationError(ctx.getNode(), error as Error);
}

function storedMonitors(ctx: HookContext): Record<string, Stored> {
	const data = ctx.getWorkflowStaticData('node');
	if (!data.monitors) data.monitors = {};
	return data.monitors as Record<string, Stored>;
}

export class SocialScrapeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SocialScrape Trigger',
		name: 'socialScrapeTrigger',
		icon: { light: 'file:socialscrape.svg', dark: 'file:socialscrape.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["endpoint"]}}',
		description: 'Starts the workflow when a SocialScrape monitor finds new items in a list',
		documentationUrl: 'https://socialscrape.dev/templates/trigger?utm_source=n8n&utm_medium=package&utm_campaign=n8n-nodes-socialscrape',
		defaults: { name: 'SocialScrape Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'socialScrapeApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			...TRIGGER_FIELDS,
			{
				displayName: 'Check Every (Minutes)',
				name: 'intervalMinutes',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 60,
				description: 'How often the monitor reads the list; every check is charged as one request',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Split Items',
						name: 'splitItems',
						type: 'boolean',
						default: true,
						description: 'Whether to start one item per new post or entry instead of one item per event',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				const stored = storedMonitors(this)[url];
				if (!stored) return false;
				try {
					// The list is paged (a team may hold up to 100 monitors): walk it, or a monitor
					// past the first page would look gone and be recreated, leaving the old one billed.
					let found = false;
					let cursor: string | undefined;
					for (let page = 0; page < 20 && !found; page++) {
						const env = await call(
							requesterFor(this),
							{ method: 'GET', path: '/v1/monitors', qs: cursor ? { cursor } : {} },
							{ baseUrl: await baseUrl(this) },
						);
						const list = (env.data as { items?: Array<{ id: string; active: boolean }> })?.items ?? [];
						found = list.some((m) => m.id === stored.id && m.active);
						if (env.has_more !== true || typeof env.cursor !== 'string' || !env.cursor) break;
						cursor = env.cursor;
					}
					if (!found) delete storedMonitors(this)[url];
					return found;
				} catch (error) {
					// A definite refusal (bad key, not allowed) means we cannot vouch for the monitor.
					// Anything else (network, 5xx after retries) must not fall through to create(), which
					// would overwrite the stored id and orphan a monitor that keeps being checked and billed.
					if (error instanceof SocialScrapeError && !error.retryable) return false;
					apiError(this, error);
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				const endpoint = this.getNodeParameter('endpoint') as string;
				const spec = TRIGGER_SPECS[endpoint];
				if (!spec) throw new NodeOperationError(this.getNode(), `Unknown list ${endpoint}`);
				const main: IDataObject = {};
				for (const p of spec.params) {
					if (p.where === 'main') main[p.name] = this.getNodeParameter(p.name, '') as never;
				}
				const extra = this.getNodeParameter('additionalFields', {}) as IDataObject;
				let env: Envelope;
				try {
					env = await call(
						requesterFor(this),
						{
							method: 'POST',
							path: '/v1/monitors',
							qs: {},
							body: {
								endpoint: spec.path,
								params: monitorParams(spec, main, extra),
								interval_minutes: this.getNodeParameter('intervalMinutes') as number,
								webhook_url: url,
							},
						},
						{ baseUrl: await baseUrl(this) },
					);
				} catch (error) {
					apiError(this, error);
				}
				const monitor = env.data as { id: string; webhook_secret?: string };
				if (!monitor?.id || !monitor.webhook_secret) {
					throw new NodeOperationError(this.getNode(), 'The API did not return a monitor id and webhook secret');
				}
				storedMonitors(this)[url] = { id: monitor.id, secret: monitor.webhook_secret };
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				const stored = storedMonitors(this)[url];
				if (!stored) return true;
				try {
					await call(requesterFor(this), { method: 'DELETE', path: `/v1/monitors/${encodeURIComponent(stored.id)}`, qs: {} }, { baseUrl: await baseUrl(this) });
				} catch (error) {
					// Already gone is fine; anything else leaves the stored id so a retry can clean up.
					if (!(error instanceof SocialScrapeError && error.code === 'not_found')) return false;
				}
				delete storedMonitors(this)[url];
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const url = this.getNodeWebhookUrl('default') as string;
		const stored = storedMonitors(this)[url];
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
		const header = req.headers['socialscrape-signature'];
		if (!stored || !verify(stored.secret, raw, Array.isArray(header) ? header[0] : header)) {
			res.status(401).json({ error: 'invalid signature' });
			return { noWebhookResponse: true };
		}

		// A retried delivery carries the same event id: pass it once.
		const eventId = String(req.headers['socialscrape-event-id'] ?? '');
		const data = this.getWorkflowStaticData('node');
		const seen = (data.seenEvents as string[] | undefined) ?? [];
		if (eventId && seen.includes(eventId)) return { webhookResponse: { ok: true, duplicate: true } };
		if (eventId) data.seenEvents = [...seen, eventId].slice(-SEEN_LIMIT);

		const event = req.body as IDataObject & { type?: string; items?: IDataObject[] };
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const split = options.splitItems !== false;
		const out: INodeExecutionData[] =
			split && event.type !== 'test' && Array.isArray(event.items)
				? event.items.map((item) => ({ json: item }))
				: [{ json: event }];
		return { workflowData: [out] };
	}
}
