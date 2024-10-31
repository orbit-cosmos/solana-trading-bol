import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, Token,TokenAmount } from '@raydium-io/raydium-sdk';
import {  Keypair } from '@solana/web3.js';
import {  getAssociatedTokenAddressSync } from '@solana/spl-token';

import bs58 from 'bs58';

import {logger} from "./logger"
import {connection} from "./connection"
import {Bot} from "./bot"
import { JitoTransactionExecutor } from './jeto';
import {retrieveEnvVariable} from "./env"
import { MarketCache } from './marketcache';

const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
const PRIVATE_KEY1 = retrieveEnvVariable('PRIVATE_KEY', logger);
const PRIVATE_KEY2 = retrieveEnvVariable('PRIVATE_KEY', logger);
const CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger);
const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
const MAX_BUY_RETRIES = retrieveEnvVariable('MAX_BUY_RETRIES', logger);
const BUY_SLIPPAGE = retrieveEnvVariable('BUY_SLIPPAGE', logger);
const TOKEN_TO_BUY = retrieveEnvVariable('TOKEN_TO_BUY', logger);

function getWallet(pk: string): Keypair {
  // assuming  private key to be base58 encoded
  return Keypair.fromSecretKey(bs58.decode(pk));
}


const quoteToken = Token.WSOL //buy using wrapped solana

const wallet = getWallet(PRIVATE_KEY.trim());
const wallet1 = getWallet(PRIVATE_KEY1.trim());
const wallet2 = getWallet(PRIVATE_KEY2.trim());

const wallets = [wallet,wallet1,wallet2];

const botConfig = {
  quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
  quoteToken,
  quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
  maxBuyRetries: Number(MAX_BUY_RETRIES),
  buySlippage: Number(BUY_SLIPPAGE),
  oneTokenAtATime: true,
  
};
const txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);

const marketCache = new MarketCache(connection);
const bot = new Bot(connection,txExecutor, botConfig,marketCache);


async function  subscribeToRaydiumPools(config: { quoteToken: Token }) {
  return connection.onProgramAccountChange(
    MAINNET_PROGRAM_ID.AmmV4,
    async (updatedAccountInfo) => {
        const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
        if (poolState.baseMint.toString() == TOKEN_TO_BUY){
            // buy
            const len = wallets.length
            for(let i=0; i<len; ++i) {
              await bot.buy(updatedAccountInfo.accountId, poolState,wallets[i]);
            }
        }else{
          logger.info({tokenAddress:poolState.baseMint.toString(),poolId:updatedAccountInfo.accountId.toString()});
          return;
        }
    },
    connection.commitment,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: config.quoteToken.mint.toBase58(),
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
  );
}

async function main(){

  await subscribeToRaydiumPools({
    quoteToken,
  });
}

main()