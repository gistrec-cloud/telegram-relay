# telegram-relay

A small AWS Lambda that forwards requests to the Telegram Bot API. Use it when your server can't reach `api.telegram.org`, for example because Telegram is blocked where it runs.

The relay checks a shared token, passes Bot API calls through unchanged and streams the response back. Long polling with `getUpdates` and file downloads both work.

## How it works

```
your bot ──► Lambda Function URL (allowed region) ──► api.telegram.org
            x-relay-token: <token>
            /bot<bot token>/<method>
            /file/bot<bot token>/<file path>
```

- Requests without a valid `x-relay-token` get `403`.
- Only Bot API paths are forwarded: `/bot<token>/<method>` and `/file/bot<token>/<path>`. Anything else gets `404`, so the relay can't be used to reach other Telegram endpoints.
- Only `Content-Type` and `Accept` go upstream. The relay token is never forwarded.
- The relay doesn't store or log requests.

## Deploy

1. Create a Lambda function:
   - runtime: Node.js 24 (`nodejs24.x`)
   - handler: `index.handler`
   - memory: 128 MB
   - timeout: 60 s
2. Upload the code:
   ```bash
   npm run package
   aws lambda update-function-code --function-name telegram-relay --zip-file fileb://function.zip
   ```
3. Add a Function URL with auth type `NONE` and invoke mode `RESPONSE_STREAM`.
4. Set the tokens (see below).

## Tokens

| Variable | Meaning |
|---|---|
| `RELAY_TOKENS` | Comma-separated list of accepted tokens |
| `RELAY_TOKEN` | A single token |

Give each bot or project its own token. That way you can revoke one by removing its token, and nobody else is affected. To generate a token:

```bash
openssl rand -hex 32
```

## Client setup

Replace `https://api.telegram.org` with the Function URL and send the token in `x-relay-token` on every request, file downloads included.

```bash
curl "https://<id>.lambda-url.<region>.on.aws/bot$BOT_TOKEN/getMe" \
  -H "x-relay-token: $RELAY_TOKEN"
```

Most bot libraries let you change the API base URL and add headers to their HTTP client.

## Long polling or webhook

Long polling works through the relay. Each `getUpdates` call is one Lambda invocation that stays open until an update arrives or the poll times out. Keep the poll `timeout` well below the function timeout. 25 to 50 seconds against a 60 second function is fine.

The function is busy almost all the time, so you pay for that. At 128 MB that comes to roughly 330,000 GB-seconds a month, which fits the Lambda free tier if nothing else on the account uses it. Otherwise it's a few dollars a month.

A webhook is cheaper: Telegram calls your server directly and the relay only carries outgoing calls. That only works if Telegram can reach your server. If the network blocks Telegram in both directions, use long polling.

## Limits

- Requests are capped at **6 MB** by Lambda. Upload large files with a URL instead of the body.
- Responses can be up to 200 MB when streamed. Downloading files through the Bot API is capped at 20 MB by Telegram anyway.

## Security

The bot token travels in the URL path, which is how the Bot API works. The relay doesn't log anything, but your own HTTP client might print URLs in error messages, so redact the bot token there.

The Function URL is public. Anyone who knows it can call it, but without a valid token they only get `403`. Keep the URL and the tokens out of public repos and logs.

## Development

```bash
npm test
```

Tests run against a mocked Lambda runtime and `fetch`, with no network calls.

## License

MIT
