# 🤖 ROS Bridge Skill

Connect your AI agent to any ROS robot via rosbridge WebSocket.

## Install

```bash
bun add ws
```

## Usage

```typescript
import { RosbridgeClient } from './rosbridge-client';

const robot = new RosbridgeClient('192.168.1.100', 9090);
await robot.connect();

// Control robot
robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
  linear: { x: 0.5, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 }
});
```

See [SKILL.md](./SKILL.md) for full documentation.
