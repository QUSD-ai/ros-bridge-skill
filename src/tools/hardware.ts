/**
 * Hardware Control Tools for UGV Agent
 *
 * Control lights, gimbal, and OLED display for signaling and status
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
 * Tool: Control Robot Lights
 */
export const setLights = tool({
  name: 'set_lights',
  description: `Control the robot's LED lights for signaling and visibility.
    - Base lights (IO4): Chassis/bottom LEDs
    - Head lights (IO5): Camera/top LEDs
    Use different patterns to signal state:
    - Full brightness: Actively exploring
    - Dim/off: Idle or sleeping
    - Flashing: Warning or requesting attention
    - One side only: Directional indication`,
  parameters: z.object({
    base_brightness: z.number().min(0).max(255).describe('Chassis LED brightness (0-255, 0=off)'),
    head_brightness: z.number().min(0).max(255).describe('Head/camera LED brightness (0-255, 0=off)'),
    pattern: z.enum(['solid', 'slow_blink', 'fast_blink', 'fade']).optional().describe('Light pattern mode'),
  }),
  execute: async ({ base_brightness, head_brightness, pattern = 'solid' }) => {
    console.log(`[Hardware] Setting lights: Base=${base_brightness}, Head=${head_brightness}, Pattern=${pattern}`);

    let cmd: any;

    if (pattern === 'solid') {
      // Simple solid brightness
      cmd = { T: 106, IO4: base_brightness, IO5: head_brightness };
    } else {
      // Pattern mode (requires additional commands)
      cmd = {
        T: 107, // Pattern mode
        IO4: base_brightness,
        IO5: head_brightness,
        pattern: pattern,
      };
    }

    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        base: base_brightness,
        head: head_brightness,
        pattern,
        message: `Lights set to Base=${base_brightness}, Head=${head_brightness} with ${pattern} pattern`,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to control lights',
      };
    }
  },
});

/**
 * Tool: Control Camera Gimbal
 */
export const controlGimbal = tool({
  name: 'control_gimbal',
  description: `Position the camera gimbal for optimal viewing angle.
    - Pan: -90° (left) to +90° (right)
    - Tilt: -30° (down) to +90° (up)
    Use this to:
    - Look ahead while moving (0°, 0°)
    - Check surroundings (scan left/right)
    - Look down for close obstacles (-30°)
    - Look up for tall objects (90°)`,
  parameters: z.object({
    pan_degrees: z.number().min(-90).max(90).describe('Pan angle in degrees (-90=left, 0=center, +90=right)'),
    tilt_degrees: z.number().min(-30).max(90).describe('Tilt angle in degrees (-30=down, 0=level, +90=up)'),
    speed: z.number().min(1).max(100).optional().describe('Movement speed (1=slow, 100=fast, default=50)'),
  }),
  execute: async ({ pan_degrees, tilt_degrees, speed = 50 }) => {
    console.log(`[Hardware] Moving gimbal to Pan=${pan_degrees}°, Tilt=${tilt_degrees}° at speed=${speed}`);

    const cmd = {
      T: 133, // Advanced gimbal control with speed
      X: pan_degrees,
      Y: tilt_degrees,
      SPD: speed,
      ACC: Math.floor(speed / 2), // Acceleration proportional to speed
    };

    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        pan: pan_degrees,
        tilt: tilt_degrees,
        speed,
        message: `Gimbal positioned at (${pan_degrees}°, ${tilt_degrees}°)`,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to control gimbal',
      };
    }
  },
});

/**
 * Tool: Center Gimbal
 */
export const centerGimbal = tool({
  name: 'center_gimbal',
  description: 'Reset camera gimbal to center position (0°, 0°) for forward-facing view.',
  parameters: z.object({}),
  execute: async () => {
    console.log('[Hardware] Centering gimbal');

    const cmd = { T: 141, X: 0, Y: 0 };
    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        message: 'Gimbal centered at (0°, 0°)',
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to center gimbal',
      };
    }
  },
});

/**
 * Tool: Display Status on OLED
 */
