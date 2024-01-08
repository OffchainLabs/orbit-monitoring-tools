# Orbit monitoring tools

Currently, only a script to find new rollups through RollupInitialized events:

```shell
yarn findRollups
```

## Available options
- showInactive (true/false, default false): Also shows inactive rollups
- fromBlockEth, fromBlockArbOne, fromBlockArbNova (default 0): Specifies from which block to search for new rollups

Example:

```shell
yarn findRollups --showInactive=true --fromBlockEth=18913723
```
