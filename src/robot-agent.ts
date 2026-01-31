/**
 * Robot Agent Factory
 *
 * Creates an A2A-compliant agent server for a ROS robot.
 * Other agents can discover and control this robot via the A2A protocol.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { RosbridgeClient } from './rosbridge-client';

export interface RobotAgentConfig {
  /** Robot name for discovery */
  name: string;
  /** Rosbridge WebSocket URL */
  rosUrl: string;
  /** Port to serve A2A endpoints */
  port: number;
  /** Robot capabilities to advertise */
  capabilities?: string[];
  /** Robot description */
  description?: string;
}

export interface RobotAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
  robot: RosbridgeClient;
}

/**
 * Create an A2A-compliant robot agent
 */
export function createRobotAgent(config: RobotAgentConfig): RobotAgent {
  const app = new Hono();
  const robot = new RosbridgeClient(
    new URL(config.rosUrl).hostname,
    parseInt(new URL(config.rosUrl).port) || 9090
  );

  let server: any = null;
  let lastScan: any = null;

  // Agent Card endpoint
  app.get('/.well-known/agent.json', (c) => {
    return c.json({
      name: config.name,
      description: config.description || `ROS robot agent: ${config.name}`,
      version: '1.0.0',
      url: `http://localhost:${config.port}`,
      capabilities: config.capabilities || ['move', 'scan', 'stop'],
      skills: [
        {
          id: 'move',
          name: 'Move Robot',
          description: 'Move the robot forward/backward',
          inputModes: ['text'],
          outputModes: ['text'],
        },
        {
          id: 'turn',
          name: 'Turn Robot',
          description: 'Rotate the robot left/right',
          inputModes: ['text'],
          outputModes: ['text'],
        },
        {
          id: 'scan',
          name: 'LIDAR Scan',
          description: 'Get obstacle distances from LIDAR',
          inputModes: ['text'],
          outputModes: ['text'],
        },
        {
          id: 'stop',
          name: 'Stop Robot',
          description: 'Emergency stop all movement',
          inputModes: ['text'],
          outputModes: ['text'],
        },
      ],
      provider: {
        organization: 'QUSD Robotics',
      },
    });
  });

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      connected: robot.isConnected(),
      name: config.name,
    });
  });

  // REST API endpoints
  app.post('/api/move', async (c) => {
    const { speed = 0.3, duration = 1 } = await c.req.json();
    
    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: speed, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    await new Promise(r => setTimeout(r, duration * 1000));

    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    return c.json({ success: true, moved: { speed, duration } });
  });

  app.post('/api/turn', async (c) => {
    const { angular = 0.3, duration = 1 } = await c.req.json();
    
    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    });

    await new Promise(r => setTimeout(r, duration * 1000));

    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });

    return c.json({ success: true, turned: { angular, duration } });
  });

  app.post('/api/stop', async (c) => {
    robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    });
    return c.json({ success: true, stopped: true });
  });

  app.get('/api/scan', (c) => {
    if (!lastScan) {
      return c.json({ error: 'No scan data available' }, 503);
    }
    return c.json({
      success: true,
      scan: {
        ranges: lastScan.ranges,
        min_distance: Math.min(...lastScan.ranges.filter((r: number) => r > 0)),
        max_distance: Math.max(...lastScan.ranges),
        angle_min: lastScan.angle_min,
        angle_max: lastScan.angle_max,
      },
    });
  });

  // A2A JSON-RPC endpoint
  app.post('/a2a', async (c) => {
    const { method, params, id } = await c.req.json();

    if (method === 'tasks/send') {
      const text = params?.message?.parts?.[0]?.text || '';
      const lowerText = text.toLowerCase();

      let result = '';

      if (lowerText.includes('move') || lowerText.includes('forward')) {
        const speed = 0.3;
        robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
          linear: { x: speed, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0 },
        });
        await new Promise(r => setTimeout(r, 1000));
        robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
          linear: { x: 0, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0 },
        });
        result = 'Moved forward for 1 second';
      } else if (lowerText.includes('turn') || lowerText.includes('rotate')) {
        const direction = lowerText.includes('right') ? -0.5 : 0.5;
        robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
          linear: { x: 0, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: direction },
        });
        await new Promise(r => setTimeout(r, 1000));
        robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
          linear: { x: 0, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0 },
        });
        result = `Turned ${direction > 0 ? 'left' : 'right'} for 1 second`;
      } else if (lowerText.includes('stop')) {
        robot.publish('/cmd_vel', 'geometry_msgs/Twist', {
          linear: { x: 0, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0 },
        });
        result = 'Stopped all movement';
      } else if (lowerText.includes('scan') || lowerText.includes('lidar')) {
        if (lastScan) {
          const min = Math.min(...lastScan.ranges.filter((r: number) => r > 0));
          result = `LIDAR scan: closest obstacle at ${min.toFixed(2)}m`;
        } else {
          result = 'No LIDAR data available';
        }
      } else {
        result = `Received: "${text}". Available commands: move, turn, stop, scan`;
      }

      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          id: crypto.randomUUID(),
          state: 'COMPLETED',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: result }] }],
        },
      });
    }

    return c.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  return {
    robot,
    async start() {
      // Connect to robot
      await robot.connect();

      // Subscribe to LIDAR
      robot.subscribe('/scan', 'sensor_msgs/LaserScan', (data) => {
        lastScan = data;
      });

      // Start HTTP server
      server = serve({ fetch: app.fetch, port: config.port });

      console.log(`🤖 Robot Agent "${config.name}" started`);
      console.log(`   A2A: http://localhost:${config.port}/.well-known/agent.json`);
      console.log(`   API: http://localhost:${config.port}/api/*`);
    },
    async stop() {
      await robot.disconnect();
      if (server) {
        server.close();
      }
    },
  };
}
