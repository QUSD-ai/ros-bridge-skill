/**
 * Sensor Fusion Tools for UGV Agent
 *
 * Combine LIDAR, camera, and IMU data for enhanced perception
 */

import { tool } from '@voltagent/core';
import { z } from 'zod';
import type { RosClient } from '@qusd/ros-client';

let rosClient: RosClient | null = null;
let lastLidarScan: any = null;
let lastOdometry: any = null;
let lastCameraDetections: any[] = [];

/**
 * Initialize sensor fusion with ROS client
 */
export function initSensorFusion(client: RosClient) {
  rosClient = client;

  // Subscribe to all sensor topics
  rosClient.subscribe('/scan', (scan) => {
    lastLidarScan = scan;
  });

  rosClient.subscribe('/odom', (odom) => {
    lastOdometry = odom;
  });

  console.log('[Sensors] Sensor fusion initialized');
}

/**
 * Tool: Get Multi-Sensor Scan
 */
export const getMultiSensorScan = tool({
  name: 'get_multi_sensor_scan',
  description: `Get a comprehensive scan combining all available sensors:
    - LIDAR: 360° obstacle distances
    - Camera: Detected objects with positions
    - IMU/Odometry: Robot pose and orientation
    This provides a complete environmental awareness snapshot.`,
  parameters: z.object({
    include_camera: z.boolean().optional().describe('Include camera detections (default: true)'),
    min_obstacle_distance: z.number().optional().describe('Filter obstacles closer than this (meters)'),
  }),
  execute: async ({ include_camera = true, min_obstacle_distance }) => {
    if (!rosClient) {
      return { success: false, error: 'ROS not connected' };
    }

    console.log('[Sensors] Performing multi-sensor scan');

    // LIDAR Data
    let lidarData = null;
    if (lastLidarScan && lastLidarScan.ranges) {
      const ranges = lastLidarScan.ranges;
      const numRanges = ranges.length;
      const regionSize = Math.floor(numRanges / 8);

      const minDistance = (region: number[]) => {
        const filtered = region.filter(r => r > 0 && r < 100);
        if (min_obstacle_distance) {
          return filtered.filter(r => r < min_obstacle_distance);
        }
        return filtered.length > 0 ? Math.min(...filtered) : null;
      };

      lidarData = {
        front: minDistance(ranges.slice(0, regionSize)),
        frontRight: minDistance(ranges.slice(regionSize, regionSize * 2)),
        right: minDistance(ranges.slice(regionSize * 2, regionSize * 3)),
        backRight: minDistance(ranges.slice(regionSize * 3, regionSize * 4)),
        back: minDistance(ranges.slice(regionSize * 4, regionSize * 5)),
        backLeft: minDistance(ranges.slice(regionSize * 5, regionSize * 6)),
        left: minDistance(ranges.slice(regionSize * 6, regionSize * 7)),
        frontLeft: minDistance(ranges.slice(regionSize * 7)),
      };
    }

    // Odometry Data
    let poseData = null;
    if (lastOdometry) {
      const pos = lastOdometry.pose?.pose?.position;
      const orient = lastOdometry.pose?.pose?.orientation;
      poseData = {
        position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        orientation: orient ? { x: orient.x, y: orient.y, z: orient.z, w: orient.w } : null,
      };
    }

    // Camera Data
    let cameraData = null;
    if (include_camera && lastCameraDetections.length > 0) {
      cameraData = {
        object_count: lastCameraDetections.length,
        objects: lastCameraDetections.map(det => ({
          type: det.class,
          confidence: det.confidence,
          distance_estimate: det.distance,
          bearing: det.bearing,
        })),
      };
    }

    return {
      success: true,
      timestamp: Date.now(),
      lidar: lidarData,
      pose: poseData,
      camera: cameraData,
      message: 'Multi-sensor scan complete',
    };
  },
});

/**
 * Tool: Detect Obstacles 360°
 */
