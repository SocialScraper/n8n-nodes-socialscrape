import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class SocialScrapeApi implements ICredentialType {
	name = 'socialScrapeApi';

	displayName = 'SocialScrape API';

	icon: Icon = {
		light: 'file:../nodes/SocialScrape/socialscrape.svg',
		dark: 'file:../nodes/SocialScrape/socialscrape.dark.svg',
	};

	documentationUrl = 'https://socialscrape.dev/templates/install?utm_source=n8n&utm_medium=package&utm_campaign=n8n-nodes-socialscrape';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create a key in the SocialScrape dashboard under API keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.socialscrape.dev',
			description: 'Only change this to point at a staging or self-hosted API',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/account/credits',
		},
	};
}
