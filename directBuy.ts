import { LIQUIDITY_STATE_LAYOUT_V4, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { connection } from "./connection"
import { JitoTransactionExecutor } from './jeto';
import { logger } from './logger';
import { retrieveEnvVariable } from './env';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot } from './bot';
import { MarketCache } from "./marketcache"



function getWallet(pk: string): Keypair {
  // assuming  private key to be base58 encoded
  return Keypair.fromSecretKey(bs58.decode(pk));
}
// get env varibles 
const PRIVATE_KEY1 = retrieveEnvVariable('PRIVATE_KEY1', logger);
const PRIVATE_KEY2 = retrieveEnvVariable('PRIVATE_KEY2', logger);
const PRIVATE_KEY3 = retrieveEnvVariable('PRIVATE_KEY3', logger);
const PRIVATE_KEY4 = retrieveEnvVariable('PRIVATE_KEY4', logger);
const PRIVATE_KEY5 = retrieveEnvVariable('PRIVATE_KEY5', logger);
const PRIVATE_KEY6 = retrieveEnvVariable('PRIVATE_KEY6', logger);
const PRIVATE_KEY7 = retrieveEnvVariable('PRIVATE_KEY7', logger);

const CUSTOM_FEE = retrieveEnvVariable('CUSTOM_FEE', logger);
const BUY_SLIPPAGE = retrieveEnvVariable('BUY_SLIPPAGE', logger);
const POOL_ID = retrieveEnvVariable('POOL_ID', logger);


const wallet1 = getWallet(PRIVATE_KEY1.trim());
const wallet2 = getWallet(PRIVATE_KEY2.trim());
const wallet3 = getWallet(PRIVATE_KEY3.trim());
const wallet4 = getWallet(PRIVATE_KEY4.trim());
const wallet5 = getWallet(PRIVATE_KEY5.trim());
const wallet6 = getWallet(PRIVATE_KEY6.trim());
const wallet7 = getWallet(PRIVATE_KEY7.trim());

const quoteToken = Token.WSOL //buy using wrapped solana
const wallets = [

    {wallet:wallet1,amount:new TokenAmount(quoteToken, "10.23", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet1.publicKey)},
    // {wallet:wallet2,amount:new TokenAmount(quoteToken, "69", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet2.publicKey)},
    // {wallet:wallet3,amount:new TokenAmount(quoteToken, "33.3", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet3.publicKey)},
    // {wallet:wallet4,amount:new TokenAmount(quoteToken, "56.9", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet4.publicKey)},
    // {wallet:wallet5,amount:new TokenAmount(quoteToken, "47.4", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet5.publicKey)},
    // {wallet:wallet6,amount:new TokenAmount(quoteToken, "42.6", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet6.publicKey)},
    // {wallet:wallet7,amount:new TokenAmount(quoteToken, "62", false),quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet7.publicKey)},
];

const botConfig = {
  quoteToken,
  buySlippage: Number(BUY_SLIPPAGE),
  oneTokenAtATime: true,
};

const txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);

const marketCache = new MarketCache(connection);

const bot = new Bot(connection, txExecutor, botConfig,marketCache);

async function buyFromPool(poolId: PublicKey) {
    try {
      // Fetch the pool account information
      const poolAccountInfo = await connection.getAccountInfo(poolId);
      if (!poolAccountInfo) {
        throw new Error(`Pool with ID ${poolId} not found`);
      }
  
      // Decode the pool state using Raydium's LIQUIDITY_STATE_LAYOUT_V4
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);
  
        console.log({
          token_address: poolState.baseMint.toString(),
          pool_address: poolId,
        });
        const len  = wallets.length
        for (let i = 0; i < len; i++) {

        // Perform the buy transaction for each wallet
            // console.log("wallet"+(i+1),(wallets[i].wallet.publicKey).toString(),(await connection.getTokenAccountBalance(wallets[i].quoteAta)).value.amount);
            bot.buy(poolId, poolState, wallets[i].wallet, wallets[i].amount,wallets[i].quoteAta);
        }
     
    } catch (error) {
      logger.error(`Failed to buy from pool: ${error}`);
    }
  }


buyFromPool(new PublicKey(POOL_ID))