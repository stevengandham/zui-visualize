import { query } from '../lib/db';

export async function charge(amount: number) {
  const res = await fetch('https://api.stripe.com/v1/charges', {
    method: 'POST',
    body: String(amount),
  });
  await query('insert into payments values ($1)', [amount]);
  return res.ok;
}
