import { Connection } from '@solana/web3.js';
import dotenv from "dotenv"
dotenv.config()
import { retrieveEnvVariable } from './env';
import { logger } from './logger';

const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);


const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);


export const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: "confirmed",
});