import 'dotenv/config';
import OpenAI from 'openai';

// This script DOES NOT create an agent session or send a prompt.
// It only attempts to cancel and delete an existing session.
const sessionId = process.argv[2];
if (!/^sess_[A-Za-z0-9_-]+$/.test(sessionId || '')) {
  console.error('Uso: node recover-session.mjs sess_ID_REAL');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('Falta OPENAI_API_KEY en .env');
  process.exit(1);
}
const client = new OpenAI({ maxRetries: 0, timeout: 20_000 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`[RECOVERY] Sesion existente: ${sessionId}`);
  console.log('[RECOVERY] No se creara ninguna sesion ni se ejecutara un agente.');

  try {
    const session = await client.beta.agents.sessions.retrieve(sessionId);
    console.log(`[ESTADO] ${session.status ?? 'desconocido'}`);
  } catch (error) {
    if (error.status === 404) {
      console.log('[OK] La sesion ya no existe en la API (404).');
      return;
    }
    console.warn(`[ESTADO] No se pudo consultar: ${error.status || ''} ${error.message}`);
  }

  try {
    // A stream.abort() is NOT a server-side cancellation.
    await client.beta.agents.sessions.events.create(sessionId, {
      events: [{ type: 'agent.session.input.cancel' }],
    });
    console.log('[CANCEL] Cancelacion solicitada al servidor.');
  } catch (error) {
    if (error.status === 404) {
      console.log('[OK] La sesion ya no existe en la API (404).');
      return;
    }
    // It may already be idle/completed; attempt deletion regardless.
    console.warn(`[CANCEL] No se pudo solicitar o ya no habia un turno activo: ${error.status || ''} ${error.message}`);
  }

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const result = await client.beta.agents.sessions.delete(sessionId);
      if (!result.deleted) throw new Error('No se recibio confirmacion deleted=true');
      console.log(`[OK] Sesion eliminada: ${result.id}`);
      return;
    } catch (error) {
      if (error.status === 404) {
        console.log('[OK] La sesion ya no existe en la API (404).');
        return;
      }
      if (error.status !== 409) {
        console.error(`[ERROR] No se pudo eliminar: ${error.status || ''} ${error.message}`);
        process.exitCode = 1;
        return;
      }
      console.warn(`[ESPERA] Sigue en proceso (409), intento ${attempt}/10.`);
      if (attempt < 10) await delay(4000);
    }
  }
  console.error('[PENDIENTE] No se pudo confirmar la eliminacion. Revisar la sesion en Agents > Sessions; no iniciar otra prueba aun.');
  process.exitCode = 1;
}
await main();
