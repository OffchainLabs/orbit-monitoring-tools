import {
  concat,
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  pad,
  toHex,
  toRlp,
  trim,
} from 'viem';
import { defineChainInformation, getChainInfoFromChainId } from '../src/utils';
import { AbiEventItem } from '../src/types';
import yargs from 'yargs/yargs';
import 'dotenv/config';

type FindPendingRetryablesOptions = {
  fromBlock: number;
  toBlock: number;
};

type PendingRetryableInformation = {
  parentChainTransactionHash: `0x${string}`;
  submittedAtBlock: bigint;
  orbitChainCreateTransactionHash: `0x${string}`;
  orbitChainExecuteTransactionHash?: `0x${string}`;
  status:
    | 'NOT_CREATED'
    | 'CREATE_FAILED'
    | 'NOT_AUTOREDEEMED'
    | 'AUTOREDEEM_CREATE_FAILED'
    | 'AUTOREDEEM_FAILED';
};

type RedeemedRetryableInformation = {
  parentChainTransactionHash: `0x${string}`;
  submittedAtBlock: bigint;
  orbitChainCreateTransactionHash: `0x${string}`;
  orbitChainExecuteTransactionHash?: `0x${string}`;
};

type InboxMessageDeliveredEventArgs = {
  messageNum: bigint;
  data: `0x${string}`;
};

type BridgeMessageDeliveredEventArgs = {
  messageIndex: bigint;
  beforeInboxAcc: `0x${string}`;
  inbox: `0x${string}`;
  kind: number;
  sender: `0x${string}`;
  messageDataHash: `0x${string}`;
  baseFeeL1: bigint;
  timestamp: bigint;
};

type RedeemScheduledEventArgs = {
  ticketId: `0x${string}`;
  retryTxHash: `0x${string}`;
  sequenceNum: bigint;
  donatedGas: bigint;
  gasDonor: `0x${string}`;
  maxRefund: bigint;
  submissionFeeRefund: bigint;
};

const inboxMessageDeliveredEventAbi = {
  inputs: [
    {
      indexed: true,
      internalType: 'uint256',
      name: 'messageNum',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'bytes',
      name: 'data',
      type: 'bytes',
    },
  ],
  name: 'InboxMessageDelivered',
  type: 'event',
};

const bridgeMessageDeliveredEventAbi = {
  inputs: [
    {
      indexed: true,
      internalType: 'uint256',
      name: 'messageIndex',
      type: 'uint256',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'beforeInboxAcc',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'inbox',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint8',
      name: 'kind',
      type: 'uint8',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'sender',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'bytes32',
      name: 'messageDataHash',
      type: 'bytes32',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'baseFeeL1',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'uint64',
      name: 'timestamp',
      type: 'uint64',
    },
  ],
  name: 'MessageDelivered',
  type: 'event',
};

const redeemScheduledEventAbi = {
  inputs: [
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'ticketId',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'bytes32',
      name: 'retryTxHash',
      type: 'bytes32',
    },
    {
      indexed: true,
      internalType: 'uint64',
      name: 'sequenceNum',
      type: 'uint64',
    },
    {
      indexed: false,
      internalType: 'uint64',
      name: 'donatedGas',
      type: 'uint64',
    },
    {
      indexed: false,
      internalType: 'address',
      name: 'gasDonor',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'maxRefund',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'submissionFeeRefund',
      type: 'uint256',
    },
  ],
  name: 'RedeemScheduled',
  type: 'event',
};
const RedeemScheduledEventTopic = keccak256(
  toHex('RedeemScheduled(bytes32,bytes32,uint64,uint64,address,uint256,uint256)'),
);

