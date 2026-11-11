import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { run, SocialScrapeError } from './client';
import { OPERATION_FIELDS, OPERATIONS, RESOURCE_SELECTORS } from './generated';
import type { Requester } from './types';

export class SocialScrape implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SocialScrape',
		name: 'socialScrape',
		icon: { light: 'file:socialscrape.svg', dark: 'file:socialscrape.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description:
			'Get social media data (profiles, posts, comments, search, ads, transcripts) from every major platform in one response shape',
		documentationUrl: 'https://socialscrape.dev/templates?utm_source=n8n&utm_medium=package&utm_campaign=n8n-nodes-socialscrape',
		defaults: { name: 'SocialScrape' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'socialScrapeApi', required: true }],
		properties: [...RESOURCE_SELECTORS, ...OPERATION_FIELDS],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const input = this.getInputData();
		const credentials = await this.getCredentials('socialScrapeApi');
		const baseUrl = String(credentials.baseUrl || 'https://api.socialscrape.dev');
		const requester: Requester = async (req) => {
			const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'socialScrapeApi', {
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

		const out: INodeExecutionData[] = [];
		for (let i = 0; i < input.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const spec = OPERATIONS[`${resource}:${operation}`];
				if (!spec) throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}:${operation}`, { itemIndex: i });
				const main: IDataObject = {};
				for (const p of spec.params) {
					if (p.where === 'main') main[p.name] = this.getNodeParameter(p.name, i, '') as never;
				}
				const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
				const result = await run(requester, spec, main, extra, {
					baseUrl,
					maxPages: Number(extra.maxPages ?? 1),
					includeEnvelope: extra.includeEnvelope === true,
					cursor: typeof extra.cursor === 'string' && extra.cursor ? extra.cursor : undefined,
				});
				for (const item of result.items) {
					out.push({ json: (item ?? {}) as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof SocialScrapeError) {
					throw new NodeApiError(this.getNode(), (error.body ?? { message: error.message }) as JsonObject, {
						message: error.message,
						description: error.requestId ? `Request ID: ${error.requestId}` : undefined,
						httpCode: String(error.httpCode),
						itemIndex: i,
					});
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}
}
