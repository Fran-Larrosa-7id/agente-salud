import 'dotenv/config';
import OpenAI from 'openai';
const id = process.argv[2];
if (!id || !/^[-_a-zA-Z0-9]+$/.test(id)) {
  console.error('Uso: npm run cleanup -- <session_id>');
  process.exit(1);
}
const client = new OpenAI();
await client.beta.agents.sessions.delete(id);
console.log('Sesión eliminada:', id);
