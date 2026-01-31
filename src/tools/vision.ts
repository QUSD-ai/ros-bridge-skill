/**
 * Vision and Computer Vision Tools for UGV Agent
 *
 * Provides access to the robot's 9 CV modes and camera control
 */

import { tool } from '@voltagent/core';
import { z } from 'zod';

const ROBOT_URL = process.env.ROBOT_HTTP_URL || 'http://192.168.0.221:5000';

/**
 * Helper function to send HTTP commands to robot
 */
async function sendCommand(cmd: any): Promise<{ success: boolean; error?: string }> {
  try {
    const formData = new FormData();
    formData.append('command', `base -c ${JSON.stringify(cmd)}`);

    const response = await fetch(`${ROBOT_URL}/send_command`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Tool: Activate Computer Vision Mode
 */
export const activateCVMode = tool({
  name: 'activate_cv_mode',
  description: `Activate one of 9 computer vision modes on the robot's camera:
    1. Motion Detection - Detect moving objects
    2. Face Detection - Identify human faces
    3. Color Tracking - Follow specific colors
    4. Object Detection - Identify common objects
    5. Hand Gesture Recognition - Detect hand gestures
    6. Body Pose Estimation - Track human poses
    7. Line Following - Follow lines on ground
    8. QR Code Detection - Read QR codes
    9. Distance Estimation - Measure object distances
  Use this to enhance the robot's perception for specific tasks.`,
  parameters: z.object({
    mode: z.enum(['motion', 'face', 'color', 'objects', 'hand', 'pose', 'line_follow', 'qr_code', 'distance'])
      .describe('Which CV mode to activate'),
    parameters: z.object({
      color_hsv: z.array(z.number()).optional().describe('For color tracking: HSV values [H, S, V]'),
      confidence_threshold: z.number().min(0).max(1).optional().describe('Detection confidence threshold (0-1)'),
    }).optional().describe('Mode-specific parameters'),
  }),
  execute: async ({ mode, parameters }) => {
    console.log(`[Vision] Activating CV mode: ${mode}`);

    // Map mode names to robot command codes
    const modeMap: Record<string, number> = {
      motion: 201,
      face: 202,
      color: 203,
      objects: 204,
      hand: 205,
      pose: 206,
      line_follow: 207,
      qr_code: 208,
      distance: 209,
    };

    const modeCode = modeMap[mode];
    if (!modeCode) {
      return {
        success: false,
        error: `Unknown CV mode: ${mode}`,
      };
    }

    // Build command with optional parameters
    const cmd: any = { T: modeCode };
    if (parameters?.color_hsv) {
      cmd.H = parameters.color_hsv[0];
      cmd.S = parameters.color_hsv[1];
      cmd.V = parameters.color_hsv[2];
    }
    if (parameters?.confidence_threshold) {
      cmd.threshold = parameters.confidence_threshold;
    }

    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        mode_activated: mode,
        message: `Computer vision mode '${mode}' is now active. Camera feed will show ${mode} detection.`,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to activate CV mode',
      };
    }
  },
});

/**
 * Tool: Get Camera Detection Results
 */
export const getDetectionResults = tool({
  name: 'get_detection_results',
  description: 'Get the latest detection results from the active CV mode. Returns objects, faces, or features detected by the camera.',
  parameters: z.object({
    timeout_ms: z.number().optional().describe('How long to wait for detections (default: 1000ms)'),
  }),
  execute: async ({ timeout_ms = 1000 }) => {
    console.log('[Vision] Fetching detection results...');

    try {
      // Poll the robot's detection API
      const response = await fetch(`${ROBOT_URL}/cv_detections`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout_ms),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
        };
      }

      const detections = await response.json();

      return {
        success: true,
        detections: detections,
        count: detections.length || 0,
        message: `Found ${detections.length || 0} detections`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return {
          success: true,
          detections: [],
          count: 0,
          message: 'No detections found in time window',
        };
      }
      return {
        success: false,
        error: String(error),
      };
    }
  },
});

/**
 * Tool: Track Object with Camera
 */
export const trackObject = tool({
  name: 'track_object',
  description: 'Enable camera tracking of a detected object. The camera gimbal will automatically follow the object as it moves.',
  parameters: z.object({
    object_id: z.number().optional().describe('Specific object ID to track (from detection results)'),
    object_type: z.enum(['face', 'person', 'car', 'pet', 'any']).describe('Type of object to track'),
    duration_seconds: z.number().min(1).max(60).optional().describe('How long to track (default: continuous)'),
  }),
  execute: async ({ object_id, object_type, duration_seconds }) => {
    console.log(`[Vision] Enabling object tracking: ${object_type}`);

    // Activate tracking mode
    const cmd: any = { T: 210, type: object_type };
    if (object_id !== undefined) {
      cmd.id = object_id;
    }
    if (duration_seconds) {
      cmd.duration = duration_seconds;
    }

    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        tracking: object_type,
        message: `Camera tracking enabled for ${object_type}. Gimbal will follow detected objects.`,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to enable tracking',
      };
    }
  },
});

/**
 * Tool: Stop Computer Vision
 */
export const stopCV = tool({
  name: 'stop_cv',
  description: 'Disable computer vision processing and return camera to normal view.',
  parameters: z.object({}),
  execute: async () => {
    console.log('[Vision] Stopping CV processing');

    const result = await sendCommand({ T: 200 }); // T:200 = disable CV

    if (result.success) {
      return {
        success: true,
        message: 'Computer vision disabled. Camera in normal mode.',
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to stop CV',
      };
    }
  },
});

/**
 * Export all vision tools
 */
export const visionTools = [
  activateCVMode,
  getDetectionResults,
  trackObject,
  stopCV,
];
