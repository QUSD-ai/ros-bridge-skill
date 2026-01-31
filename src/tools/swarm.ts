/**
 * Swarm Coordination Tools for Multi-Robot UGV System
 *
 * Enable robots to discover, communicate, and coordinate with each other
 */

import { tool } from '@voltagent/core';
import { z } from 'zod';

const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://localhost:5001';
const REGISTRY_RPC = process.env.REGISTRY_RPC || 'http://localhost:8545';

// In-memory swarm state (could be Redis/database in production)
let discoveredRobots: Map<string, any> = new Map();
let sharedMapData: any = null;
let claimedAreas: Map<string, string> = new Map(); // area_id -> robot_did
let lastPosition: { x: number; y: number; timestamp: number } | null = null;

/**
 * Tool: Discover Nearby Robots
 */
export const discoverNearbyRobots = tool({
  name: 'discover_nearby_robots',
  description: `Find other robots in the swarm by querying the blockchain registry.
    Returns a list of robots with their:
    - DID (identity)
    - Capabilities (explore, navigate, vision, etc.)
    - Last known position
    - Online status
    - A2A endpoint for communication
    Use this to find teammates for coordinated exploration.`,
  parameters: z.object({
    capability: z.string().optional().describe('Filter by capability (e.g., "explore", "navigate")'),
    max_distance: z.number().optional().describe('Max distance in meters (requires position data)'),
  }),
  execute: async ({ capability, max_distance }) => {
    console.log('[Swarm] Discovering nearby robots...');

    try {
      // Query the AgentRegistry smart contract
      const response = await fetch(`${REGISTRY_RPC}/agent_registry/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, includeOffline: false }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Registry query failed: ${response.status}`,
        };
      }

      const agents = await response.json();

      // Filter by distance if position data available
      let filtered = agents;
      if (max_distance && lastPosition) {
        filtered = agents.filter((agent: any) => {
          if (!agent.position) return false;
          const dx = agent.position.x - lastPosition!.x;
          const dy = agent.position.y - lastPosition!.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance <= max_distance;
        });
      }

      // Update local cache
      filtered.forEach((robot: any) => {
        discoveredRobots.set(robot.did, {
          ...robot,
          discovered_at: Date.now(),
        });
      });

      return {
        success: true,
        robots: filtered.map((r: any) => ({
          did: r.did,
          name: r.name,
          capabilities: r.capabilities,
          position: r.position,
          a2a_endpoint: r.endpoint,
          online: r.online,
        })),
        count: filtered.length,
        message: `Found ${filtered.length} robots in swarm`,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Share Map Data
 */
export const shareMapData = tool({
  name: 'share_map_data',
  description: `Upload explored map data to IPFS so other robots can access it.
    The map includes:
    - Explored areas (occupancy grid)
    - Detected objects and their locations
    - Obstacle positions
    - Timestamps and robot ID
    Other robots can download and merge this with their maps.`,
  parameters: z.object({
    map_data: z.object({
      explored_areas: z.array(z.object({
        x: z.number(),
        y: z.number(),
        occupied: z.boolean(),
      })).describe('Occupancy grid cells'),
      objects: z.array(z.object({
        type: z.string(),
        x: z.number(),
        y: z.number(),
        confidence: z.number(),
      })).optional().describe('Detected objects'),
    }).describe('Map data to share'),
  }),
  execute: async ({ map_data }) => {
    console.log('[Swarm] Uploading map data to IPFS...');

    try {
      // Add metadata
      const mapWithMeta = {
        ...map_data,
        robot_id: process.env.AGENT_NAME || 'unknown',
        timestamp: Date.now(),
        version: '1.0',
      };

      // Upload to IPFS
      const response = await fetch(`${IPFS_GATEWAY}/api/v0/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapWithMeta),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `IPFS upload failed: ${response.status}`,
        };
      }

      const result = await response.json();
      const ipfsCID = result.Hash;

      // Broadcast CID to swarm via blockchain event
      await fetch(`${REGISTRY_RPC}/agent_registry/broadcast_map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robot_did: process.env.AGENT_DID,
          map_cid: ipfsCID,
        }),
      });

      // Cache locally
      sharedMapData = mapWithMeta;

      return {
        success: true,
        ipfs_cid: ipfsCID,
        url: `https://ipfs.io/ipfs/${ipfsCID}`,
        cells_shared: map_data.explored_areas.length,
        objects_shared: map_data.objects?.length || 0,
        message: `Map data uploaded to IPFS: ${ipfsCID}`,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Request Robot Position
 */
export const requestRobotPosition = tool({
  name: 'request_robot_position',
  description: `Query another robot's current position and status.
    Send A2A message to get:
    - Current X, Y coordinates
    - Orientation/heading
    - Battery level
    - Current task/state
    Use this to coordinate movement and avoid collisions.`,
  parameters: z.object({
    robot_did: z.string().describe('DID of robot to query'),
  }),
  execute: async ({ robot_did }) => {
    console.log(`[Swarm] Requesting position from robot: ${robot_did}`);

    const robot = discoveredRobots.get(robot_did);
    if (!robot || !robot.a2a_endpoint) {
      return {
        success: false,
        error: 'Robot not found or no A2A endpoint',
      };
    }

    try {
      // Send A2A JSON-RPC request
      const response = await fetch(robot.a2a_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'get_position',
          params: {},
          id: Date.now(),
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `A2A request failed: ${response.status}`,
        };
      }

      const result = await response.json();

      return {
        success: true,
        robot_did,
        position: result.result.position,
        orientation: result.result.orientation,
        battery: result.result.battery,
        status: result.result.status,
        message: `Position received from ${robot.name || robot_did}`,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Claim Exploration Area
 */
export const claimExplorationArea = tool({
  name: 'claim_exploration_area',
  description: `Claim an area for exploration to prevent other robots from exploring the same space.
    Areas are defined by bounding boxes (min/max X, Y).
    Other robots will check claimed areas before planning their exploration.
    This prevents duplicate work and ensures efficient coverage.`,
  parameters: z.object({
    area_id: z.string().describe('Unique identifier for this area'),
    bounds: z.object({
      min_x: z.number(),
      max_x: z.number(),
      min_y: z.number(),
      max_y: z.number(),
    }).describe('Bounding box of area to claim'),
    priority: z.enum(['low', 'normal', 'high']).optional().describe('Exploration priority'),
  }),
  execute: async ({ area_id, bounds, priority = 'normal' }) => {
    console.log(`[Swarm] Claiming exploration area: ${area_id}`);

    // Check if area already claimed
    if (claimedAreas.has(area_id)) {
      const claimedBy = claimedAreas.get(area_id);
      if (claimedBy !== process.env.AGENT_DID) {
        return {
          success: false,
          error: `Area ${area_id} already claimed by ${claimedBy}`,
          claimed_by: claimedBy,
        };
      }
    }

    try {
      // Broadcast claim to swarm
      const response = await fetch(`${REGISTRY_RPC}/agent_registry/claim_area`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robot_did: process.env.AGENT_DID,
          area_id,
          bounds,
          priority,
          timestamp: Date.now(),
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to broadcast claim: ${response.status}`,
        };
      }

      // Update local cache
      claimedAreas.set(area_id, process.env.AGENT_DID || 'unknown');

      return {
        success: true,
        area_id,
        claimed_by: process.env.AGENT_DID,
        bounds,
        priority,
        message: `Area ${area_id} claimed successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Send Alert to Swarm
 */
export const sendSwarmAlert = tool({
  name: 'send_swarm_alert',
  description: `Broadcast an alert to all robots in the swarm.
    Alert types:
    - obstacle: Found impassable obstacle
    - danger: Safety hazard detected
    - discovery: Found interesting object
    - help: Robot stuck or needs assistance
    - complete: Task finished, area fully explored
    All robots will receive and can respond to the alert.`,
  parameters: z.object({
    alert_type: z.enum(['obstacle', 'danger', 'discovery', 'help', 'complete'])
      .describe('Type of alert to send'),
    location: z.object({
      x: z.number(),
      y: z.number(),
    }).optional().describe('Location related to alert'),
    message: z.string().describe('Human-readable alert message'),
    severity: z.enum(['info', 'warning', 'critical']).optional().describe('Alert severity'),
  }),
  execute: async ({ alert_type, location, message, severity = 'info' }) => {
    console.log(`[Swarm] Broadcasting ${severity} alert: ${alert_type}`);

    try {
      // Get all robots in swarm
      const robots = Array.from(discoveredRobots.values());

      if (robots.length === 0) {
        return {
          success: false,
          error: 'No robots discovered in swarm',
        };
      }

      // Prepare alert message
      const alert = {
        from: process.env.AGENT_DID,
        from_name: process.env.AGENT_NAME,
        type: alert_type,
        location,
        message,
        severity,
        timestamp: Date.now(),
      };

      // Broadcast to all robots via A2A
      const broadcasts = robots.map(async (robot) => {
        if (!robot.a2a_endpoint) return null;

        try {
          const response = await fetch(robot.a2a_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'receive_alert',
              params: alert,
              id: Date.now(),
            }),
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });

          return { robot: robot.did, success: response.ok };
        } catch {
          return { robot: robot.did, success: false };
        }
      });

      const results = await Promise.all(broadcasts);
      const successCount = results.filter(r => r?.success).length;

      return {
        success: true,
        alert_type,
        severity,
        recipients: robots.length,
        delivered: successCount,
        failed: robots.length - successCount,
        message: `Alert broadcast to ${successCount}/${robots.length} robots`,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Update My Position
 */
export const updateMyPosition = tool({
  name: 'update_my_position',
  description: `Update this robot's position in the swarm database.
    Other robots can query this to know where you are.
    Should be called periodically during exploration (every 5-10 seconds).`,
  parameters: z.object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    orientation: z.number().optional().describe('Heading in degrees'),
    battery: z.number().min(0).max(100).optional().describe('Battery percentage'),
  }),
  execute: async ({ x, y, orientation, battery }) => {
    console.log(`[Swarm] Updating position: (${x.toFixed(2)}, ${y.toFixed(2)})`);

    // Update local cache
    lastPosition = { x, y, timestamp: Date.now() };

    try {
      // Broadcast to swarm
      await fetch(`${REGISTRY_RPC}/agent_registry/update_position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          robot_did: process.env.AGENT_DID,
          position: { x, y, orientation, battery },
          timestamp: Date.now(),
        }),
      });

      return {
        success: true,
        position: { x, y },
        orientation,
        battery,
        message: 'Position updated in swarm',
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Export all swarm coordination tools
 */
export const swarmTools = [
  discoverNearbyRobots,
  shareMapData,
  requestRobotPosition,
  claimExplorationArea,
  sendSwarmAlert,
  updateMyPosition,
];

// Export state for testing/debugging
export { discoveredRobots, claimedAreas };
