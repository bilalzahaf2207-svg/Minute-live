// Serveur MCP minimal (HTTP « streamable », réponses JSON, sans état) exposant la liste
// blanche de commandes à l'app Claude (connecteur personnalisé) et à Claude Code.
import { COMMANDS, execute } from './commands.js';

const PROTOCOL = '2025-06-18';
const SCHEMAS = {
  prepare_videos: { date: { type: 'string', description: 'AAAA-MM-JJ, défaut demain' }, series: { type: 'string' } },
  explain_failures: { since_hours: { type: 'number', description: 'défaut 24' } },
  plan_series: { theme: { type: 'string' }, count: { type: 'number' } },
  approve: { kind: { type: 'string', enum: ['topic', 'series', 'video'] }, id: { type: 'number' }, ids: { type: 'array', items: { type: 'number' } }, series: { type: 'string' } },
  reject: { kind: { type: 'string', enum: ['topic', 'video'] }, id: { type: 'number' }, reason: { type: 'string' } },
  edit_script: { id: { type: 'number' }, scenes: { type: 'array', items: { type: 'string' } }, caption: { type: 'string' } },
  set_brand: { name: { type: 'string' }, handle: { type: 'string' }, preset: { type: 'string', enum: ['atelier', 'showroom', 'turbo'] }, cta: { type: 'string' } },
  import_series: { payload: { type: 'object', description: '{ series: [{ series, topics: [{ title, facts[], hashtags[] }] }] }' } },
};
const REQUIRED = { plan_series: ['theme'], import_series: ['payload'], approve: ['kind'], reject: ['kind', 'id'], edit_script: ['id'] };

function tools() {
  return Object.entries(COMMANDS).map(([name, c]) => ({
    name, description: c.description,
    inputSchema: { type: 'object', properties: SCHEMAS[name] ?? {}, required: REQUIRED[name] ?? [], additionalProperties: false },
  }));
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: {} },
        serverInfo: { name: 'automotive-universe-agent', version: '0.1.0' },
        instructions: "Agent TikTok AUTOMOTIVE UNIVERSE. Utilise ces outils pour piloter la production. Le budget ne peut pas être modifié d'ici. Le propriétaire valide chaque étape : n'appelle approve et confirm_brand que lorsqu'il le demande explicitement, jamais de ta propre initiative." });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: tools() });
    case 'tools/call':
      try {
        const out = await execute(params.name, params.arguments ?? {}, 'claude-mcp');
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Erreur : ${e.message}` }], isError: true });
      }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode non prise en charge : ${method}` } };
  }
}

export async function mcpHttp(body) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? out : null;
  }
  return handle(body);
}
