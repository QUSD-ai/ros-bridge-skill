/**
 * ROS Bridge Skill - Complete Robot-to-Agent Pipeline
 *
 * @packageDocumentation
 */

// Core rosbridge client
export { RosbridgeClient } from './rosbridge-client';
export type { RosbridgeMessage, LaserScanMessage, DepthImageMessage } from './rosbridge-client';

// ROS Tools for VoltAgent
export {
  initializeROS,
  getRosClient,
  moveForward,
  turn,
  stop,
  readLidar,
  rosTools,
} from './ros-tools';

// Vision tools (camera, CV modes)
export { visionTools } from './tools/vision';

// Sensor tools (lidar, IMU, sensor fusion)
export { sensorTools, initSensorFusion } from './tools/sensors';

// Exploration tools (mapping, frontiers, path planning)
export { explorationTools } from './tools/exploration';

// Swarm tools (multi-robot coordination)
export { swarmTools } from './tools/swarm';

// Hardware tools (LEDs, display, gimbal)
export { hardwareTools } from './tools/hardware';

// X402 payment wrapper
export { createX402RobotServer } from './x402-wrapper';

// All tools combined
export const allRobotTools = [
  // Will be populated by imports
];
