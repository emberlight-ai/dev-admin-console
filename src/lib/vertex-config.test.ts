import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_REPLY_MODEL,
  DEFAULT_UTILITY_MODEL,
  VERTEX_PROJECT_ID,
  controlledGenerationConfig,
  replyModelName,
  utilityModelName,
  vertexOptions,
} from '../../supabase/functions/_shared/vertex-config';

const env = (values: Record<string, string> = {}) => (name: string) => values[name];

test('defaults to the confirmed Vertex project, global location and ADC credentials', () => {
  assert.deepEqual(vertexOptions(env()), {
    vertexai: true,
    project: VERTEX_PROJECT_ID,
    location: 'global',
  });
});

test('rejects accidental use of a different AI project', () => {
  assert.throws(() => vertexOptions(env({ GOOGLE_CLOUD_PROJECT_ID: 'old-project' })), /AI must use Vertex project/);
});

test('accepts explicit matching project and location', () => {
  const options = vertexOptions(env({ GOOGLE_CLOUD_PROJECT_ID: VERTEX_PROJECT_ID, GOOGLE_CLOUD_LOCATION: 'us-central1' }));
  assert.equal(options.project, VERTEX_PROJECT_ID);
  assert.equal(options.location, 'us-central1');
});

test('requires a complete credential pair', () => {
  assert.throws(() => vertexOptions(env({ GOOGLE_CLIENT_EMAIL: 'test@example.com' })), /Set both/);
  assert.throws(() => vertexOptions(env({ GOOGLE_PRIVATE_KEY: 'test-key' })), /Set both/);
});

test('normalizes escaped private-key newlines without changing real newlines', () => {
  for (const key of ['BEGIN\\nTEST\\nEND', 'BEGIN\nTEST\nEND']) {
    const options = vertexOptions(env({ GOOGLE_CLIENT_EMAIL: 'test@example.com', GOOGLE_PRIVATE_KEY: key }));
    assert.deepEqual(options.googleAuthOptions?.credentials, {
      client_email: 'test@example.com',
      private_key: 'BEGIN\nTEST\nEND',
    });
  }
});

test('uses the existing default model names', () => {
  assert.equal(DEFAULT_UTILITY_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(DEFAULT_REPLY_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(utilityModelName(env()), DEFAULT_UTILITY_MODEL);
  assert.equal(replyModelName(env()), DEFAULT_REPLY_MODEL);
});

test('caps Flash-Lite output and keeps thinking minimal', () => {
  assert.deepEqual(controlledGenerationConfig('gemini-3.1-flash-lite'), {
    maxOutputTokens: 256,
    automaticContinuation: false,
    thinkingConfig: { thinkingLevel: 'MINIMAL' },
  });
  assert.deepEqual(controlledGenerationConfig('gemini-3.1-flash-lite', 96), {
    maxOutputTokens: 96,
    automaticContinuation: false,
    thinkingConfig: { thinkingLevel: 'MINIMAL' },
  });
});

test('allows independent utility and reply model overrides', () => {
  const read = env({ AI_UTILITY_MODEL: 'utility-test', AI_REPLY_MODEL: 'reply-test' });
  assert.equal(utilityModelName(read), 'utility-test');
  assert.equal(replyModelName(read), 'reply-test');
});

test('does not read legacy Gemini API-key settings', () => {
  const read = env({ AI_INTEGRATIONS_GEMINI_API_KEY: 'unused', AI_INTEGRATIONS_GEMINI_MODEL: 'unused' });
  assert.deepEqual(vertexOptions(read), vertexOptions(env()));
  assert.equal(utilityModelName(read), DEFAULT_UTILITY_MODEL);
});
