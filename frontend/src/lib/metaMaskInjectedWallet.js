import { getWalletConnectConnector } from '@rainbow-me/rainbowkit';
import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';

const walletLink = process.env.REACT_APP_METAMASK_WALLET_LINK;
const downloadUrl = process.env.REACT_APP_METAMASK_DOWNLOAD_URL;
if (!walletLink || !downloadUrl) throw new Error('Missing MetaMask connection URLs.');

const hasMetaMask = () => {
  if (typeof window === 'undefined') return false;
  const providers = window.ethereum?.providers || [window.ethereum];
  return providers.some(provider => provider?.isMetaMask &&
    !provider.isCoinbaseWallet && !provider.isRabby && !provider.isRainbow &&
    !provider.isBraveWallet && !provider.isPhantom && !provider.isTrust);
};

// Keep RainbowKit's chooser/WalletConnect metadata without initializing the
// MetaMask SDK, whose analytics module crashes CRA at import time.
export const metaMaskInjectedWallet = ({ projectId, walletConnectParameters }) => {
  const installed = hasMetaMask();
  const getUri = uri => `${walletLink}?uri=${encodeURIComponent(uri)}`;
  return {
    id: 'metaMask',
    name: 'MetaMask',
    rdns: 'io.metamask',
    iconUrl: '/images/metamask.svg',
    iconBackground: '#ffffff',
    installed: installed || undefined,
    downloadUrls: { browserExtension: downloadUrl, mobile: downloadUrl },
    mobile: { getUri },
    qrCode: { getUri },
    createConnector: installed
      ? walletDetails => createConnector(config => ({
          ...injected({ target: 'metaMask', shimDisconnect: true })(config),
          ...walletDetails,
        }))
      : getWalletConnectConnector({ projectId, walletConnectParameters }),
  };
};