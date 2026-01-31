---
name: ros-bridge
version: 1.0.0
description: Connect AI agents to ROS robots via rosbridge. Control motors, read sensors, subscribe to topics. Works with any ROS1/ROS2 robot.
homepage: https://github.com/QUSD-ai/ros-bridge-skill
metadata:
  emoji: "🤖"
  category: robotics
  tags: ["ros", "robotics", "hardware", "rosbridge", "jetson"]
---

# ROS Bridge Skill

Connect your AI agent to any ROS robot. Send commands, read sensors, control motors.

## What It Does

```
AI Agent ──► Rosbridge WebSocket ──► ROS Robot
              (port 9090)              (motors, cameras, lidar)
```

## Prerequisites

1. Robot running ROS with rosbridge_server:
```bash
# ROS1
roslaunch rosbridge_server rosbridge_websocket.launch

# ROS2
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

2. Network access to robot (usually `ws://ROBOT_IP:9090`)

## Quick Start

```typescript
import { RosbridgeClient } from './rosbridge-client';

// Connect to robot
const robot = new RosbridgeClient('192.168.1.100', 9090);
await robot.connect();

// Subscribe to laser scan
robot.subscribe('/scan', 'sensor_msgs/LaserScan', (data) => {
  console.log('Obstacle at:', Math.min(...data.ranges), 'meters');
});

// Send velocity command
robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
  linear: { x: 0.5, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0.2 }
});

// Call a service
const result = await robot.callService('/move_base/clear_costmaps', {});
```

## Common Topics

| Topic | Type | Description |
|-------|------|-------------|
| `/cmd_vel` | geometry_msgs/Twist | Velocity commands |
| `/odom` | nav_msgs/Odometry | Robot position |
| `/scan` | sensor_msgs/LaserScan | Lidar data |
| `/camera/image_raw` | sensor_msgs/Image | Camera feed |
| `/imu/data` | sensor_msgs/Imu | IMU readings |

## Example: Obstacle Avoidance

```typescript
// Simple reactive obstacle avoidance
robot.subscribe('/scan', 'sensor_msgs/LaserScan', (scan) => {
  const frontDistance = scan.ranges[scan.ranges.length / 2];
  
  if (frontDistance < 0.5) {
    // Obstacle! Turn away
    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0.5 }
    });
  } else {
    // Clear, move forward
    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0.3, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 }
    });
  }
});
```

## Supported Robots

Any robot running ROS with rosbridge:
- Waveshare UGV (Rover, Beast, RaspRover)
- TurtleBot
- Clearpath Jackal/Husky
- Custom robots with ROS

## A2A Integration

Expose your robot as an A2A agent:

```typescript
import { createRobotAgent } from './robot-agent';

const agent = createRobotAgent({
  robotUrl: 'ws://192.168.1.100:9090',
  port: 3010,
  skills: ['move', 'scan', 'capture_image']
});

await agent.start();
// Robot now discoverable at /.well-known/agent.json
```

Other agents can now find and control your robot via A2A protocol.

## Links

- [rosbridge_suite](http://wiki.ros.org/rosbridge_suite)
- [roslibjs](http://wiki.ros.org/roslibjs)
- [QUSD Hardware Skills](https://github.com/QUSD-ai/hardware-skills)
