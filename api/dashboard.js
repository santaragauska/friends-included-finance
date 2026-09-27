const { db, send } = require('./_shared');

async function viewer(id) {
  if (!id) throw new Error('Choose a demonstration role first.');
  const person = (await db(`employees?id=eq.${encodeURIComponent(id)}&select=id,name,role`))[0];
  if (!person) throw new Error('The selected demonstration role no longer exists.');
  return person;
}

module.exports = async (req, res) => {
  try {
    const person = await viewer(req.query.actorEmployeeId);
    const [allTransactions, employees, allSplits] = await Promise.all([
      db('transactions?select=*&order=created_at.desc'),
      db('employees?select=id,name,role'),
      db('commission_splits?select=*')
    ]);
    const byId = Object.fromEntries(employees.map(e => [e.id, e]));
    const transactions = person.role === 'manager' ? allTransactions : allTransactions.filter(t => t.submitter_id === person.id);
    const visibleIds = new Set(transactions.map(t => t.id));
    const splits = allSplits.filter(s => visibleIds.has(s.transaction_id)).map(s => ({ ...s, employee_name: byId[s.employee_id]?.name }));

    if (person.role !== 'manager') {
      const approvedCommission = splits.filter(s => s.employee_id === person.id && s.final_percent != null).reduce((total, s) => total + Number(s.earned_amount || 0), 0);
      return send(res, 200, { transactions, employees, splits, metrics: { personal: { submittedTotal: transactions.reduce((total, t) => total + Number(t.amount), 0), approvedCommission } } });
    }

    const approved = allTransactions.filter(t => t.status === 'approved');
    const projects = { A: { income: 0, commissions: 0, expenses: 0 }, B: { income: 0, commissions: 0, expenses: 0 } };
    let overhead = 0, awaiting = 0;
    for (const t of allTransactions) if (t.kind === 'expense' && t.status === 'overhead') overhead += Number(t.amount);
    for (const t of approved) {
      if (t.kind === 'sale') projects[t.project].income += Number(t.amount);
      if (t.kind === 'expense') {
        if (t.final_allocation === 'company_overhead') overhead += Number(t.amount);
        else if (t.final_allocation) projects[t.final_allocation].expenses += Number(t.amount);
      }
    }
    for (const t of allTransactions) if (t.kind === 'expense' && t.status === 'awaiting_allocation') awaiting += Number(t.amount);
    for (const s of allSplits.filter(s => s.final_percent != null)) {
      const tx = allTransactions.find(t => t.id === s.transaction_id);
      if (tx?.status === 'approved' && tx.project) projects[tx.project].commissions += Number(s.earned_amount);
    }
    const commissionByEmployee = Object.fromEntries(employees.filter(e => e.role === 'salesperson').map(e => [e.id, 0]));
    allSplits.filter(s => s.final_percent != null).forEach(s => { commissionByEmployee[s.employee_id] = (commissionByEmployee[s.employee_id] || 0) + Number(s.earned_amount); });
    const result = p => p.income - p.commissions - p.expenses;
    send(res, 200, { transactions, employees, splits, metrics: { projects: { A: { ...projects.A, result: result(projects.A) }, B: { ...projects.B, result: result(projects.B) } }, overhead, awaiting, companyResult: result(projects.A) + result(projects.B) - overhead - awaiting, commissions: Object.entries(commissionByEmployee).map(([id, amount]) => ({ name: byId[id]?.name, amount })) } });
  } catch (error) { send(res, 400, { error: error.message }); }
};
