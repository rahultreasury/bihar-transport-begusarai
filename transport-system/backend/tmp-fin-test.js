const axios = require('axios');
(async () => {
  const login = await axios.post('http://localhost:3000/api/auth/admin-login', { email: 'admin@bihartransport.com', password: 'admin123' }).catch(e => { console.log('LOGIN FAIL', e.response?.status, JSON.stringify(e.response?.data)); process.exit(1); });
  const token = login.data.data?.token || login.data.token;
  console.log('token len', token && token.length);
  const api = axios.create({ baseURL: 'http://localhost:3000/api', headers: { Authorization: `Bearer ${token}` } });
  for (const p of ['/financials/summary', '/financials/receivables', '/financials/payables', '/financials/transactions', '/financials/advances', '/financials/settlements', '/admin/clients', '/admin/clients/1/statement', '/trips/lookup/offline-clients', '/trips/lookup/clients']) {
    try {
      const r = await api.get(p);
      console.log('OK', p, r.status, JSON.stringify(r.data).slice(0, 200));
    } catch (e) {
      console.log('ERR', p, e.response?.status, JSON.stringify(e.response?.data).slice(0, 300));
    }
  }
})();