// Helpers
const parseMessageData = (rawMessageData: `0x${string}`) => {
  const messageDataParsed = decodeAbiParameters(
    [
      { name: 'destAddress', type: 'uint256' },
      { name: 'orbitChainCallValue', type: 'uint256' },
      { name: 'callValue', type: 'uint256' },
      { name: 'maxSubmissionFee', type: 'uint256' },
      { name: 'excessFeeRefundAddress', type: 'uint256' },
      { name: 'callValueRefundAddress', type: 'uint256' },
      { name: 'gasLimit', type: 'uint256' },
      { name: 'maxFeePerGas', type: 'uint256' },
      { name: 'callDataLength', type: 'uint256' },
    ],
    rawMessageData,
  );

  const messageData = {
    destAddress: getAddress(pad(toHex(messageDataParsed[0]), { size: 20 })),
    orbitChainCallValue: messageDataParsed[1],
    callValue: messageDataParsed[2],
    maxSubmissionFee: messageDataParsed[3],
    excessFeeRefundAddress: getAddress(pad(toHex(messageDataParsed[4]), { size: 20 })),
    callValueRefundAddress: getAddress(pad(toHex(messageDataParsed[5]), { size: 20 })),
    gasLimit: messageDataParsed[6],
    maxFeePerGas: messageDataParsed[7],
    callDataLength: messageDataParsed[8],
    data: ('0x' +
      rawMessageData.substring(
        rawMessageData.length - Number(messageDataParsed[8] * 2n),
      )) as `0x${string}`,
  };

  return messageData;
};

const calculateCreateRetryableTransactionHash = (retryableInformation: {
  orbitChainId: number;
  fromAddress: `0x${string}`;
  messageNumber: bigint;
  baseFee: bigint;
  destAddress: `0x${string}`;
  orbitChainCallValue: bigint;
  callValue: bigint;
  maxSubmissionFee: bigint;
  excessFeeRefundAddress: `0x${string}`;
  callValueRefundAddress: `0x${string}`;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  data: `0x${string}`;
}) => {
  const formatNumber = (value: bigint) => {
    return trim(toHex(value));
  };
  const fields = [
    formatNumber(BigInt(retryableInformation.orbitChainId)),
    pad(formatNumber(retryableInformation.messageNumber), { size: 32 }),
    retryableInformation.fromAddress,
    formatNumber(retryableInformation.baseFee),
    formatNumber(retryableInformation.callValue),
    formatNumber(retryableInformation.maxFeePerGas),
    formatNumber(retryableInformation.gasLimit),
    retryableInformation.destAddress,
    formatNumber(retryableInformation.orbitChainCallValue),
    retryableInformation.callValueRefundAddress,
    formatNumber(retryableInformation.maxSubmissionFee),
    retryableInformation.excessFeeRefundAddress,
    retryableInformation.data,
  ];

  // All fields need to be transformed into byte arrays
  const byteArrayFields = fields.map((field) =>
    Number(field) == 0 ? new Uint8Array() : new Uint8Array(Buffer.from(field.substring(2), 'hex')),
  );

  // Arbitrum submit retry transactions have type 0x69
  const rlpEnc = concat(['0x69', toRlp(byteArrayFields)]);
  return keccak256(rlpEnc);
};

