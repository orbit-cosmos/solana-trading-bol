import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { GetStructureSchema, MARKET_STATE_LAYOUT_V3, publicKey, struct } from '@raydium-io/raydium-sdk';
import { logger } from './logger';
const MINIMAL_MARKET_STATE_LAYOUT_V3 = struct([publicKey('eventQueue'), publicKey('bids'), publicKey('asks')]);
type MinimalMarketStateLayoutV3 = typeof MINIMAL_MARKET_STATE_LAYOUT_V3;
type MinimalMarketLayoutV3 = GetStructureSchema<MinimalMarketStateLayoutV3>;

async function getMinimalMarketV3(
    connection: Connection,
    marketId: PublicKey,
    commitment?: Commitment,
  ): Promise<MinimalMarketLayoutV3> {
    const marketInfo = await connection.getAccountInfo(marketId, {
      commitment,
      dataSlice: {
        offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
        length: 32 * 3,
      },
    });
  
    return MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo!.data);
  }

export class MarketCache {
  private readonly keys: Map<string, MinimalMarketLayoutV3> = new Map<string, MinimalMarketLayoutV3>();
  constructor(private readonly connection: Connection) {}


  public save(marketId: string, keys: MinimalMarketLayoutV3) {
    if (!this.keys.has(marketId)) {
      logger.trace({}, `Caching new market: ${marketId}`);
      this.keys.set(marketId, keys);
    }
  }



  public async get(marketId: string): Promise<MinimalMarketLayoutV3> {
    if (this.keys.has(marketId)) {
      return this.keys.get(marketId)!;
    }

    logger.trace({}, `Fetching new market keys for ${marketId}`);
    const market = await this.fetch(marketId);
    this.keys.set(marketId, market);
    return market;
  }

  private fetch(marketId: string): Promise<MinimalMarketLayoutV3> {
    return getMinimalMarketV3(this.connection, new PublicKey(marketId), this.connection.commitment);
  }
}
