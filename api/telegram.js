const { db, send } = require('./_shared');
const { createFromBot } = require('./transactions');

async function reply(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram is not configured yet.');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) });
  if (!response.ok) throw new Error('Telegram could not deliver the reply.');
}
function submissionMessage(result, detail) {
  const saved = result.reused
    ? `${result.transaction.reference} was already saved; no duplicate was created.`
    : `${result.transaction.reference} saved successfully.`;
  const sync = result.sync.status === 'failed'
    ? ' Google Sheets did not sync yet. Send the same reference again to retry safely.'
    : ' Google Sheets synced.';
  return `${saved} ${detail}.${sync}`;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { ok: true, service: 'telegram-webhook' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const message = req.body?.message;
  if (!message?.from || !message?.chat) return send(res, 200, { ok: true });
  const chatId = String(message.chat.id);
  const text = (message.text || '').trim();
  let person;
  try {
    person = (await db(`employees?telegram_user_id=eq.${encodeURIComponent(String(message.from.id))}&select=*`))[0];
    if (!person) {
      await reply(chatId, `Your Telegram ID is ${message.from.id}. Ask Svetlana to link it to your fictional homework role before submitting a record.`);
      return send(res, 200, { ok: true });
    }
  } catch (error) { return send(res, 200, { ok: false, error: error.message }); }

  let result, detail;
  try {
    if (text.startsWith('/sale ')) {
      const [reference, customer, project, description, amount, richard, anastasia, jeanClaude] = text.slice(6).split('|').map(x => x.trim());
      result = await createFromBot({ employee: person.name, kind: 'sale', reference, customer, project, description, amount, splits: { richard, anastasia, jeanClaude } }, 'telegram', chatId);
      detail = `${amount} sale for Project ${project}. Status: Pending approval`;
    } else if (text.startsWith('/expense ')) {
      const [reference, category, proposedAllocation, description, amount] = text.slice(9).split('|').map(x => x.trim());
      result = await createFromBot({ employee: person.name, kind: 'expense', reference, category, proposedAllocation, description, amount }, 'telegram', chatId);
      detail = `${amount} expense; proposed ${proposedAllocation}. Status: ${proposedAllocation === 'company_overhead' ? 'Company overhead' : 'Awaiting allocation'}`;
    } else {
      await reply(chatId, `Hello ${person.name}.\nSale: /sale S01|Customer|A|Description|1000|50|30|20\nExpense: /expense E01|Materials|A|Description|120`);
      return send(res, 200, { ok: true });
    }
  } catch (error) {
    try { await reply(chatId, `Not recorded: ${error.message}`); } catch (_) {}
    return send(res, 200, { ok: true, saved: false, error: error.message });
  }

  // A failed acknowledgement must never turn a saved transaction into “Not recorded”.
  try { await reply(chatId, submissionMessage(result, detail)); }
  catch (error) { return send(res, 200, { ok: true, saved: true, replyStatus: 'failed', error: error.message, transaction: result.transaction.reference }); }
  return send(res, 200, { ok: true, saved: true, transaction: result.transaction.reference, sync: result.sync.status });
};