const main = async (options: FindPendingRetryablesOptions) => {
  if (
    !process.env.PARENT_CHAIN_ID ||
    !process.env.ORBIT_CHAIN_ID ||
    !process.env.ORBIT_CHAIN_RPC ||
    !process.env.ORBIT_CHAIN_NAME ||
    !process.env.ORBIT_CHAIN_CURRENCY_NAME ||
    !process.env.ORBIT_CHAIN_CURRENCY_SYMBOL ||
    !process.env.ORBIT_CHAIN_CURRENCY_DECIMALS ||
    !process.env.PARENT_CHAIN_INBOX_ADDRESS ||
    !process.env.PARENT_CHAIN_BRIDGE_ADDRESS
  ) {
    console.log(
      'Some variables are missing in the .env file. Check .env.example to find the required variables.',
    );
    return;
  }

  // Parent chain
  const parentChainInformation = getChainInfoFromChainId(Number(process.env.PARENT_CHAIN_ID));
  const parentChainPublicClient = createPublicClient({
    chain: parentChainInformation,
    transport: http(),
  });

  // Orbit chain
  const orbitChainId = Number(process.env.ORBIT_CHAIN_ID);
  const orbitChainInformation = defineChainInformation({
    id: orbitChainId,
    rpc: process.env.ORBIT_CHAIN_RPC,
    name: process.env.ORBIT_CHAIN_NAME,
    nativeCurrency: {
      name: process.env.ORBIT_CHAIN_CURRENCY_NAME,
      symbol: process.env.ORBIT_CHAIN_CURRENCY_SYMBOL,
      decimals: Number(process.env.ORBIT_CHAIN_CURRENCY_DECIMALS),
    },
  });
  const orbitPublicClient = createPublicClient({
    chain: orbitChainInformation,
    transport: http(),
  });

  // Get latest block to filter events
  const currentParentChainBlock = await parentChainPublicClient.getBlockNumber();
  const blockTo = options.toBlock > 0 ? BigInt(options.toBlock) : currentParentChainBlock;
  const blockFrom = options.fromBlock > 0 ? BigInt(options.fromBlock) : 'earliest';

  // Initial banner
  console.log('************************');
  console.log(`* Pending retryables in chain ${process.env.ORBIT_CHAIN_NAME}`);
  console.log(`* (Between ${blockFrom} to ${blockTo})`);
  console.log('************************');

  // Get logs
  const inboxMessageDeliveredEvents = await parentChainPublicClient.getLogs({
    address: process.env.PARENT_CHAIN_INBOX_ADDRESS as `0x${string}`,
    event: inboxMessageDeliveredEventAbi as AbiEventItem,
    fromBlock: blockFrom,
    toBlock: blockTo,
  });
  const bridgeMessageDeliveredLogs = (
    await parentChainPublicClient.getLogs({
      address: process.env.PARENT_CHAIN_BRIDGE_ADDRESS as `0x${string}`,
      event: bridgeMessageDeliveredEventAbi as AbiEventItem,
      fromBlock: blockFrom,
      toBlock: blockTo,
    })
  ).map((event) =>
    decodeEventLog({
      abi: [bridgeMessageDeliveredEventAbi],
      data: event.data,
      topics: event.topics,
    }),
  );

  const pendingRetryables: PendingRetryableInformation[] = [];
  const redeemedRetryables: RedeemedRetryableInformation[] = [];
  await Promise.all(
    inboxMessageDeliveredEvents.map(async (inboxMessageDeliveredEvent) => {
      // Decoding the log
      const inboxMessageDeliveredEventArgs = decodeEventLog({
        abi: [inboxMessageDeliveredEventAbi],
        data: inboxMessageDeliveredEvent.data,
        topics: inboxMessageDeliveredEvent.topics,
      }).args as InboxMessageDeliveredEventArgs;

      // Find the corresponding MessageDelivered event
      const bridgeMessageDeliveredEventArgs = bridgeMessageDeliveredLogs.filter(
        (event) =>
          (event.args as BridgeMessageDeliveredEventArgs).messageIndex ==
          inboxMessageDeliveredEventArgs.messageNum,
      )[0].args as BridgeMessageDeliveredEventArgs;

      if (bridgeMessageDeliveredEventArgs.kind != 9) {
        // Message kind is not SubmitRetryableTx
        return;
      }

      // Parse the message data
      const messageData = parseMessageData(inboxMessageDeliveredEventArgs.data);

      // Calculate the transaction hash that creates the retryable in the Orbit chain
      const createRetryableTransactionHash = calculateCreateRetryableTransactionHash({
        orbitChainId: orbitChainId,
        fromAddress: bridgeMessageDeliveredEventArgs.sender,
        messageNumber: bridgeMessageDeliveredEventArgs.messageIndex,
        baseFee: bridgeMessageDeliveredEventArgs.baseFeeL1,
        destAddress: messageData.destAddress,
        orbitChainCallValue: messageData.orbitChainCallValue,
        callValue: messageData.callValue,
        maxSubmissionFee: messageData.maxSubmissionFee,
        excessFeeRefundAddress: messageData.excessFeeRefundAddress,
        callValueRefundAddress: messageData.callValueRefundAddress,
        gasLimit: messageData.gasLimit,
        maxFeePerGas: messageData.maxFeePerGas,
        data: messageData.data,
      });

      // Get the receipt of that hash
      const createRetryableTransactionReceipt = await orbitPublicClient.getTransactionReceipt({
        hash: createRetryableTransactionHash,
      });
      if (!createRetryableTransactionReceipt) {
        pendingRetryables.push({
          parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
          submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
          orbitChainCreateTransactionHash: createRetryableTransactionHash,
          status: 'NOT_CREATED',
        });
        return;
      }

      // Transaction reverted
      if (createRetryableTransactionReceipt.status != 'success') {
        pendingRetryables.push({
          parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
          submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
          orbitChainCreateTransactionHash: createRetryableTransactionHash,
          status: 'CREATE_FAILED',
        });
        return;
      }

      // Find RedeemScheduled events in that receipt
      const redeemScheduledEventLog = createRetryableTransactionReceipt.logs.filter(
        (log) => log.topics[0] == RedeemScheduledEventTopic,
      )[0];

      if (!redeemScheduledEventLog) {
        pendingRetryables.push({
          parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
          submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
          orbitChainCreateTransactionHash: createRetryableTransactionHash,
          status: 'NOT_AUTOREDEEMED',
        });
        return;
      }

      // Find Retryable execution transaction
      const decodedLog = decodeEventLog({
        abi: [redeemScheduledEventAbi],
        data: redeemScheduledEventLog.data,
        topics: redeemScheduledEventLog.topics,
      });
      const executeRetryableTransactionHash = (decodedLog.args as RedeemScheduledEventArgs)
        .retryTxHash;
      const executeRetryableTransactionReceipt = await orbitPublicClient.getTransactionReceipt({
        hash: executeRetryableTransactionHash,
      });
      if (!executeRetryableTransactionReceipt) {
        pendingRetryables.push({
          parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
          submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
          orbitChainCreateTransactionHash: createRetryableTransactionHash,
          orbitChainExecuteTransactionHash: executeRetryableTransactionHash,
          status: 'AUTOREDEEM_CREATE_FAILED',
        });
        return;
      }

      // Transaction reverted
      if (executeRetryableTransactionReceipt.status != 'success') {
        pendingRetryables.push({
          parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
          submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
          orbitChainCreateTransactionHash: createRetryableTransactionHash,
          orbitChainExecuteTransactionHash: executeRetryableTransactionHash,
          status: 'AUTOREDEEM_FAILED',
        });
        return;
      }

      // Retryable was auto-redeemed
      redeemedRetryables.push({
        parentChainTransactionHash: inboxMessageDeliveredEvent.transactionHash,
        submittedAtBlock: inboxMessageDeliveredEvent.blockNumber,
        orbitChainCreateTransactionHash: createRetryableTransactionHash,
        orbitChainExecuteTransactionHash: executeRetryableTransactionHash,
      });
    }),
  );

  // Show all pending retryables found
  if (pendingRetryables.length > 0) {
    pendingRetryables
      .sort((a, b) => Number(a.submittedAtBlock - b.submittedAtBlock))
      .forEach((pendingRetryable) => {
        console.log('----------------------');
        console.log(pendingRetryable);
        console.log('----------------------');
        console.log('');
      });
  } else {
    console.log('No pending retryables found');
  }
  console.log('');
  console.log(`Retryables successfully redeemed (${redeemedRetryables.length})`);
  if (redeemedRetryables.length > 0) {
    console.log('Parent chain submission transaction hash - Orbit chain creation transaction hash');
    console.log('--------------------------------------------------------------------------------');
    redeemedRetryables
      .sort((a, b) => Number(a.submittedAtBlock - b.submittedAtBlock))
      .forEach((redeemedRetryable) => {
        console.log(
          `${redeemedRetryable.parentChainTransactionHash} -- ${redeemedRetryable.orbitChainCreateTransactionHash}`,
        );
      });
  }
};

// Getting arguments
const options = yargs(process.argv.slice(2))
  .options({
    fromBlock: { type: 'number', default: Number(process.env.ORBIT_CHAIN_DEPLOYMENT_BLOCK) || 0 },
    toBlock: { type: 'number', default: 0 },
  })
  .parseSync();

// Calling main
main(options)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
