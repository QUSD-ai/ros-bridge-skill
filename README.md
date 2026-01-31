# 🤖 ROS Bridge Skill

**Complete robot-to-agent pipeline.** Connect any ROS robot to AI agents.

## Features

- ✅ WebSocket client for rosbridge
- ✅ 20+ VoltAgent tools (move, scan, explore, vision)
- ✅ 9 computer vision modes (YOLO, faces, QR, colors...)
- ✅ Sensor fusion (LIDAR + camera + IMU)
- ✅ Autonomous exploration & mapping
- ✅ Multi-robot swarm coordination
- ✅ A2A agent factory (discoverable robots)
- ✅ X402 payments (charge per API call)

## Quick Start

```typescript
import { createRobotAgent } from '@qusd/ros-bridge-skill';

const agent = createRobotAgent({
  name: 'my-robot',
  rosUrl: 'ws://192.168.1.100:9090',
  port: 3001,
});

await agent.start();
// Robot now discoverable at /.well-known/agent.json
```

## Manual Control

```typescript
import { RosbridgeClient } from '@qusd/ros-bridge-skill';

const robot = new RosbridgeClient('192.168.1.100', 9090);
await robot.connect();

// Move forward
robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
  linear: { x: 0.5, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 }
});

// Read LIDAR
robot.subscribe('/scan', 'sensor_msgs/LaserScan', (data) => {
  console.log('Closest obstacle:', Math.min(...data.ranges), 'm');
});
```

## VoltAgent Integration

```typescript
import { Agent } from '@voltagent/core';
import { rosTools, visionTools, explorationTools } from '@qusd/ros-bridge-skill';

const agent = new Agent({
  name: 'explorer-bot',
  tools: [...rosTools, ...visionTools, ...explorationTools],
});

await agent.chat('Explore this room and map obstacles');
```

## Supported Robots

Works with any ROS1/ROS2 robot running rosbridge:
- Waveshare UGV (Rover, Beast, RaspRover)
- TurtleBot 3/4
- Clearpath Jackal/Husky
- Any custom ROS robot

## Documentation

See [SKILL.md](./SKILL.md) for complete documentation.

## Links

- [GitHub](https://github.com/QUSD-ai/ros-bridge-skill)
- [QUSD Hardware Skills](https://github.com/QUSD-ai/hardware-skills)
- [X402 Payments](https://github.com/QUSD-ai/x402-payments)

## License

MIT
