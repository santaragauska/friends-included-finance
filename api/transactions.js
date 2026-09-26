const { db, send } = require('./_shared');
const cents = value => Math.round(Number(value) * 100) / 100;
const requireManager = role => { if (role !== 'manager') throw new Error('Only Svetlana may approve or correct records.'); };

function validate(input) {
  if (!input.reference || !/^[SE][0-9]+$/.test(input.reference)) throw new Error('Use a reference like S01 or E01.');
  if (!(Number(input.amount) > 0)) throw new Error('Amount must be greater than zero.');
  if (input.kind === 'sale') {
    const sum = ['richard', 'anastasia', 'jeanClaude'].reduce((n, k) => n + Number(input.splits?.[k] || 0), 0);
    if (Math.round(sum * 100) !== 10000) throw new Error('Commission shares must total exactly 100%.');
    if (!input.customer || !input.project) throw new Error('Customer and project are required for a sale.');
  }
  if (input.kind === 'expense' && (!input.category || !input.proposedAllocation)) throw new Error('Category and proposed allocation are required for an expense.');
}
async function employee(name) { const rows = await db(`employees?name=eq.${encodeURIComponent(name)}&select=*`); return rows[0]; }
async function create(req, res) {
  const input = req.body; validate(input);
  const reporter = await employee(input.employee);
  if (!reporter) throw new Error('Unknown demonstration employee.');
  if (input.kind === 'sale' && reporter.role !== 'salesperson') throw new Error('Only salespeople can submit sales.');
  if (input.kind === 'expense' && reporter.role !== 'expense_reporter') throw new Error('Only Kevin can submit expenses.');
  const overhead = input.kind === 'expense' && input.proposedAllocation === 'company_overhead';
  const row = { reference: input.reference, kind: input.kind, submitter_id: reporter.id, submitter_role: reporter.role, source: 'website', originating_chat_id: reporter.linked_telegram_chat_id, customer: input.kind === 'sale' ? input.customer : null, project: input.kind === 'sale' ? input.project : null, description: input.description, amount: cents(input.amount), expense_category: input.kind === 'expense' ? input.category : null, proposed_allocation: input.kind === 'expense' ? input.proposedAllocation : null, final_allocation: overhead ? 'company_overhead' : null, status: input.kind === 'sale' ? 'pending_approval' : (overhead ? 'overhead' : 'awaiting_allocation') };
  const saved = await db('transactions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (input.kind === 'sale') {
    const names = { richard: 'Richard Darling', anastasia: 'Anastasia Ferrari', jeanClaude: 'Jean-Claude Bērziņš' };
    const people = await Promise.all(Object.entries(names).map(async ([key, name]) => ({ employee: await employee(name), pct: Number(input.splits[key]) })));
    await db('commission_splits', { method: 'POST', body: JSON.stringify(people.map(p => ({ transaction_id: saved[0].id, employee_id: p.employee.id, proposed_percent: p.pct }))) });
  }
  send(res, 201, { transaction: saved[0], message: `${input.reference} saved successfully.` });
}
async function approve(req, res) {
  requireManager(req.body.role);
  const { id, project, splits } = req.body;
  const rows = await db(`transactions?id=eq.${id}&select=*`); const tx = rows[0]; if (!tx) throw new Error('Transaction not found.');
  if (tx.status === 'approved' || tx.status === 'overhead') return send(res, 200, { message: 'This record is already final; totals were not changed.' });
  const manager = await employee('Svetlana de Monte Carlo');
  if (tx.kind === 'sale') {
    const final = splits || {}; const pct = Object.values(final).map(Number); if (pct.length !== 3 || Math.round(pct.reduce((a,b) => a+b,0)*100) !== 10000) throw new Error('Final commission shares must total 100%.');
    const people = await Promise.all(['Richard Darling','Anastasia Ferrari','Jean-Claude Bērziņš'].map(employee));
    const pool = cents(Number(tx.amount) * .10); let amounts = pct.map(p => cents(pool * p / 100));
    const delta = cents(pool - amounts.reduce((a,b)=>a+b,0)); const high = Math.max(...pct); const tieOrder = [0,1,2]; amounts[tieOrder.find(i => pct[i] === high)] = cents(amounts[tieOrder.find(i => pct[i] === high)] + delta);
    for (let i=0;i<3;i++) await db(`commission_splits?transaction_id=eq.${id}&employee_id=eq.${people[i].id}`, { method:'PATCH', body: JSON.stringify({ final_percent:pct[i], earned_amount:amounts[i] }) });
    await db(`transactions?id=eq.${id}`, { method:'PATCH', body: JSON.stringify({ status:'approved', manager_id:manager.id, manager_decided_at:new Date().toISOString() }) });
  } else {
    const final = project; if (!['A','B','company_overhead'].includes(final)) throw new Error('Choose a final allocation.');
    await db(`transactions?id=eq.${id}`, { method:'PATCH', body: JSON.stringify({ final_allocation:final, status:'approved', manager_id:manager.id, manager_decided_at:new Date().toISOString() }) });
  }
  send(res, 200, { message: `${tx.reference} approved.` });
}
module.exports = async (req, res) => { try { if (req.method === 'POST') return await create(req,res); if (req.method === 'PATCH') return await approve(req,res); return send(res,405,{error:'Method not allowed'}); } catch (error) { send(res,400,{error:error.message}); } };
