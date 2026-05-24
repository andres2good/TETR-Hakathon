import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`[ENV] Variable requerida faltante: ${name}\nRevisa tu archivo .env`);
  }
  return value.trim();
}

function optionalEnv(name, defaultValue = '') {
  return (process.env[name] || defaultValue).trim();
}

export const env = {
  PORT:               parseInt(optionalEnv('PORT', '3000'), 10),
  NODE_ENV:           optionalEnv('NODE_ENV', 'development'),
  SERVER_URL:         optionalEnv('SERVER_URL', 'http://localhost:3000'),
  IS_PRODUCTION:      optionalEnv('NODE_ENV') === 'production',

  ANTHROPIC_API_KEY:  requireEnv('ANTHROPIC_API_KEY'),
  CLAUDE_MODEL:       optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-6'),

  DEEPGRAM_API_KEY:   requireEnv('DEEPGRAM_API_KEY'),
  DEEPGRAM_MODEL:     optionalEnv('DEEPGRAM_MODEL', 'nova-3'),

  CARTESIA_API_KEY:   requireEnv('CARTESIA_API_KEY'),
  CARTESIA_VOICE_ID:  requireEnv('CARTESIA_VOICE_ID'),
  CARTESIA_MODEL:     optionalEnv('CARTESIA_MODEL', 'sonic-3'),

  SUPABASE_URL:              requireEnv('SUPABASE_URL'),
  SUPABASE_ANON_KEY:         requireEnv('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  APP_SECRET_KEY:     requireEnv('APP_SECRET_KEY'),
  LOG_LEVEL:          optionalEnv('LOG_LEVEL', 'info'),
};
