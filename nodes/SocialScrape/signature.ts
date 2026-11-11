import { createHmac, timingSafeEqual } from 'node:crypto';

/** Receivers reject a timestamp older than this (ss_contracts.webhooks). */
export const TOLERANCE_SECONDS = 300;

export function sign(secret: string, body: string | Buffer, timestamp: number): string {
	const mac = createHmac('sha256', secret)
		.update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(body)]))
		.digest('hex');
	return `t=${timestamp},v1=${mac}`;
}

/** Checks the SocialScrape-Signature header: "t=<unix seconds>,v1=<hex HMAC-SHA256>". */
export function verify(
	secret: string,
	body: string | Buffer,
	header: string | undefined,
	now: number = Math.floor(Date.now() / 1000),
): boolean {
	if (!header) return false;
	const parts: Record<string, string> = {};
	for (const piece of header.split(',')) {
		const at = piece.indexOf('=');
		if (at > 0) parts[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
	}
	const t = Number(parts.t);
	if (!Number.isInteger(t) || !parts.v1) return false;
	if (Math.abs(now - t) > TOLERANCE_SECONDS) return false;
	const expected = sign(secret, body, t).split('v1=')[1];
	const a = Buffer.from(expected);
	const b = Buffer.from(parts.v1);
	return a.length === b.length && timingSafeEqual(a, b);
}
