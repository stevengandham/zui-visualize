import { registerOrders } from './routes/orders';

export function createServer() {
  const app: any = { get() {}, post() {} };
  registerOrders(app);
  return app;
}
