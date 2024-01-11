import { createPublicClient, decodeEventLog, http, keccak256, toHex } from 'viem';
import { SequencerInbox__factory } from '@arbitrum/sdk/dist/lib/abi/factories/SequencerInbox__factory';
import { getBlockToSearchEventsFrom, getChainInfoFromChainId } from '../src/utils';
import { AbiEventItem } from '../src/types';
import yargs from 'yargs/yargs';
import 'dotenv/config';

// Supported networks
const supportedChainIds = [1, 42161, 42170];

type FindRollupOptions = {
  showInactive: boolean;
  fromBlockEth: number;
  fromBlockArbOne: number;
  fromBlockArbNova: number;
};

type RollupInitializedEventArgs = {
  machineHash: `0x${string}`;
  chainId: bigint;
};

type RollupInformation = {
  chainId: bigint;
  transactionHash: `0x${string}`;
  createdAtBlock: bigint;
  rollupAddress?: `0x${string}`;
  sequencerInboxAddress?: `0x${string}`;
  isActive?: boolean;
};

const rollupInitializedEventAbi = {
  inputs: [
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'machineHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'chainId',
      type: 'uint256',
    },
  ],
  name: 'RollupInitialized',
  type: 'event',
};

type SequencerInboxUpdatedEventArgs = {
  newSequencerInbox: `0x${string}`;
};
const SequencerInboxUpdatedEventAbi = {
  inputs: [
    {
      indexed: false,
      internalType: 'address',
      name: 'newSequencerInbox',
      type: 'address',
    },
  ],
  name: 'SequencerInboxUpdated',
  type: 'event',
};
const SequencerInboxUpdatedEventTopic = keccak256(toHex('SequencerInboxUpdated(address)'));

const main = async (options: FindRollupOptions) => {
  for (const chainId of supportedChainIds) {
    const parentChainInformation = getChainInfoFromChainId(chainId);
    const useCustomRPC = (chainId == 1 && process.env.ETH_RPC) as boolean;
    const clientTransport = useCustomRPC ? http(process.env.ETH_RPC) : http();
    const parentChainPublicClient = createPublicClient({
      chain: parentChainInformation,
      transport: clientTransport,
    });

    let fromBlock = 0n;
    switch (chainId) {
      case 1:
        if (options.fromBlockEth > 0) {
          fromBlock = BigInt(options.fromBlockEth);
        }
        break;
      case 42161:
        if (options.fromBlockArbOne > 0) {
          fromBlock = BigInt(options.fromBlockArbOne);
        }
        break;
      case 42170:
        if (options.fromBlockArbNova > 0) {
          fromBlock = BigInt(options.fromBlockArbNova);
        }
        break;
    }

    // eslint-disable-next-line no-await-in-loop
    const currentParentChainBlock = await parentChainPublicClient.getBlockNumber();
    const blockFrom = fromBlock > 0 ? fromBlock : 'earliest';
    const blockTo = currentParentChainBlock;

    // eslint-disable-next-line no-await-in-loop
    const rollupInitializedEvents = await parentChainPublicClient.getLogs({
      event: rollupInitializedEventAbi as AbiEventItem,
      fromBlock: blockFrom,
      toBlock: blockTo,
    });

    // eslint-disable-next-line no-await-in-loop
    const rollupsInformation: RollupInformation[] = await Promise.all(
      rollupInitializedEvents.map(async (rollupInitializedEvent) => {
        const rollupInformation: RollupInformation = {
          chainId: (rollupInitializedEvent.args as RollupInitializedEventArgs).chainId,
          transactionHash: rollupInitializedEvent.transactionHash,
          createdAtBlock: rollupInitializedEvent.blockNumber,
        };

        //
        // Checking if the chain has activity
        //

        // Get the transaction receipt
        const transactionReceipt = await parentChainPublicClient.getTransactionReceipt({
          hash: rollupInformation.transactionHash,
        });

        // Find the SequencerInboxUpdated log
        const sequencerInboxUpdatedEventLog = transactionReceipt.logs.filter(
          (log) => log.topics[0] == SequencerInboxUpdatedEventTopic,
        )[0];
        if (sequencerInboxUpdatedEventLog) {
          // Get the SequencerInbox address
          const decodedLog = decodeEventLog({
            abi: [SequencerInboxUpdatedEventAbi],
            data: sequencerInboxUpdatedEventLog.data,
            topics: sequencerInboxUpdatedEventLog.topics,
          });
          rollupInformation.sequencerInboxAddress = (
            decodedLog.args as SequencerInboxUpdatedEventArgs
          ).newSequencerInbox;

          // Get the rollup address
          rollupInformation.rollupAddress = (await parentChainPublicClient.readContract({
            address: rollupInformation.sequencerInboxAddress,
            abi: SequencerInbox__factory.abi,
            functionName: 'rollup',
          })) as `0x${string}`;

          // Get latest events of the contract
          const currentBlock = await parentChainPublicClient.getBlockNumber();
          const fromBlock = getBlockToSearchEventsFrom(chainId, currentBlock, useCustomRPC);
          const sequencerBatchDeliveredEventLogs = await parentChainPublicClient.getContractEvents({
            address: rollupInformation.sequencerInboxAddress,
            abi: SequencerInbox__factory.abi,
            eventName: 'SequencerBatchDelivered',
            fromBlock,
            toBlock: currentBlock,
          });
          rollupInformation.isActive = sequencerBatchDeliveredEventLogs.length > 0;
        }

        return rollupInformation;
      }),
    );

    // Filter inactives if needed
    const rollupsToShow = options.showInactive
      ? rollupsInformation
      : rollupsInformation.filter((rollupInformation) => rollupInformation.isActive);

    console.log('************************');
    console.log(`* Rollups in chainId = ${chainId}`);
    console.log(`* (Between ${blockFrom} to ${blockTo})`);
    console.log('************************');
    if (rollupsToShow.length > 0) {
      rollupsToShow
        .sort((a, b) => Number(a.createdAtBlock - b.createdAtBlock))
        .forEach((rollupInformation) => {
          console.log('----------------------');
          console.log(rollupInformation);
          console.log('----------------------');
          console.log('');
        });
    }
    console.log(`Found ${rollupsToShow.length} rollups.`);
  }
};

// Getting arguments
const options = yargs(process.argv.slice(2))
  .options({
    showInactive: { type: 'boolean', default: false },
    fromBlockEth: { type: 'number', default: 0 },
    fromBlockArbOne: { type: 'number', default: 0 },
    fromBlockArbNova: { type: 'number', default: 0 },
  })
  .parseSync();

// Calling main
main(options)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
