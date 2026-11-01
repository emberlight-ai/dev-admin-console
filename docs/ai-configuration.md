# AI configuration

All AI calls use Vertex AI in Google Cloud project `the-method-392512` (project number `691409042410`). Next.js routes and Supabase functions share `supabase/functions/_shared/vertex-config.ts`. A different `GOOGLE_CLOUD_PROJECT_ID` is rejected rather than silently charging another project.

The app uses Google's current `@google/genai` SDK in Vertex mode. The older `@google/generative-ai` and `@google-cloud/vertexai` clients are not used. Next.js requires Node.js 20.9 or newer.

## Credentials

- Local Next.js: set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file outside the repository. The ignored local `.env` is configured for the existing matching file in Downloads; move that file to a stable private location and update the path if needed.
- Deployed Next.js: use the host's Application Default Credentials, or set both `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` as server-only environment variables. A JSON file path from your laptop will not work on the server.
- Supabase: keep the existing `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` secrets. The deployed credentials were verified to match this project. Both actual newlines and escaped `\n` sequences in the private key are supported.

Never commit a service-account JSON or put credentials in a `NEXT_PUBLIC_` variable. No Gemini API key is required.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT_ID` | `the-method-392512` | The only permitted AI project |
| `GOOGLE_CLOUD_LOCATION` | `global` | Vertex location |
| `AI_UTILITY_MODEL` | `gemini-3.1-flash-lite` | Edge-function utility tasks, openers, fallback replies |
| `AI_REPLY_MODEL` | `gemini-3.1-flash-lite` | Edge-function primary replies |

All reply paths now use stable Gemini 3.1 Flash-Lite. Short chat calls are capped at 256 output tokens and use minimal thinking; greetings and follow-ups use lower caps. Automatic continuation is disabled so an output-limit stop cannot silently trigger another billed request.

## Deploying this cleanup

1. Configure Vertex credentials on the Next.js host before deploying the updated routes.
2. Set both `AI_UTILITY_MODEL` and `AI_REPLY_MODEL` to `gemini-3.1-flash-lite`. Keep the legacy model alias only until every older Edge Function bundle has been redeployed.
3. Deploy the updated Next.js app and affected Edge Functions, including the standalone `dh-nearby-dispatch` function (not currently included in `functions:deploy`).
4. After all deployments succeed, remove the unused `AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`, and `AI_INTEGRATIONS_GEMINI_MODEL` secrets from Supabase and any obsolete web-host settings. The code no longer reads them. This local cleanup does not delete deployed secrets or revoke the old key.

Firebase authentication and notifications are separate from AI. Their project/configuration intentionally remains unchanged; do not remove them just because they refer to another Google project.

## Verification

Run `node --import tsx --test src/lib/vertex-config.test.ts` and `npx tsc --noEmit`. The configuration tests do not contact Google or incur AI charges.
