const { db, send } = require('./_shared');
module.exports = async (req, res) => {
 if (req.method === 'GET') return send(res, 200, { ok:true, service:'telegram-webhook' });
 if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
 try {
  const m=req.body?.message; if(!m?.chat || !m?.from) return send(res,200,{ok:true});
  const rows=await db(`employees?telegram_user_id=eq.${encodeURIComponent(String(m.from.id))}&select=*`);
  const token=process.env.TELEGRAM_BOT_TOKEN;
  const text=rows[0] ? `Hello ${rows[0].name}. Your role is linked as ${rows[0].role}.` : `Your Telegram ID is ${m.from.id}. Ask Svetlana to link it to your homework role.`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:m.chat.id,text})});
  return send(res,200,{ok:true});
 } catch(error) { return send(res,500,{error:error.message}); }
};