export const displayStatus = tool({
  name: 'display_status',
  description: `Update the robot's 4-line OLED display to show current status.
    Use this to communicate the robot's state, especially useful when:
    - Exploring (show "EXPLORING" and progress)
    - Waiting (show "IDLE" or "WAITING")
    - Detecting something (show "FOUND: [object]")
    - Error state (show error message)
    The display has 4 lines (0-3), each about 20 characters wide.`,
  parameters: z.object({
    line0: z.string().max(20).optional().describe('Line 0 text (typically robot name/ID)'),
    line1: z.string().max(20).optional().describe('Line 1 text (typically current status)'),
    line2: z.string().max(20).optional().describe('Line 2 text (typically mode/task)'),
    line3: z.string().max(20).optional().describe('Line 3 text (typically battery/time)'),
  }),
  execute: async ({ line0, line1, line2, line3 }) => {
    console.log('[Hardware] Updating OLED display');

    const lines = [line0, line1, line2, line3];
    const results = [];

    // Send command for each non-null line
    for (let i = 0; i < 4; i++) {
      if (lines[i] !== undefined) {
        const cmd = { T: 3, lineNum: i, Text: lines[i] };
        const result = await sendCommand(cmd);
        results.push(result);

        // Small delay between lines to avoid overwhelming the display
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const allSuccess = results.every(r => r.success);

    if (allSuccess) {
      return {
        success: true,
        lines: lines.filter(l => l !== undefined),
        message: `OLED updated with ${results.length} lines`,
      };
    } else {
      return {
        success: false,
        error: 'Some lines failed to update',
      };
    }
  },
});

/**
 * Tool: Reset OLED to Default
 */
export const resetDisplay = tool({
  name: 'reset_display',
  description: 'Reset the OLED display to show default robot information (name, version, battery, etc.)',
  parameters: z.object({}),
  execute: async () => {
    console.log('[Hardware] Resetting OLED to default');

    const cmd = { T: -3 };
    const result = await sendCommand(cmd);

    if (result.success) {
      return {
        success: true,
        message: 'OLED display reset to default',
      };
    } else {
      return {
        success: false,
        error: result.error || 'Failed to reset display',
      };
    }
  },
});

/**
 * Tool: Signal Pattern (Lights + Display)
 */
export const signalState = tool({
  name: 'signal_state',
  description: `Signal the robot's current state using both lights and display.
    Predefined states:
    - exploring: Bright lights, "EXPLORING" on display
    - idle: Dim lights, "IDLE" on display
    - found_object: Flashing lights, object name on display
    - warning: Fast blinking red, warning message
    - charging: Pulsing lights, battery status
    Use this for quick status signaling without manual light/display control.`,
  parameters: z.object({
    state: z.enum(['exploring', 'idle', 'found_object', 'warning', 'charging', 'custom'])
      .describe('Predefined state to signal'),
    message: z.string().max(20).optional().describe('Custom message for "custom" state or object name for "found_object"'),
  }),
  execute: async ({ state, message }) => {
    console.log(`[Hardware] Signaling state: ${state}`);

    let lightsCmd: any;
    let displayCmd: any;

    switch (state) {
      case 'exploring':
        lightsCmd = { T: 106, IO4: 200, IO5: 255 };
        displayCmd = { T: 3, lineNum: 1, Text: 'EXPLORING...' };
        break;

      case 'idle':
        lightsCmd = { T: 106, IO4: 50, IO5: 50 };
        displayCmd = { T: 3, lineNum: 1, Text: 'IDLE' };
        break;

      case 'found_object':
        lightsCmd = { T: 107, IO4: 255, IO5: 255, pattern: 'fast_blink' };
        displayCmd = { T: 3, lineNum: 1, Text: `FOUND: ${message || 'Object'}` };
        break;

      case 'warning':
        lightsCmd = { T: 107, IO4: 255, IO5: 0, pattern: 'fast_blink' };
        displayCmd = { T: 3, lineNum: 1, Text: `WARN: ${message || 'Alert'}` };
        break;

      case 'charging':
        lightsCmd = { T: 107, IO4: 128, IO5: 128, pattern: 'fade' };
        displayCmd = { T: 3, lineNum: 1, Text: 'CHARGING...' };
        break;

      case 'custom':
        lightsCmd = { T: 106, IO4: 128, IO5: 128 };
        displayCmd = { T: 3, lineNum: 1, Text: message || 'CUSTOM' };
        break;
    }

    const lightResult = await sendCommand(lightsCmd);
    await new Promise(resolve => setTimeout(resolve, 100));
    const displayResult = await sendCommand(displayCmd);

    if (lightResult.success && displayResult.success) {
      return {
        success: true,
        state_signaled: state,
        message: `Robot state signaled: ${state}`,
      };
    } else {
      return {
        success: false,
        error: 'Failed to signal state (lights or display)',
      };
    }
  },
});

/**
 * Export all hardware control tools
 */
export const hardwareTools = [
  setLights,
  controlGimbal,
  centerGimbal,
  displayStatus,
  resetDisplay,
  signalState,
];
