# Orbit monitoring tools

Tools to help monitor Orbit chains

Available tools:
- Find new rollups
- Find pending retryables

## Find new rollups

Usage

```shell
yarn findRollups
```

Available options:
- showInactive (true/false, default false): Also shows inactive rollups
- fromBlockEth, fromBlockArbOne, fromBlockArbNova (default 0): Specifies from which block to search for new rollups

Example:

```shell
yarn findRollups --showInactive=true --fromBlockEth=18913723
```

## Find pending retryables

Usage

```shell
yarn findPendingRetryables
```

Available options:
- fromBlock, toBlock: Range of blocks in the parent chain to search SubmitRetryable events


```shell
yarn findPendingRetryables --fromBlock=166757506
```
