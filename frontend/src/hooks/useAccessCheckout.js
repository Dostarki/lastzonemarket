import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useNativePayment } from './useNativePayment';
import { useAuth } from '../lib/authContext';
import { robinhoodMainnet } from '../lib/walletConfig';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/access`;
const errorText = error => ({
  PAYMENT_QUOTE_UNAVAILABLE: 'The ETH price is unavailable. Try again shortly.',
  PAYMENT_VERIFICATION_UNAVAILABLE: 'Verification is temporarily unavailable. Retry the existing transaction; do not pay again.',
  quote_expired: 'This quote expired before payment. Keep the transaction hash for review; do not send another payment.',
  payment_failed: 'The transaction reverted. No access payment was transferred. Request a new quote to retry.',
}[error.message] || error.shortMessage || error.message || 'Could not complete payment. Please retry.');

async function accessRequest(path = '', body) {
  const token = localStorage.getItem('dz_auth_token');
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Payment request failed.');
  return data;
}

export const useAccessCheckout = open => {
  const { user, checkAuth } = useAuth();
  const { address, chainId } = useAccount();
  const { sendNativePayment } = useNativePayment();
  const [state, setState] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const generation = useRef(0), sending = useRef(false);
  const key = `lastzhood-access:${user?.address?.toLowerCase()}`;

  const load = useCallback(async (refresh = false) => {
    const run = ++generation.current;
    setBusy('loading'); setError('');
    try {
      let data = await accessRequest();
      let pending;
      try { pending = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { /* Invalid local cache is not a paid entitlement. */ }
      if (!data.paid && pending && data.order?.order_id === pending.order_id) {
        data = await accessRequest('/submit', pending);
      } else if (!data.paid && !data.order?.tx_hash && (refresh || !data.order?.quote || data.order.quote.payment_mode !== 'native_transfer')) {
        data = await accessRequest('/quote', {});
      }
      if (run !== generation.current) return;
      setState(data);
      if (data.paid) { localStorage.removeItem(key); await checkAuth(); }
    } catch (e) { if (run === generation.current) setError(errorText(e)); }
    finally { if (run === generation.current) setBusy(''); }
  }, [key, checkAuth]);

  useEffect(() => {
    if (open && user?.address) { setState(null); load(); }
    return () => { generation.current += 1; };
  }, [open, user?.address, load]);

  const confirm = async (existingHash) => {
    if (sending.current || !state?.order) return;
    const order = state.order, quote = order.quote, run = generation.current;
    const owner = user?.address?.toLowerCase();
    if (chainId !== robinhoodMainnet.id || quote?.chain_id !== robinhoodMainnet.id || address?.toLowerCase() !== owner) {
      setError('Connect the signed-in wallet on Robinhood Chain Mainnet (4663).'); return;
    }
    sending.current = true; setError('');
    try {
      let hash = existingHash || order.tx_hash;
      if (!hash) {
        if (Date.parse(quote.expires_at) <= Date.now()) throw new Error('Quote expired. Refresh the quote before paying.');
        const latest = await accessRequest();
        if (latest.paid) { setState(latest); await checkAuth(); return; }
        if (latest.order?.tx_hash) hash = latest.order.tx_hash;
        else {
          if (latest.order?.quote?.quote_id !== quote.quote_id) throw new Error('The quote changed. Reload and review the new amount.');
          setBusy('approving');
          hash = await sendNativePayment(quote, address);
        }
        localStorage.setItem(key, JSON.stringify({ order_id: order.order_id, tx_hash: hash }));
      }
      if (run === generation.current) { setState(s => ({ ...s, order: { ...order, tx_hash: hash } })); setBusy('confirming'); }
      // Request-scoped confirmation wait; the durable order survives reloads.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const result = await accessRequest('/submit', { order_id: order.order_id, tx_hash: hash });
        if (run !== generation.current) return;
        setState(result);
        if (result.paid) { localStorage.removeItem(key); await checkAuth(); return; }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setError('Payment is still confirming. Retry verification with the same transaction; no additional payment is needed.');
    } catch (e) { if (run === generation.current) setError(errorText(e)); }
    finally { sending.current = false; if (run === generation.current) setBusy(''); }
  };
  return { state, busy, error, load, confirm };
};