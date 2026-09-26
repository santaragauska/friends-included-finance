const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
function headers(extra={}) { return { apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json', ...extra }; }
async function db(path, options={}) {
  if (!url || !key) throw new Error('Server database settings are not configured.');
  const response = await fetch(url+'/rest/v1/'+path, { ...options, headers:headers(options.headers) });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}
function send(res,status,value) { res.status(status).json(value); }
module.exports = { db, send };
