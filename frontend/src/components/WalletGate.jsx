import React, { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { Wallet, LogOut, UserCheck, AlertCircle, KeyRound, LoaderCircle } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { Button } from './ui/button';
import './WalletGate.css';

export const WalletGate = ({ onProfileLoaded }) => {
  const { isConnected, address, chain } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain } = useSwitchChain();
  const { user, status, loginWithWallet, logout, updateProfile } = useAuth();
  const [signing, setSigning] = useState(false);
  const [showNickModal, setShowNickModal] = useState(false);
  const [newNick, setNewNick] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Handle direct connect (e.g. MetaMask extension)
  const handleDirectConnect = () => {
    setErrorMsg('');
    const target =
      connectors.find((c) => c.id === 'metaMask' || c.name.toLowerCase().includes('metamask')) ||
      connectors.find((c) => c.id === 'injected') ||
      connectors[0];

    if (target) {
      connect({ connector: target });
    }
  };

  const handleSignIn = async () => {
    setErrorMsg('');
    setSigning(true);
    try {
      const acct = await loginWithWallet();
      if (acct && (!acct.nickname || acct.nickname.startsWith('Survivor_'))) {
        setNewNick(acct.nickname || '');
        setShowNickModal(true);
      }
      if (onProfileLoaded && acct) onProfileLoaded(acct);
    } catch (err) {
      console.error('Sign-in error:', err);
      setErrorMsg(err.message || 'Signature failed or was rejected');
    } finally {
      setSigning(false);
    }
  };

  const handleSaveNickname = async (e) => {
    e.preventDefault();
    if (!newNick.trim()) return;
    try {
      const updated = await updateProfile(newNick.trim());
      setShowNickModal(false);
      if (onProfileLoaded) onProfileLoaded(updated);
    } catch (err) {
      setErrorMsg(err.message || 'Could not update nickname');
    }
  };

  return (
    <div className="wallet-gate" data-testid="wallet-gate">
      <ConnectButton.Custom>
        {({
          account,
          chain: currentChain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          mounted,
        }) => {
          const ready = mounted;
          const connected = ready && account && currentChain;

          if (!connected) {
            return (
              <div className="wallet-connect-group">
                <button
                  type="button"
                  className="wallet-btn connect-btn"
                  onClick={() => {
                    // Try direct MetaMask connector first to pop extension window immediately; fallback to RainbowKit modal
                    if (window.ethereum) {
                      handleDirectConnect();
                    } else if (openConnectModal) {
                      openConnectModal();
                    }
                  }}
                  disabled={connecting}
                  data-testid="wallet-connect-btn"
                >
                  {connecting ? <LoaderCircle size={15} className="spin" /> : <Wallet size={15} />}
                  <span>{connecting ? 'CONNECTING METAMASK...' : 'CONNECT ROBINHOOD WALLET'}</span>
                </button>
              </div>
            );
          }

          if (currentChain.unsupported) {
            return (
              <button
                type="button"
                className="wallet-btn wrong-net-btn"
                onClick={() => {
                  if (switchChain) {
                    switchChain({ chainId: 4663 });
                  } else if (openChainModal) {
                    openChainModal();
                  }
                }}
                data-testid="wallet-chain-btn"
              >
                <AlertCircle size={15} />
                <span>SWITCH TO ROBINHOOD CHAIN</span>
              </button>
            );
          }

          // Wallet is connected, check SIWE state
          if (status !== 'authenticated' || !user) {
            return (
              <div className="wallet-siwe-wrapper">
                <button
                  type="button"
                  className="wallet-btn siwe-btn"
                  onClick={handleSignIn}
                  disabled={signing}
                  data-testid="wallet-siwe-btn"
                >
                  {signing ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}
                  <span>{signing ? 'REQUESTING SIGNATURE...' : 'SIGN TO PLAY (SIWE)'}</span>
                </button>
                <button
                  type="button"
                  className="wallet-btn-mini"
                  onClick={openAccountModal}
                  title={account.address}
                >
                  {account.displayName}
                </button>
              </div>
            );
          }

          // Fully authenticated
          return (
            <div className="wallet-badge" data-testid="wallet-user-badge">
              <div className="wallet-badge-info" onClick={openAccountModal}>
                <span className="wallet-badge-status"><i className="status-dot" /></span>
                <span className="wallet-badge-nick">{user.nickname || account.displayName}</span>
                <span className="wallet-badge-addr">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>
              </div>
              <button
                type="button"
                className="wallet-logout-btn"
                onClick={logout}
                title="Disconnect & Sign Out"
                data-testid="wallet-logout-btn"
              >
                <LogOut size={13} />
              </button>
            </div>
          );
        }}
      </ConnectButton.Custom>

      {errorMsg && (
        <div className="wallet-error-msg" role="alert">
          <AlertCircle size={12} /> {errorMsg}
        </div>
      )}

      {showNickModal && (
        <div className="wallet-nick-backdrop">
          <div className="wallet-nick-modal">
            <h3><UserCheck size={18} /> REGISTER CALL SIGN</h3>
            <p>Welcome, survivor! Set your permanent call sign for this Robinhood wallet.</p>
            <form onSubmit={handleSaveNickname}>
              <input
                type="text"
                value={newNick}
                onChange={(e) => setNewNick(e.target.value)}
                minLength={2}
                maxLength={18}
                placeholder="Enter call sign"
                autoFocus
                required
              />
              <div className="wallet-modal-actions">
                <Button type="button" variant="outline" onClick={() => setShowNickModal(false)}>
                  Skip for Now
                </Button>
                <Button type="submit" className="save-btn">
                  Confirm Call Sign
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
