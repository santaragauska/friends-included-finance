const { db, send } = require('./_shared');

async function reply(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram is not configured yet.');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) throw new Error('Telegram could not deliver the reply.');
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { ok: true, service: 'telegram-webhook' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const message = req.body?.message;
    if (!message?.from || !message?.chat) return send(res, 200, { ok: true });
    const userId = String(message.from.id);
    const chatId = String(message.chat.id);
    const employees = await db(`employees?telegram_user_id=eq.${encodeURIComponent(userId)}&select=*`);
    if (!employees[0]) {
      await reply(chatId, `Your Telegram ID is ${userId}. Ask Svetlana to link it to your homework role before submitting a record.`);
      return send(res, 200, { ok: true });
    }
    const person = employees[0];
    if ((message.text || '').startsWith('/sale ')) {
      if (person.role !== 'salesperson') throw new Error('Only linked salespeople may submit sales.');
      const [reference, customer, project, description, amount, richard, anastasia, jeanClaude] = message.text.slice(6).split('|').map(x => x.trim());
      const shares = [richard, anastasia, jeanClaude].map(Number);
      if (!/^[S][0-9]+$/.test(reference) || !customer || !['A','B'].includes(project) || !(Number(amount) > 0) || Math.round(shares.reduce((a,b)=>a+b,0)*100) !== 10000) throw new Error('Use /sale S01|Customer|A or B|Description|Amount|Richard %|Anastasia %|Jean-Claude %. Shares must total 100%.');
      const saved = await db('transactions', { method:'POST', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ reference, kind:'sale', submitter_id:person.id, submitter_role:person.role, source:'telegram', originating_chat_id:chatId, customer, project, description, amount:Number(amount), status:'pending_approval' }) });
      const staff = await db('employees?role=eq.salesperson&select=id,name');
      const ids = Object.fromEntries(staff.map(p => [p.name,p.id]));
      await db('commission_splits', { method:'POST', body:JSON.stringify([
        { transaction_id:saved[0].id, employee_id:ids['Richard Darling'], proposed_percent:shares[0] },
        { transaction_id:saved[0].id, employee_id:ids['Anastasia Ferrari'], proposed_percent:shares[1] },
        { transaction_id:saved[0].id, employee_id:ids['Jean-Claude Bērziņš'], proposed_percent:shares[2] }
      ]) });
      await reply(chatId, `${reference} saved as a pending sale for manager approval.`);
    } else {
      await reply(chatId, `Hello ${person.name}. Your role is linked as ${person.role}. Send /sale for the sales format.`);
    }
    return send(res, 200, { ok: true });
  } catch (error) { return send(res, 500, { error: error.message }); }
};
