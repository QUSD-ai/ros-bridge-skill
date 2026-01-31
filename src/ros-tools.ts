/**
 * ROS Tools for LLM Agent Control of UGV
 */

import { RosClient } from '@qusd/ros-client';
import { tool } from '@voltagent/core';
import { z } from 'zod';

let rosClient: RosClient | null = null;
let lastLidarScan: any = null;

/**
 * Initialize ROS connection
 */
export function initializeROS(rosbridgeUrl: string) {
  console.log(`[ROS Tools] Connecting to rosbridge at ${rosbridgeUrl}...`);

  rosClient = new RosClient({ url: rosbridgeUrl });

  // Subscribe to LIDAR for obstacle detection
  rosClient.subscribe('/scan', (scan) => {
    lastLidarScan = scan;
  });

  console.log('[ROS Tools] Connected and subscribed to /scan');
}

/**
 * Get the ROS client instance (for sensor fusion and other tools)
 */
export function getRosClient(): RosClient | null {
  return rosClient;
}

/**
 * Tool: Move the robot forward
 */
export const moveForward = tool({
  name: 'move_forward',
  description: 'Move the UGV robot forward at a specified speed (in meters per second). Use this to navigate forward.',
  parameters: z.object({
    speed: z.number().min(0).max(1.0).describe('Forward speed in m/s (0.0 to 1.0)'),
    duration_seconds: z.number().min(0.1).max(10).describe('How long to move forward (0.1 to 10 seconds)'),
  }),
  execute: async ({ speed, duration_seconds }) => {
    if (!rosClient) {
      return { success: false, error: 'ROS not connected' };
    }

    console.log(`[ROS Tools] Moving forward at ${speed} m/s for ${duration_seconds}s`);

    // Publish Twist message
    rosClient.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: speed, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    // Stop after duration
    await new Promise(resolve => setTimeout(resolve, duration_seconds * 1000));

    rosClient.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    return {
      success: true,
      message: `Moved forward at ${speed} m/s for ${duration_seconds} seconds`,
    };
  },
});

/**
 * Tool: Turn the robot
 */
export const turn = tool({
  name: 'turn',
  description: 'Turn the UGV robot left (positive) or right (negative) at a specified angular velocity.',
  parameters: z.object({
    angular_velocity: z.number().min(-1.0).max(1.0).describe('Angular velocity in rad/s (-1.0=right, +1.0=left)'),
    duration_seconds: z.number().min(0.1).max(10).describe('How long to turn (0.1 to 10 seconds)'),
  }),
  execute: async ({ angular_velocity, duration_seconds }) => {
    if (!rosClient) {
      return { success: false, error: 'ROS not connected' };
    }

    const direction = angular_velocity > 0 ? 'left' : 'right';
    console.log(`[ROS Tools] Turning ${direction} at ${Math.abs(angular_velocity)} rad/s for ${duration_seconds}s`);

    // Publish Twist message
    rosClient.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular_velocity },
    });

    // Stop after duration
    await new Promise(resolve => setTimeout(resolve, duration_seconds * 1000));

    rosClient.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    return {
      success: true,
      message: `Turned ${direction} at ${Math.abs(angular_velocity)} rad/s for ${duration_seconds} seconds`,
    };
  },
});

/**
 * Tool: Stop the robot
 */
export const stop = tool({
  name: 'stop',
  description: 'Immediately stop all robot movement (linear and angular).',
  parameters: z.object({}),
  execute: async () => {
    if (!rosClient) {
      return { success: false, error: 'ROS not connected' };
    }

    console.log('[ROS Tools] Stopping robot');

    rosClient.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    return {
      success: true,
      message: 'Robot stopped',
    };
  },
});

/**
 * Tool: Read LIDAR scan to detect obstacles
 */
export const readLidar = tool({
  name: 'read_lidar',
  description: 'Read the current LIDAR scan to detect obstacles around the robot. Returns distances in different directions.',
  parameters: z.object({}),
  execute: async () => {
    if (!rosClient) {
      return { success: false, error: 'ROS not connected' };
    }

    if (!lastLidarScan || !lastLidarScan.ranges) {
      return {
        success: false,
        error: 'No LIDAR data available yet',
      };
    }

    const ranges = lastLidarScan.ranges;
    const numRanges = ranges.length;

    // Divide scan into regions
    const regionSize = Math.floor(numRanges / 8);

    const front = ranges.slice(0, regionSize);
    const frontRight = ranges.slice(regionSize, regionSize * 2);
    const right = ranges.slice(regionSize * 2, regionSize * 3);
    const backRight = ranges.slice(regionSize * 3, regionSize * 4);
    const back = ranges.slice(regionSize * 4, regionSize * 5);
    const backLeft = ranges.slice(regionSize * 5, regionSize * 6);
    const left = ranges.slice(regionSize * 6, regionSize * 7);
    const frontLeft = ranges.slice(regionSize * 7);

    const minDistance = (region: number[]) => {
      const filtered = region.filter(r => r > 0 && r < 100); // Filter invalid readings
      return filtered.length > 0 ? Math.min(...filtered) : null;
    };

    return {
      success: true,
      scan: {
        front: minDistance(front),
        frontRight: minDistance(frontRight),
        right: minDistance(right),
        backRight: minDistance(backRight),
        back: minDistance(back),
        backLeft: minDistance(backLeft),
        left: minDistance(left),
        frontLeft: minDistance(frontLeft),
      },
      message: 'LIDAR scan read successfully. Distances in meters. null = no obstacle detected.',
    };
  },
});

/**
 * Export all ROS tools as array
 */
export const rosTools = [
  moveForward,
  turn,
  stop,
  readLidar,
];