export const detect360Obstacles = tool({
  name: 'detect_obstacles_360',
  description: `Perform a complete 360° obstacle scan using LIDAR.
    Returns:
    - All obstacles with distances and directions
    - Closest obstacle in each direction
    - Safe movement directions
    - Recommended navigation paths
    Use this before planning any movement for comprehensive safety check.`,
  parameters: z.object({
    danger_distance: z.number().optional().describe('Distance threshold for danger warnings (default: 0.5m)'),
    safe_distance: z.number().optional().describe('Distance threshold for safe zones (default: 2.0m)'),
  }),
  execute: async ({ danger_distance = 0.5, safe_distance = 2.0 }) => {
    if (!rosClient || !lastLidarScan) {
      return { success: false, error: 'No LIDAR data available' };
    }

    console.log('[Sensors] Performing 360° obstacle detection');

    const ranges = lastLidarScan.ranges;
    const numRanges = ranges.length;
    const regionSize = Math.floor(numRanges / 8);

    const regions = ['front', 'frontRight', 'right', 'backRight', 'back', 'backLeft', 'left', 'frontLeft'];
    const obstacleMap: any = {};
    const dangerZones: string[] = [];
    const safeZones: string[] = [];

    for (let i = 0; i < 8; i++) {
      const region = regions[i];
      const start = i * regionSize;
      const end = i === 7 ? numRanges : (i + 1) * regionSize;
      const regionRanges = ranges.slice(start, end).filter((r: number) => r > 0 && r < 100);

      if (regionRanges.length === 0) {
        obstacleMap[region] = { min: null, avg: null, status: 'unknown' };
        continue;
      }

      const minDist = Math.min(...regionRanges);
      const avgDist = regionRanges.reduce((a: number, b: number) => a + b, 0) / regionRanges.length;

      let status: string;
      if (minDist < danger_distance) {
        status = 'danger';
        dangerZones.push(region);
      } else if (minDist > safe_distance) {
        status = 'safe';
        safeZones.push(region);
      } else {
        status = 'caution';
      }

      obstacleMap[region] = {
        min: minDist.toFixed(2),
        avg: avgDist.toFixed(2),
        status,
      };
    }

    // Find the globally closest obstacle
    const allDistances = Object.values(obstacleMap)
      .map((r: any) => r.min)
      .filter((d): d is number => d !== null)
      .map(Number);

    const closestObstacle = allDistances.length > 0 ? Math.min(...allDistances) : null;

    // Determine safe movement directions
    const safeFront = obstacleMap.front.status !== 'danger';
    const safeBack = obstacleMap.back.status !== 'danger';
    const canTurnLeft = obstacleMap.left.status !== 'danger' && obstacleMap.frontLeft.status !== 'danger';
    const canTurnRight = obstacleMap.right.status !== 'danger' && obstacleMap.frontRight.status !== 'danger';

    return {
      success: true,
      obstacles: obstacleMap,
      closest_obstacle: closestObstacle,
      danger_zones: dangerZones,
      safe_zones: safeZones,
      movement_options: {
        can_move_forward: safeFront,
        can_move_backward: safeBack,
        can_turn_left: canTurnLeft,
        can_turn_right: canTurnRight,
      },
      recommendation: safeFront ? 'Forward clear' :
                       canTurnLeft ? 'Turn left to avoid obstacle' :
                       canTurnRight ? 'Turn right to avoid obstacle' :
                       safeBack ? 'Reverse to escape' :
                       'STUCK: No safe direction!',
      message: `360° scan complete. ${dangerZones.length} danger zones, ${safeZones.length} safe zones.`,
    };
  },
});

/**
 * Tool: Estimate Robot Pose
 */
export const estimateRobotPose = tool({
  name: 'estimate_robot_pose',
  description: `Get the robot's current estimated position and orientation using IMU/odometry.
    Returns:
    - X, Y coordinates (relative to start point)
    - Orientation (yaw angle in degrees)
    - Linear and angular velocities
    Use this to track where the robot has traveled and which way it's facing.`,
  parameters: z.object({}),
  execute: async () => {
    if (!rosClient || !lastOdometry) {
      return { success: false, error: 'No odometry data available' };
    }

    console.log('[Sensors] Estimating robot pose');

    const pos = lastOdometry.pose?.pose?.position;
    const orient = lastOdometry.pose?.pose?.orientation;
    const twist = lastOdometry.twist?.twist;

    // Convert quaternion to yaw angle (degrees)
    let yaw_degrees = 0;
    if (orient) {
      const siny_cosp = 2 * (orient.w * orient.z + orient.x * orient.y);
      const cosy_cosp = 1 - 2 * (orient.y * orient.y + orient.z * orient.z);
      yaw_degrees = Math.atan2(siny_cosp, cosy_cosp) * (180 / Math.PI);
    }

    return {
      success: true,
      position: pos ? {
        x: pos.x.toFixed(3),
        y: pos.y.toFixed(3),
        z: pos.z.toFixed(3),
      } : null,
      orientation: {
        yaw_degrees: yaw_degrees.toFixed(1),
        facing: yaw_degrees > -45 && yaw_degrees < 45 ? 'forward' :
                yaw_degrees >= 45 && yaw_degrees < 135 ? 'left' :
                yaw_degrees <= -45 && yaw_degrees > -135 ? 'right' :
                'backward',
      },
      velocity: twist ? {
        linear: twist.linear?.x.toFixed(2),
        angular: twist.angular?.z.toFixed(2),
      } : null,
      message: `Robot at (${pos?.x.toFixed(2)}, ${pos?.y.toFixed(2)}), facing ${yaw_degrees.toFixed(0)}°`,
    };
  },
});

