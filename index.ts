import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { connection } from "./connection"
import { JitoTransactionExecutor } from './jeto';
import { logger } from './logger';
import { retrieveEnvVariable } from './env';
import { KeyedAccountInfo, Keypair, ProgramAccountSubscriptionConfig } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot } from './bot';
import { MarketCache } from "./marketcache"
import { PoolCache } from './poolcache';



function getWallet(pk: string): Keypair {
  // assuming  private key to be base58 encoded
  return Keypair.fromSecretKey(bs58.decode(pk));
}
// get env varibles 
const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
const PRIVATE_KEY1 = retrieveEnvVariable('PRIVATE_KEY', logger);
const PRIVATE_KEY2 = retrieveEnvVariable('PRIVATE_KEY', logger);
const CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger);
const MAX_BUY_RETRIES = retrieveEnvVariable('MAX_BUY_RETRIES', logger);
const BUY_SLIPPAGE = retrieveEnvVariable('BUY_SLIPPAGE', logger);
const TOKEN_TO_BUY = retrieveEnvVariable('TOKEN_TO_BUY', logger);


const wallet = getWallet(PRIVATE_KEY.trim());
const wallet1 = getWallet(PRIVATE_KEY1.trim());
const wallet2 = getWallet(PRIVATE_KEY2.trim());

const quoteToken = Token.WSOL //buy using wrapped solana
const wallets = [
  {wallet,amount:new TokenAmount(quoteToken, "0.001", false)},
  {wallet:wallet1,amount:new TokenAmount(quoteToken, "0.002", false)},
  {wallet:wallet2,amount:new TokenAmount(quoteToken, "0.003", false)},
];

const botConfig = {
  quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
  quoteToken,
  maxBuyRetries: Number(MAX_BUY_RETRIES),
  buySlippage: Number(BUY_SLIPPAGE),
  oneTokenAtATime: true,

};
const txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);

const marketCache = new MarketCache(connection);
const poolCache = new PoolCache();

const bot = new Bot(connection, txExecutor, botConfig,marketCache,poolCache);

const subscriptionConfig: ProgramAccountSubscriptionConfig = {
  commitment: connection.commitment,
  filters: [
    { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
        bytes: quoteToken.mint.toBase58(),
      },
    },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
        bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
      },
    },
    {
      memcmp: {
        offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
        bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
      },
    },
  ],
}

async function subscribeToRaydiumPools() {
  return connection.onProgramAccountChange(
    MAINNET_PROGRAM_ID.AmmV4,
    async (updatedAccountInfo: KeyedAccountInfo) => {
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
        if (poolState.baseMint.toString() == TOKEN_TO_BUY){
          console.log({
            "token_address": poolState.baseMint.toString(),
            "pool_address": updatedAccountInfo.accountId.toString()
          })
          // buy
          const len = wallets.length
          for(let i=0; i<len; i++) {
            await bot.buy(updatedAccountInfo.accountId, poolState,wallets[i].wallet,wallets[i].amount);
          }
      }else{
       
        return;
      }
       


    },
    subscriptionConfig
  );
}

async function subscribeToOpenBookMarkets() {
  return connection.onProgramAccountChange(
    MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
    async (updatedAccountInfo: KeyedAccountInfo) => {

      const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
      marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
    },
    {
    commitment:connection.commitment,
    filters:[
      { dataSize: MARKET_STATE_LAYOUT_V3.span },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
    ],
  }
  );
}


async function main() {
  logger.info("bot is running...");
  await subscribeToOpenBookMarkets();
  await subscribeToRaydiumPools();
}

main()