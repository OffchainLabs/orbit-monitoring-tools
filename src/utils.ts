import {
  mainnet,
  sepolia,
  arbitrum,
  arbitrumNova,
  arbitrumGoerli,
  arbitrumSepolia,
} from 'viem/chains';

// Supported Viem chains
const supportedChains = {
  mainnet,
  sepolia,
  arbitrum,
  arbitrumNova,
  arbitrumGoerli,
  arbitrumSepolia,
};

// Block range to search for recent events (24 hours)
const blockCountToSearchRecentEventsOnEth = BigInt((24 * 60 * 60) / 12.5);
const blockCountToSearchRecentEventsOnArb = BigInt((24 * 60 * 60) / 0.25);

// The default RPC for Ethereum on Viem has a restriction of 800 blocks max
// (this can be solved by defining a custom RPC in the .env file)
const defaultBlockCountToSearchRecentEventsOnEth = 800n;

export const getChainInfoFromChainId = (chainId: number) => {
  for (const chain of Object.values(supportedChains)) {
    if ('id' in chain) {
      if (chain.id === chainId) {
        return chain;
      }
    }
  }

  return undefined;
};

export const getBlockToSearchEventsFrom = (
  chainId: number,
  toBlock: bigint,
  useCustomRpc?: boolean,
) => {
  const isArbitrumChain = ![mainnet.id as number, sepolia.id as number].includes(chainId);
  let blockLimit = blockCountToSearchRecentEventsOnArb;

  if (!isArbitrumChain) {
    blockLimit = useCustomRpc
      ? blockCountToSearchRecentEventsOnEth
      : defaultBlockCountToSearchRecentEventsOnEth;
  }

  return toBlock - blockLimit;
};