/**
 * Tool: Find Safe Path
 */
export const findSafePath = tool({
  name: 'find_safe_path',
  description: `Analyze sensor data to find a safe path forward.
    Uses LIDAR + camera + odometry to:
    - Identify obstacles
    - Find gaps and corridors
    - Suggest optimal movement direction
    - Calculate safe speed based on clearance
    This is a high-level planning tool for autonomous navigation.`,
  parameters: z.object({
    target_direction: z.enum(['forward', 'left', 'right', 'backward', 'auto']).optional()
      .describe('Preferred direction (default: auto = find best path)'),
  }),
  execute: async ({ target_direction = 'auto' }) => {
    if (!rosClient || !lastLidarScan) {
      return { success: false, error: 'Sensor data not available' };
    }

    console.log('[Sensors] Finding safe path');

    // Run 360° obstacle detection
    const obstacleResult = await detect360Obstacles.execute({ danger_distance: 0.5, safe_distance: 2.0 });

    if (!obstacleResult.success) {
      return obstacleResult;
    }

    const movementOptions = obstacleResult.movement_options;
    let recommendedAction: any = null;
    let safest_direction: string | null = null;

    // Determine safest direction
    if (target_direction === 'auto') {
      // Find direction with most clearance
      const obstacles = obstacleResult.obstacles;
      const directions = ['front', 'frontLeft', 'left', 'frontRight', 'right'];
      const clearances = directions.map(dir => ({
        dir,
        min: obstacles[dir]?.min ? Number(obstacles[dir].min) : 0,
        status: obstacles[dir]?.status,
      }));

      clearances.sort((a, b) => b.min - a.min);
      const best = clearances[0];

      if (best.min > 0.5) {
        safest_direction = best.dir;
        recommendedAction = {
          action: best.dir.includes('front') ? 'move_forward' : 'turn',
          speed: Math.min(0.5, best.min / 4), // Slower near obstacles
          direction: best.dir,
        };
      } else {
        recommendedAction = {
          action: 'stop',
          reason: 'All directions blocked',
        };
      }
    } else {
      // Check requested direction
      const directionMap: Record<string, keyof typeof movementOptions> = {
        forward: 'can_move_forward',
        backward: 'can_move_backward',
        left: 'can_turn_left',
        right: 'can_turn_right',
      };

      const canMove = movementOptions[directionMap[target_direction]];
      if (canMove) {
        recommendedAction = {
          action: target_direction.includes('forward') || target_direction.includes('backward') ? 'move' : 'turn',
          safe: true,
          direction: target_direction,
        };
      } else {
        recommendedAction = {
          action: 'blocked',
          direction: target_direction,
          alternative: obstacleResult.recommendation,
        };
      }
    }

    return {
      success: true,
      safest_direction,
      recommended_action: recommendedAction,
      obstacle_summary: {
        danger_zones: obstacleResult.danger_zones,
        safe_zones: obstacleResult.safe_zones,
        closest_obstacle: obstacleResult.closest_obstacle,
      },
      message: `Path analysis complete. Recommended: ${JSON.stringify(recommendedAction)}`,
    };
  },
});

/**
 * Export all sensor tools
 */
export const sensorTools = [
  getMultiSensorScan,
  detect360Obstacles,
  estimateRobotPose,
  findSafePath,
];
