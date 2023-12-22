export type AbiEventItem = {
  inputs: { indexed: boolean; internalType: string; name: string; type: string }[];
  name: string;
  type: 'event';
};
