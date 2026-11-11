# n8n-nodes-socialscrape

This is an n8n community node. It lets you use [SocialScrape](https://socialscrape.dev/?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape) in your n8n workflows.

SocialScrape is a social media data API: profiles, posts, comments, search, ads and transcripts from TikTok, Instagram, YouTube, X, LinkedIn, Reddit, Facebook and more, all in one response shape and on one API key.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Operations](#operations)
[Trigger](#trigger)
[Usage](#usage)
[Compatibility](#compatibility)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-socialscrape`.

On a self-hosted instance: **Settings**, **Community Nodes**, **Install**, then enter `n8n-nodes-socialscrape`.

## Credentials

1. Sign up at [socialscrape.dev](https://socialscrape.dev/sign-up?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape) and create an API key in the dashboard under **API keys**. The key is shown once.
2. In n8n, add a **SocialScrape API** credential and paste the key into **API Key**. Leave **Base URL** as it is.
3. Save. n8n tests the credential with `GET /v1/account/credits`, which is free.

The key is sent in the `x-api-key` header. Step by step: [install the node](https://socialscrape.dev/templates/install?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape).

## Operations

The **SocialScrape** node has one resource per platform, plus **Account**, **Jobs**, **Monitors** and **Any Platform**. Each operation is one endpoint of the SocialScrape API. The full list, with the endpoint and the cost of each, is in [OPERATIONS.md](https://github.com/SocialScraper/n8n-nodes-socialscrape/blob/main/OPERATIONS.md). Some of what is there:

- **Profiles**: a TikTok, Instagram, X, LinkedIn, Threads or Bluesky profile, a YouTube or Twitch channel, a Facebook page.
- **Posts and videos**: one post by URL, or the list of a profile's posts, videos, Reels or Shorts.
- **Comments**: the comments of a video or post, and replies to a comment.
- **Search**: by keyword, hashtag or user on TikTok, YouTube, Instagram, Reddit, X and others.
- **Transcripts**: the transcript of a YouTube, TikTok, Instagram, Facebook, X or LinkedIn video. Under **Any Platform**, **Transcript from any video URL** takes a link from any supported platform. When a video has no captions, its audio is transcribed with AI.
- **Ads**: search and ad details from the Facebook, TikTok and LinkedIn Ad Libraries and Google Ads Transparency.
- **Account**: credit balance, daily usage and request history, all free.

Required inputs are fields on the node. Everything else is under **Additional Fields**:

- **Max Pages** and **Cursor**, on lists. **Max Pages** follows the cursor for up to that many pages; each page is one request. A list outputs one n8n item per row.
- **Include Envelope** returns `credits_charged`, `credits_remaining` and the request ID with the data.
- `trim`, `raw` and `max_age_days`. With `max_age_days` set, a cached result that is fresh enough is returned and costs nothing.

Retryable failures are retried with backoff. A slow job, such as AI transcription of a long video, is waited out. When a call fails, the message carries the API's code and the request ID. **Continue On Fail** is supported, and the node can be used as a tool by an AI Agent node.

## Trigger

**SocialScrape Trigger** starts a workflow when a monitor finds new items in a list: new videos on a channel, new posts on a profile, new comments on a video, new ads from an advertiser.

- **Watch**: the list to watch.
- The fields that list needs, for example a handle or a URL.
- **Check Every (Minutes)**: how often the list is read. Every check is charged as one request to that endpoint.
- **Options**, **Split Items**: one item per new row (the default) or one item per event.

Activating the workflow creates the monitor with the workflow's webhook URL, and deactivating it deletes the monitor. Each delivery is checked against the monitor's signing secret, and a repeated event ID is ignored. The webhook URL has to be reachable over HTTPS from the internet: n8n Cloud always is, and a self-hosted instance is once `WEBHOOK_URL` is set to its address.

## Usage

**Fetch a profile**

1. Add a **SocialScrape** node and choose your SocialScrape API credential.
2. Set **Resource** to TikTok and **Operation** to Profile.
3. Fill **Handle**, with or without the @.
4. Run the node. One item comes back, with the same field names as a profile from any other platform.

**Page through a channel's videos**

1. Add a **SocialScrape** node. Set **Resource** to YouTube and **Operation** to Channel videos.
2. Fill **Handle**, **ID** or **URL**.
3. Open **Additional Fields** and set **Max Pages**, for example to 3.
4. Run the node. It outputs one item per video.

**Run a workflow on every new video**

1. Add a **SocialScrape Trigger**. Set **Watch** to YouTube: Channel videos and fill **Handle**.
2. Set **Check Every (Minutes)** and activate the workflow.
3. Each new video starts the workflow with that video as the item. Add a **SocialScrape** node after it with **Resource** YouTube and **Operation** Video transcript to get what was said.

More recipes: [n8n templates for SocialScrape](https://socialscrape.dev/templates?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape).

## Compatibility

Built and unit tested against `n8n-workflow` 2.47 on Node.js 22. Use a current n8n 2.x release on Node.js 20 or later; earlier n8n versions have not been tested. The package has no runtime dependencies.

## Resources

- [n8n templates for SocialScrape](https://socialscrape.dev/templates?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape)
- [SocialScrape API documentation](https://socialscrape.dev/docs?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape)
- [Monitors and webhooks](https://socialscrape.dev/docs/webhooks?utm_source=npm&utm_medium=package&utm_campaign=n8n-nodes-socialscrape)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Development

```
npm install
npm run lint     # n8n-node lint, the rules n8n's review runs
npm run build    # n8n-node build, writes dist/
```

`nodes/SocialScrape/generated.ts` and `OPERATIONS.md` are generated from the SocialScrape endpoint registry. Releases are published to npm by the `publish.yml` GitHub Actions workflow, with a provenance statement.

## License

[MIT](LICENSE.md)
