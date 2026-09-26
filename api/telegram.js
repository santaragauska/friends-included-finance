const { db, send, syncSheet } = require('./_shared');
async function reply(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram is not configured yet.');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:chatId,text}) });
  if (!r.ok) throw new Error('Telegram reply could not be delivered.');
}
async function safeSync(tx, splits) { try { await syncSheet(tx, splits); return ''; } catch (_) { return ' Google Sheets sync is pending.'; } }
module.exports = async (req,res) => {
 if (req.method==='GET') return send(res,200,{ok:true,service:'telegram-webhook'});
 if (req.method!=='POST') return send(res,405,{error:'Method not allowed'});
 const m=req.body?.message; if(!m?.from||!m?.chat) return send(res,200,{ok:true});
 const chatId=String(m.chat.id);
 try {
  const person=(await db(`employees?telegram_user_id=eq.${encodeURIComponent(String(m.from.id))}&select=*`))[0];
  if(!person){await reply(chatId,`Your Telegram ID is ${m.from.id}. Ask Svetlana to link it to your homework role.`);return send(res,200,{ok:true});}
  const text=(m.text||'').trim();
  if(text.startsWith('/sale ')){
   if(person.role!=='salesperson') throw new Error('Only linked salespeople may submit sales.');
   const [reference,customer,project,description,amount,richard,anastasia,jeanClaude]=text.slice(6).split('|').map(x=>x.trim()), shares=[richard,anastasia,jeanClaude].map(Number);
   if(!/^[S][0-9]+$/.test(reference)||!customer||!['A','B'].includes(project)||!(Number(amount)>0)||Math.round(shares.reduce((a,b)=>a+b,0)*100)!==10000) throw new Error('Use /sale S01|Customer|A or B|Description|Amount|Richard %|Anastasia %|Jean-Claude %.');
   if((await db(`transactions?reference=eq.${encodeURIComponent(reference)}&select=id`)).length) throw new Error(`${reference} already exists.`);
   const tx=(await db('transactions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({reference,kind:'sale',submitter_id:person.id,submitter_role:person.role,source:'telegram',originating_chat_id:chatId,customer,project,description,amount:Number(amount),status:'pending_approval'})}))[0];
   const staff=await db('employees?role=eq.salesperson&select=id,name'), ids=Object.fromEntries(staff.map(x=>[x.name,x.id]));
   await db('commission_splits',{method:'POST',body:JSON.stringify(['Richard Darling','Anastasia Ferrari','Jean-Claude Bērziņš'].map((n,i)=>({transaction_id:tx.id,employee_id:ids[n],proposed_percent:shares[i]})))});
   const note=await safeSync(tx,['Richard Darling','Anastasia Ferrari','Jean-Claude Bērziņš'].map((name,i)=>({name,proposed_percent:shares[i]})));
   await reply(chatId,`${reference} recorded: €${Number(amount).toFixed(2)} for Project ${project}. Status: Pending approval.${note}`);
  } else if(text.startsWith('/expense ')) {
   if(person.role!=='expense_reporter') throw new Error('Only Kevin may submit expenses.');
   const [reference,category,proposed_allocation,description,amount]=text.slice(9).split('|').map(x=>x.trim());
   if(!/^[E][0-9]+$/.test(reference)||!['Materials','Travel','Other'].includes(category)||!['A','B','company_overhead'].includes(proposed_allocation)||!description||!(Number(amount)>0)) throw new Error('Use /expense E01|Materials|A|Description|120.');
   if((await db(`transactions?reference=eq.${encodeURIComponent(reference)}&select=id`)).length) throw new Error(`${reference} already exists.`);
   const overhead=proposed_allocation==='company_overhead'; const tx=(await db('transactions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({reference,kind:'expense',submitter_id:person.id,submitter_role:person.role,source:'telegram',originating_chat_id:chatId,description,amount:Number(amount),expense_category:category,proposed_allocation,final_allocation:overhead?'company_overhead':null,status:overhead?'overhead':'awaiting_allocation'})}))[0];
   const note=await safeSync(tx); await reply(chatId,`${reference} recorded: €${Number(amount).toFixed(2)}; proposed ${proposed_allocation}. Status: ${overhead?'Company overhead':'Awaiting allocation'}.${note}`);
  } else await reply(chatId,`Hello ${person.name}. Send /sale S01|Customer|A|Description|1000|50|30|20 or /expense E01|Materials|A|Description|120`);
  return send(res,200,{ok:true});
 } catch(error) { try{await reply(chatId,`Not recorded: ${error.message}`);}catch(_){} return send(res,200,{ok:true,error:error.message}); }
};
