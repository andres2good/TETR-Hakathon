import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Crear o actualizar un usuario
export async function upsertUser({ deviceId, language = 'es' }) {
  const { data, error } = await supabase
    .from('users')
    .upsert({ device_id: deviceId, language, last_seen: new Date().toISOString() }, { onConflict: 'device_id' })
    .select('id, name, language')
    .single();

  if (error) {
    logger.error('[Supabase] Error upsert usuario', { error: error.message });
    return null;
  }
  return data;
}

// Guardar una acción ejecutada (historial)
export async function logAction({ userId, sessionId, userText, agentText, action }) {
  const { error } = await supabase.from('actions').insert({
    user_id: userId,
    session_id: sessionId,
    user_text: userText,
    agent_text: agentText,
    action_type: action?.type,
    action_payload: action ? JSON.stringify(action) : null,
  });

  if (error) logger.error('[Supabase] Error guardando acción', { error: error.message });
}

// Guardar sesión
export async function saveSession({ id, userId, startedAt }) {
  const { error } = await supabase.from('sessions').insert({
    id, user_id: userId, started_at: startedAt,
  });
  if (error) logger.error('[Supabase] Error guardando sesión', { error: error.message });
}

// Actualizar sesión al terminar
export async function endSession({ id, actionsCount }) {
  const { error } = await supabase.from('sessions')
    .update({ ended_at: new Date().toISOString(), actions_count: actionsCount })
    .eq('id', id);
  if (error) logger.error('[Supabase] Error cerrando sesión', { error: error.message });
}
