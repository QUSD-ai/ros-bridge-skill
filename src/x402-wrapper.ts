/**
 * X402 Payment Wrapper for UGV Robot Agentic Calls
 *
 * Adds payment validation to AI/LLM inference calls
 * Basic robot commands (move, turn, sensors) are FREE
 * Agentic calls (LLM decision-making) are PAID
 *
 * Price: 0.05 QUSD per agentic call (AI reasoning)
 */

import { X402Server } from '@qusd/x402';
import { parseEther } from 'viem';
import type { X402HandlerContext } from '@qusd/x402';
import type { WalletClient } from 'viem';
import type { Agent } from '@voltagent/core';

// Agentic call pricing (0.05 QUSD per LLM inference)
const AGENTIC_CALL_PRICE = parseEther('0.05');

interface AgenticRequest {
  prompt: string;
  context?: any;
}

interface AgenticResponse {
  success: boolean;
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  cost: string;
}

/**
 * Create X402 server for paid agentic calls
 */
export function createX402RobotServer(config: {
  port: number;
  escrowAddress: string;
  tokenAddress: string;
  wallet: WalletClient;
  providerUrl?: string;
  agent: Agent;
}): X402Server {

  const server = new X402Server({
    port: config.port,
    escrowAddress: config.escrowAddress,
    tokenAddress: config.tokenAddress,
    wallet: config.wallet,
    providerUrl: config.providerUrl,
    hostname: 'localhost',
    enableWebSocket: true,
  });

  // Register paid agentic call handler
  server.on<AgenticRequest, AgenticResponse>(
    'agentic_call',
    async (params, context: X402HandlerContext) => {
      // Validate payment amount
      const paidAmount = BigInt(context.payment.amount);
      if (paidAmount < AGENTIC_CALL_PRICE) {
        await context.refundPayment('Insufficient payment');
        throw new Error(
          `Insufficient payment. Required: ${AGENTIC_CALL_PRICE.toString()}, Provided: ${paidAmount.toString()}`
        );
      }

      const { prompt, context: userContext } = params;

      try {
        console.log(`🧠 Executing paid agentic call: "${prompt.slice(0, 50)}..."`);

        // Execute agent with LLM reasoning
        const result = await config.agent.run(prompt);

        console.log(`✅ Agentic call completed`);

        // Payment is auto-released by X402Server on success
        return {
          success: true,
          response: result.text || result.content?.[0]?.text || 'No response',
          usage: {
            inputTokens: result.usage?.inputTokens || 0,
            outputTokens: result.usage?.outputTokens || 0,
          },
          cost: AGENTIC_CALL_PRICE.toString(),
        };
      } catch (error) {
        // Refund payment on failure
        await context.refundPayment(`Agentic call failed: ${error}`);

        throw new Error(
          `Agentic call failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Health check endpoint (free)
  server.on('robot_status', async () => {
    return {
      agenticCallsAvailable: true,
      pricing: {
        perAgenticCall: AGENTIC_CALL_PRICE.toString(),
        perAgenticCallFormatted: '0.05 QUSD',
        currency: 'QUSD',
      },
      model: 'claude-sonnet-4-20250514',
      timestamp: Date.now(),
    };
  });

  return server;
}

/**
 * Get pricing info
 */
export function getPricingInfo() {
  return {
    perAgenticCall: AGENTIC_CALL_PRICE.toString(),
    perAgenticCallFormatted: '0.05 QUSD',
    currency: 'QUSD',
    model: 'claude-sonnet-4-20250514',
    note: 'Basic robot commands (movement, sensors, vision) are FREE via A2A protocol',
  };
}
