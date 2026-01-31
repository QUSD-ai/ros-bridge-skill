import WebSocket from 'ws';

export interface RosbridgeMessage {
  op: string;
  topic?: string;
  msg?: any;
  type?: string;
  id?: string;
}

export interface LaserScanMessage {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  intensities: number[];
}

export interface DepthImageMessage {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  height: number;
  width: number;
  encoding: string;
  is_bigendian: number;
  step: number;
  data: number[];
}

export class RosbridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private subscribers: Map<string, (data: any) => void> = new Map();
  private reconnectInterval: number = 5000;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(host: string = 'localhost', port: number = 9090) {
    this.url = `ws://${host}:${port}`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);

        ws.on('open', () => {
          console.log(`✅ Connected to rosbridge at ${this.url}`);
          this.ws = ws;
          this.setupEventHandlers();
          resolve();
        });

        ws.on('error', (error) => {
          console.error('❌ Rosbridge connection error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', (data: Buffer) => {
      try {
        const message: RosbridgeMessage = JSON.parse(data.toString());

        if (message.op === 'publish' && message.topic) {
          const callback = this.subscribers.get(message.topic);
          if (callback) {
            callback(message.msg);
          }
        }
      } catch (error) {
        console.error('Error parsing rosbridge message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('⚠️  Disconnected from rosbridge, reconnecting...');
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('Rosbridge WebSocket error:', error);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // Re-subscribe to all topics
        for (const topic of this.subscribers.keys()) {
          await this.subscribe(topic, this.subscribers.get(topic)!);
        }
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.scheduleReconnect();
      }
    }, this.reconnectInterval);
  }

  async subscribe(topic: string, callback: (data: any) => void, type?: string): Promise<void> {
    if (!this.ws) {
      throw new Error('Not connected to rosbridge');
    }

    this.subscribers.set(topic, callback);

    const message: RosbridgeMessage = {
      op: 'subscribe',
      topic,
    };

    if (type) {
      message.type = type;
    }

    this.ws.send(JSON.stringify(message));
    console.log(`📡 Subscribed to topic: ${topic}`);
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.ws) return;

    this.subscribers.delete(topic);

    const message: RosbridgeMessage = {
      op: 'unsubscribe',
      topic,
    };

    this.ws.send(JSON.stringify(message));
    console.log(`🔇 Unsubscribed from topic: ${topic}`);
  }

  async publish(topic: string, message: any, type?: string): Promise<void> {
    if (!this.ws) {
      throw new Error('Not connected to rosbridge');
    }

    const rosbridgeMsg: RosbridgeMessage = {
      op: 'publish',
      topic,
      msg: message,
    };

    if (type) {
      rosbridgeMsg.type = type;
    }

    this.ws.send(JSON.stringify(rosbridgeMsg));
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribers.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}