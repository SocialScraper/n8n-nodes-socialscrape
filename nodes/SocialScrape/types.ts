export interface ParamSpec {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'json';
	/** main: a field on the node; extra: inside Additional Fields. */
	where: 'main' | 'extra';
	location: 'query' | 'path' | 'body';
}

export interface OperationSpec {
	id: string;
	method: 'GET' | 'POST' | 'DELETE';
	path: string;
	paginated: boolean;
	params: ParamSpec[];
}

export interface BuiltRequest {
	method: 'GET' | 'POST' | 'DELETE';
	path: string;
	qs: Record<string, string | number | boolean>;
	body?: Record<string, unknown>;
}

export interface Envelope {
	ok: boolean;
	credits_charged?: number;
	credits_remaining?: number | null;
	cached?: boolean;
	cached_at?: string | null;
	request_id?: string;
	data?: unknown;
	cursor?: string | null;
	has_more?: boolean | null;
	raw?: unknown;
	error?: { code: string; message: string; retryable: boolean };
}

export interface HttpRequest {
	method: 'GET' | 'POST' | 'DELETE';
	url: string;
	qs?: Record<string, string | number | boolean>;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
}

export interface HttpResponse {
	status: number;
	body: unknown;
	headers?: Record<string, string | string[] | undefined>;
}

export type Requester = (req: HttpRequest) => Promise<HttpResponse>;
