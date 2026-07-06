import { charge } from '../services/paymentProcessor';
import { query } from '../lib/db';

export function registerOrders(app: any) {
  app.get('/orders', async () => {
    const rows = await query('select * from orders');
    return rows;
  });
  app.post('/orders', async (body: any) => {
    await charge(body.amount);
    return { ok: true };
  });
}
