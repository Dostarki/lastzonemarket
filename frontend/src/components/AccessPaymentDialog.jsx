import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { CheckCircle2, LoaderCircle, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { useAuth } from '../lib/authContext';
import { useAccessCheckout } from '../hooks/useAccessCheckout';
import { robinhoodMainnet } from '../lib/walletConfig';
import './AccessPaymentDialog.css';

export const AccessPaymentDialog = () => {
  const { user, accessDialogOpen: open, setAccessDialogOpen } = useAuth();
  const { address, chainId, isConnected } = useAccount();
  const { state, busy, error, load, confirm } = useAccessCheckout(open);
  const [approved, setApproved] = useState(false), [now, setNow] = useState(Date.now());
  const order = state?.order, quote = order?.quote;
  const expired = quote && (Date.parse(quote.expires_at) <= now || quote.payment_mode !== 'native_transfer');
  const canPay = isConnected && chainId === robinhoodMainnet.id && address?.toLowerCase() === user?.address?.toLowerCase();
  useEffect(() => { setApproved(false); }, [open, quote?.quote_id]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);
  useEffect(() => { if (open && (!isConnected || !user)) setAccessDialogOpen(false); }, [open, isConnected, user, setAccessDialogOpen]);
  return <Dialog open={open} onOpenChange={setAccessDialogOpen}>
    <DialogContent className="access-payment-dialog" data-testid="access-payment-dialog">
      <DialogTitle data-testid="access-payment-title">{state?.paid ? 'PERMANENT ACCESS ACTIVE' : 'UNLOCK WESTFALL'}</DialogTitle>
      <DialogDescription data-testid="access-payment-description">{state?.paid ? 'Your payment is saved. Future game entries are free for this wallet.' : 'One-time $1.00 payment in ETH. Network fees are additional. No recurring charge.'}</DialogDescription>
      {state?.paid ? <div className="access-success" data-testid="access-payment-success"><CheckCircle2 size={28} /><span>Payment verified</span><Button data-testid="access-continue-button" onClick={() => setAccessDialogOpen(false)}>CONTINUE</Button></div> : <>
        {quote && <dl className="access-quote" data-testid="access-quote-details">
          <dt>Access fee</dt><dd data-testid="access-usd-amount">$1.00 USD</dd>
          <dt>ETH amount</dt><dd data-testid="access-eth-amount">{formatEther(BigInt(quote.amount_wei))} ETH</dd>
          <dt>Network</dt><dd data-testid="access-network">Robinhood Mainnet · {quote.chain_id}</dd>
          <dt>Recipient</dt><dd className="access-address" data-testid="access-recipient">{quote.recipient}</dd>
          <dt>Wallet</dt><dd className="access-address" data-testid="access-payer">{address}</dd>
          <dt>Quote</dt><dd data-testid="access-quote-expiry">{expired ? 'Expired' : `${Math.max(0, Math.ceil((Date.parse(quote.expires_at) - now) / 1000))}s remaining`}</dd>
        </dl>}
        {order?.tx_hash && <p className="access-address" data-testid="access-transaction-hash">Transaction: {order.tx_hash}</p>}
        {error && <p role="alert" className="access-error" data-testid="access-payment-error">{error}</p>}
        {!busy && !state && <Button onClick={() => load()} data-testid="access-retry-button">RETRY</Button>}
        {quote && !order.tx_hash && !expired && <label className="access-consent" data-testid="access-consent-label"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} data-testid="access-consent-checkbox" />I approve this one-time ETH transfer to the recipient above.</label>}
        {busy ? <p className="access-busy" role="status" data-testid="access-payment-busy"><LoaderCircle className="spin" size={18} />{busy === 'approving' ? 'Approve the transfer in your wallet…' : busy === 'confirming' ? 'Waiting for 2 confirmations…' : 'Loading payment details…'}</p> : quote && (
          order.tx_hash ? <Button data-testid="access-verify-button" onClick={() => confirm(order.tx_hash)}>VERIFY EXISTING PAYMENT</Button> : expired ? <Button data-testid="access-refresh-quote-button" onClick={() => load(true)}>REFRESH QUOTE</Button> : <Button data-testid="access-pay-button" disabled={!approved || !canPay} onClick={() => confirm()}><Wallet size={16} /> PAY $1.00 IN ETH</Button>
        )}
      </>}
    </DialogContent>
  </Dialog>;
};