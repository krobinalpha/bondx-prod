import { contract } from './blockchain';

async function getPrice(tokenAddress: string): Promise<bigint> {
  console.log('teoos------------->', tokenAddress);
  const price = await contract.getTokenPrice(tokenAddress);
  return price;
}

export { getPrice };

