import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccessPaymentDialog } from './AccessPaymentDialog';
import { useAuth } from '../lib/authContext';
import { useAccessCheckout } from '../hooks/useAccessCheckout';
import { useAccount } from 'wagmi';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../lib/authContext', () => ({ useAuth: jest.fn() }));
jest.mock('../hooks/useAccessCheckout', () => ({ useAccessCheckout: jest.fn() }));
jest.mock('../lib/walletConfig', () => ({ robinhoodMainnet: { id: 4663 } }));
jest.mock('wagmi', () => ({ useAccount: jest.fn() }));
jest.mock('viem', () => ({ formatEther: () => '0.001' }));
jest.mock('./ui/dialog', () => ({
  Dialog: ({ children, open }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
}));
jest.mock('./ui/button', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));

const quote = {
  quote_id: 'q1',
  chain_id: 4663,
  recipient: '0x45d9AA6ef98407dda4911c6f4a9Af59f3de4E334',
  amount_wei: '1000000000000000',
  calldata: '4c617374',
  expires_at: '2099-01-01T00:00:00+00:00',
};

describe('AccessPaymentDialog regressions', () => {
  let host;
  let root;
  let confirm;

  const render = async ({ checkoutState, wallet = {}, user = {} }) => {
    confirm = jest.fn();
    useAuth.mockReturnValue({
      user: { address: '0xabc', ...user },
      accessDialogOpen: true,
      setAccessDialogOpen: jest.fn(),
    });
    useAccount.mockReturnValue({ address: '0xabc', chainId: 4663, isConnected: true, ...wallet });
    useAccessCheckout.mockReturnValue({
      state: checkoutState,
      busy: '',
      error: '',
      load: jest.fn(),
      confirm,
    });
    await act(async () => {
      root.render(<AccessPaymentDialog />);
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    jest.clearAllMocks();
  });

  it('requires explicit consent before enabling payment button', async () => {
    await render({ checkoutState: { paid: false, order: { order_id: 'o1', quote } } });
    const payBtn = host.querySelector('[data-testid="access-pay-button"]');
    expect(payBtn).toBeTruthy();
    expect(payBtn.disabled).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    const checkbox = host.querySelector('[data-testid="access-consent-checkbox"]');
    await act(async () => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="access-pay-button"]').disabled).toBe(false);
  });

  it('shows verify flow for existing transaction hash and avoids second transfer path', async () => {
    await render({ checkoutState: { paid: false, order: { order_id: 'o1', tx_hash: '0x' + 'a'.repeat(64), quote } } });
    expect(host.querySelector('[data-testid="access-verify-button"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="access-pay-button"]')).toBeFalsy();
  });

  it('renders permanent access success state when already paid', async () => {
    await render({ checkoutState: { paid: true, order: { order_id: 'o1', quote } }, user: { paid_access: true } });
    expect(host.textContent).toContain('PERMANENT ACCESS ACTIVE');
    expect(host.querySelector('[data-testid="access-continue-button"]')).toBeTruthy();
  });
});
