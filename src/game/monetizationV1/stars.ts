/** UI integration contract: open the returned link with Telegram.WebApp.openInvoice.
 * invoiceClosed('paid') is only a hint: poll order status and reload the cloud save.
 * A client callback never credits a wallet. Reuse operationId after uncertain errors. */
export type StarsOrderStatus = 'pending' | 'prechecked' | 'fulfilled';
export type PremiumFund = 'level' | 'arena' | 'blessing' | 'adventure' | 'artifact' | 'dark_energy';
export interface StarsPack { sku: string; title: string; description: string; amount: number; currency: 'XTR'; premiumFund?: PremiumFund | null }
export interface StarsInvoice { operationId: string; invoiceLink: string; orderId: string }
export interface StarsReceipt {
  orderId: string;
  status: StarsOrderStatus;
  fulfilledAt: string | null;
}
export interface StarsTransport { invoke(body: Record<string, unknown>): Promise<unknown> }
export async function createStarsInvoice(transport: StarsTransport, sku: string, operationId: string): Promise<StarsInvoice> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sku) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(operationId)) throw new Error('invalid_stars_request');
  const result = await transport.invoke({ action: 'invoice', sku, operationId }) as Partial<StarsInvoice>;
  if (result.operationId !== operationId || typeof result.orderId !== 'string' ||
      typeof result.invoiceLink !== 'string' || !/^https:\/\/t\.me\/\$[A-Za-z0-9_-]+$/.test(result.invoiceLink)) throw new Error('invalid_stars_invoice');
  return result as StarsInvoice;
}
