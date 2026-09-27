const { PEOPLE, db, send, cents, money, requireManager, validSplit, calculateCommissions, attemptSheetSync, notify } = require('./_shared');

async function employee(name) { return (await db(`employees?name=eq.${encodeURIComponent(name)}&select=*`))[0]; }
async function people() { const all = await db('employees?select=id,name'); return PEOPLE.map(name => all.find(p => p.name === name)); }
async function get(id) { return (await db(`transactions?id=eq.${id}&select=*`))[0]; }
async function splitsFor(t) {
  if (t.kind !== 'sale') return [];
  const [splits, staff] = await Promise.all([db(`commission_splits?transaction_id=eq.${t.id}&select=*`), people()]);
  return splits.map(s => ({ ...s, name: staff.find(x => x.id === s.employee_id)?.name }));
}
function decisionMessage(t, rows) {
  if (t.kind === 'sale') {
    const ordered = PEOPLE.map(name => rows.find(s => s.name === name));
    const proposed = ordered.map(s => Number(s.proposed_percent));
    const final = ordered.map(s => Number(s.final_percent));
    const pool = ordered.reduce((sum, s) => sum + Number(s.earned_amount || 0), 0);
    const changed = proposed.some((value, index) => value !== final[index]);
    return `${t.reference} approved${changed ? ' — commission split changed' : ''}. Sale ${money(t.amount)}; total commission ${money(pool)}. ${PEOPLE.map((name, index) => `${name.split(' ')[0]}: ${proposed[index]}% → ${final[index]}% (${money(ordered[index].earned_amount)})`).join('; ')}.`;
  }
  const changed = t.proposed_allocation !== t.final_allocation;
  return `${t.reference}${changed ? ' — allocation changed' : ' allocation confirmed'}. ${money(t.amount)}: ${t.description}. Proposed: ${t.proposed_allocation}; approved: ${t.final_allocation}.`;
}
function validate(i) {
  if (!i.reference || !/^[SE][0-9]+$/i.test(i.reference)) throw new Error('Use a reference like S01 or E01.');
  if (!['sale', 'expense'].includes(i.kind) || !i.description?.trim()) throw new Error('Type and description are required.');
  if (!(Number(i.amount) > 0)) throw new Error('Amount must be greater than zero.');
  if (i.kind === 'sale') { if (!i.customer?.trim() || !['A', 'B'].includes(i.project)) throw new Error('Customer and project are required for a sale.'); validSplit(i.splits); }
  if (i.kind === 'expense' && (!['Materials', 'Travel', 'Other'].includes(i.category) || !['A', 'B', 'company_overhead'].includes(i.proposedAllocation))) throw new Error('Choose an expense category and allocation.');
}

async function create(i, source = 'website', chatId = null) {
  validate(i);
  i.reference = i.reference.toUpperCase();
  const reporter = await employee(i.employee);
  if (!reporter) throw new Error('Unknown demonstration employee.');
  if (i.kind === 'sale' && reporter.role !== 'salesperson') throw new Error('Only salespeople can submit sales.');
  if (i.kind === 'expense' && reporter.role !== 'expense_reporter') throw new Error('Only Kevin can submit expenses.');

  const existing = (await db(`transactions?reference=eq.${encodeURIComponent(i.reference)}&select=*`))[0];
  if (existing) {
    const sync = await attemptSheetSync(existing, await splitsFor(existing));
    return { transaction: existing, sync, reused: true };
  }

  const overhead = i.kind === 'expense' && i.proposedAllocation === 'company_overhead';
  const row = { reference: i.reference, kind: i.kind, submitter_id: reporter.id, submitter_name: reporter.name, submitter_role: reporter.role, source, originating_chat_id: chatId || reporter.linked_telegram_chat_id || null, customer: i.kind === 'sale' ? i.customer.trim() : null, project: i.kind === 'sale' ? i.project : null, description: i.description.trim(), amount: cents(i.amount), expense_category: i.kind === 'expense' ? i.category : null, proposed_allocation: i.kind === 'expense' ? i.proposedAllocation : null, final_allocation: overhead ? 'company_overhead' : null, status: i.kind === 'sale' ? 'pending_approval' : overhead ? 'overhead' : 'awaiting_allocation', sheet_sync_status: 'pending', notification_status: 'not_applicable' };
  const saved = (await db('transactions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }))[0];
  if (i.kind === 'sale') {
    const staff = await people(), percentages = validSplit(i.splits);
    await db('commission_splits', { method: 'POST', body: JSON.stringify(staff.map((p, n) => ({ transaction_id: saved.id, employee_id: p.id, proposed_percent: percentages[n] }))) });
  }
  const sync = await attemptSheetSync(saved, await splitsFor(saved));
  return { transaction: saved, sync, reused: false };
}

async function approve(body) {
  const manager = await requireManager(body.actorEmployeeId);
  const t = await get(body.id);
  if (!t) throw new Error('Transaction not found.');
  if (['approved', 'overhead'].includes(t.status)) return { message: 'This record is already final; totals were not changed.' };
  if (t.kind === 'sale') {
    const percentages = validSplit(body.splits), rows = await splitsFor(t), commission = calculateCommissions(t.amount, percentages);
    for (let n = 0; n < 3; n++) {
      const split = rows.find(s => s.name === PEOPLE[n]);
      await db(`commission_splits?transaction_id=eq.${t.id}&employee_id=eq.${split.employee_id}`, { method: 'PATCH', body: JSON.stringify({ final_percent: percentages[n], earned_amount: commission.amounts[n] }) });
    }
    await db(`transactions?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', manager_id: manager.id, manager_decided_at: new Date().toISOString(), notification_status: 'pending' }) });
  } else {
    if (!['A', 'B', 'company_overhead'].includes(body.project)) throw new Error('Choose a final allocation.');
    await db(`transactions?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ final_allocation: body.project, status: 'approved', manager_id: manager.id, manager_decided_at: new Date().toISOString(), notification_status: 'pending' }) });
  }
  const updated = await get(t.id), splits = await splitsFor(updated), sync = await attemptSheetSync(updated, splits), delivery = await notify(updated, decisionMessage(updated, splits));
  return { message: `${t.reference} approved.${sync.status === 'failed' ? ' Sheet sync failed; retry is available.' : ''}${delivery.status === 'failed' ? ' Telegram delivery failed; retry is available.' : ''}`, sync, delivery };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const result = await create(req.body);
      const prefix = result.reused ? `${result.transaction.reference} was already saved; no duplicate was created.` : `${result.transaction.reference} saved successfully.`;
      return send(res, 201, { ...result, message: `${prefix}${result.sync.status === 'failed' ? ' Google Sheets sync is pending; retry this same reference safely.' : ''}` });
    }
    if (req.method === 'PATCH') return send(res, 200, await approve(req.body));
    return send(res, 405, { error: 'Method not allowed' });
  } catch (error) { return send(res, 400, { error: error.message }); }
};
module.exports.createFromBot = create;
module.exports.splitsFor = splitsFor;
module.exports.decisionMessage = decisionMessage;
