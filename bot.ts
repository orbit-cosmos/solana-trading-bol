import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { GetStructureSchema,
  publicKey, struct, Liquidity,
  LiquidityPoolKeys, LiquidityPoolKeysV4,
  LiquidityStateV4, MAINNET_PROGRAM_ID,
  Market, Percent, Token, TokenAmount 
} from '@raydium-io/raydium-sdk';
import { Mutex } from 'async-mutex';
import { JitoTransactionExecutor } from './jeto';
import { logger } from './logger';
import { retrieveEnvVariable } from './env';
import { MarketCache } from './marketcache';
import { PoolCache } from './poolcache';


const NETWORK = retrieveEnvVariable('NETWORK', logger);
const MINIMAL_MARKET_STATE_LAYOUT_V3 = struct([publicKey('eventQueue'), publicKey('bids'), publicKey('asks')]);
type MinimalMarketStateLayoutV3 = typeof MINIMAL_MARKET_STATE_LAYOUT_V3;
type MinimalMarketLayoutV3 = GetStructureSchema<MinimalMarketStateLayoutV3>;




function createPoolKeys(
  id: PublicKey,
  accountData: LiquidityStateV4,
  minimalMarketLayoutV3: MinimalMarketLayoutV3,
): LiquidityPoolKeys {
  return {
    id,
    baseMint: accountData.baseMint,
    quoteMint: accountData.quoteMint,
    lpMint: accountData.lpMint,
    baseDecimals: accountData.baseDecimal.toNumber(),
    quoteDecimals: accountData.quoteDecimal.toNumber(),
    lpDecimals: 5,
    version: 4,
    programId: MAINNET_PROGRAM_ID.AmmV4,
    authority: Liquidity.getAssociatedAuthority({
      programId: MAINNET_PROGRAM_ID.AmmV4,
    }).publicKey,
    openOrders: accountData.openOrders,
    targetOrders: accountData.targetOrders,
    baseVault: accountData.baseVault,
    quoteVault: accountData.quoteVault,
    marketVersion: 3,
    marketProgramId: accountData.marketProgramId,
    marketId: accountData.marketId,
    marketAuthority: Market.getAssociatedAuthority({
      programId: accountData.marketProgramId,
      marketId: accountData.marketId,
    }).publicKey,
    marketBaseVault: accountData.baseVault,
    marketQuoteVault: accountData.quoteVault,
    marketBids: minimalMarketLayoutV3.bids,
    marketAsks: minimalMarketLayoutV3.asks,
    marketEventQueue: minimalMarketLayoutV3.eventQueue,
    withdrawQueue: accountData.withdrawQueue,
    lpVault: accountData.lpVault,
    lookupTableAccount: PublicKey.default,
  };
}

interface BotConfig {
  quoteAta: PublicKey;
  quoteToken: Token;
  maxBuyRetries: number;
  buySlippage: number;
  oneTokenAtATime: boolean;
}


export class Bot {

  // one token at the time
  private readonly mutex: Mutex;

  constructor(
    private readonly connection: Connection,
    
    private readonly txExecutor: JitoTransactionExecutor,
    readonly config: BotConfig,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,

  ) {
    this.mutex = new Mutex();
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4,wallet:Keypair,quoteAmount: TokenAmount) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);
    if (this.config.oneTokenAtATime) {
      if (this.mutex.isLocked()) {
        logger.debug(
          { mint: poolState.baseMint.toString() },
          `Skipping buy because one token at a time is turned on and token is already being processed`,
        );
        return;
      }

      await this.mutex.acquire();
    }

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);



      for (let i = 0; i < this.config.maxBuyRetries; ++i) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );
          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);

          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            quoteAmount,
            this.config.buySlippage,
            wallet,
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
              },
              `Confirmed buy tx`,
            );

            break;
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      if (this.config.oneTokenAtATime) {
        this.mutex.release();
      }
    }
  }
  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...([
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            ataOut,
            wallet.publicKey,
            tokenOut.mint,
          ),
        ]),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }
}
