const { db, send } = require('./_shared');

module.exports = async (req, res) => {
  try {
    const [transactions, employees, splits] = await Promise.all([
      db('transactions?select=*&order=created_at.desc'),
      db('employees?select=id,name,role'),
      db('commission_splits?select=*')
    ]);
    const byId = Object.fromEntries(employees.map(e => [e.id, e]));
    const approved = transactions.filter(t => t.status === 'approved');
    const projects = { A: { income: 0, commissions: 0, expenses: 0 }, B: { income: 0, commissions: 0, expenses: 0 } };
    let overhead = 0, awaiting = 0;
    for (const t of transactions) {
      if (t.kind === 'expense' && t.status === 'overhead') overhead += Number(t.amount);
    }
    for (const t of approved) {
      if (t.kind === 'sale') projects[t.project].income += Number(t.amount);
      if (t.kind === 'expense') {
        if (t.final_allocation === 'company_overhead') overhead += Number(t.amount);
        else if (t.final_allocation) projects[t.final_allocation].expenses += Number(t.amount);
      }
    }
    for (const t of transactions.filter(t => t.kind === 'expense' && t.status === 'awaiting_allocation')) awaiting += Number(t.amount);
    for (const s of splits.filter(s => s.final_percent != null)) {
      const tx = transactions.find(t => t.id === s.transaction_id);
      if (tx?.status === 'approved' && tx.project) projects[tx.project].commissions += Number(s.earned_amount);
    }
    const commissionByEmployee = Object.fromEntries(employees.filter(e => e.role === 'salesperson').map(e => [e.id, 0]));
    splits.filter(s => s.final_percent != null).forEach(s => { commissionByEmployee[s.employee_id] = (commissionByEmployee[s.employee_id] || 0) + Number(s.earned_amount); });
    const result = p => p.income - p.commissions - p.expenses;
    const visibleSplits = splits.map(s => ({ ...s, employee_name: byId[s.employee_id]?.name }));
    send(res, 200, { transactions, employees, splits: visibleSplits, metrics: { projects: { A: { ...projects.A, result: result(projects.A) }, B: { ...projects.B, result: result(projects.B) } }, overhead, awaiting, companyResult: result(projects.A) + result(projects.B) - overhead - awaiting, commissions: Object.entries(commissionByEmployee).map(([id, amount]) => ({ name: byId[id]?.name, amount })) } });
  } catch (error) { send(res, 500, { error: error.message }); }
};
