/**
 * Autonomous Exploration Tools for UGV Agent
 *
 * Implements frontier-based exploration with occupancy grid mapping
 */

import { tool } from '@voltagent/core';
import { z } from 'zod';

/**
 * Occupancy Grid Cell States
 */
enum CellState {
  UNKNOWN = 0,    // Not yet explored
  FREE = 1,       // Open space, navigable
  OCCUPIED = 2,   // Obstacle detected
}

/**
 * Map configuration
 */
const MAP_CONFIG = {
  resolution: 0.1,  // meters per cell (10cm resolution)
  width: 200,       // cells (20m x 20m map)
  height: 200,
  origin_x: -10,    // map origin in world coordinates
  origin_y: -10,
};

/**
 * In-memory occupancy grid map
 * In production, this would be stored in a database or shared via IPFS
 */
let occupancyGrid: number[][] = Array(MAP_CONFIG.height).fill(null).map(() =>
  Array(MAP_CONFIG.width).fill(CellState.UNKNOWN)
);

let robotPosition: { x: number; y: number; theta: number } | null = null;
let exploredCellCount = 0;

/**
 * Convert world coordinates to grid indices
 */
function worldToGrid(x: number, y: number): { i: number; j: number } | null {
  const i = Math.floor((x - MAP_CONFIG.origin_x) / MAP_CONFIG.resolution);
  const j = Math.floor((y - MAP_CONFIG.origin_y) / MAP_CONFIG.resolution);

  if (i < 0 || i >= MAP_CONFIG.width || j < 0 || j >= MAP_CONFIG.height) {
    return null;
  }

  return { i, j };
}

/**
 * Convert grid indices to world coordinates (cell center)
 */
function gridToWorld(i: number, j: number): { x: number; y: number } {
  return {
    x: MAP_CONFIG.origin_x + (i + 0.5) * MAP_CONFIG.resolution,
    y: MAP_CONFIG.origin_y + (j + 0.5) * MAP_CONFIG.resolution,
  };
}

/**
 * Check if a cell is a frontier (free cell adjacent to unknown cell)
 */
function isFrontierCell(i: number, j: number): boolean {
  if (occupancyGrid[j][i] !== CellState.FREE) {
    return false;
  }

  // Check 8-connected neighbors for unknown cells
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;

      const ni = i + di;
      const nj = j + dj;

      if (ni >= 0 && ni < MAP_CONFIG.width && nj >= 0 && nj < MAP_CONFIG.height) {
        if (occupancyGrid[nj][ni] === CellState.UNKNOWN) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Find frontier regions (contiguous frontier cells)
 */
function findFrontierRegions(): Array<{ cells: Array<{i: number, j: number}>, centroid: {x: number, y: number}, size: number }> {
  const visited = Array(MAP_CONFIG.height).fill(null).map(() =>
    Array(MAP_CONFIG.width).fill(false)
  );

  const frontierRegions: Array<{ cells: Array<{i: number, j: number}>, centroid: {x: number, y: number}, size: number }> = [];

  // BFS to find connected frontier cells
  for (let j = 0; j < MAP_CONFIG.height; j++) {
    for (let i = 0; i < MAP_CONFIG.width; i++) {
      if (!visited[j][i] && isFrontierCell(i, j)) {
        const region: Array<{i: number, j: number}> = [];
        const queue: Array<{i: number, j: number}> = [{ i, j }];
        visited[j][i] = true;

        while (queue.length > 0) {
          const cell = queue.shift()!;
          region.push(cell);

          // Check 4-connected neighbors
          const neighbors = [
            { i: cell.i - 1, j: cell.j },
            { i: cell.i + 1, j: cell.j },
            { i: cell.i, j: cell.j - 1 },
            { i: cell.i, j: cell.j + 1 },
          ];

          for (const neighbor of neighbors) {
            if (
              neighbor.i >= 0 && neighbor.i < MAP_CONFIG.width &&
              neighbor.j >= 0 && neighbor.j < MAP_CONFIG.height &&
              !visited[neighbor.j][neighbor.i] &&
              isFrontierCell(neighbor.i, neighbor.j)
            ) {
              visited[neighbor.j][neighbor.i] = true;
              queue.push(neighbor);
            }
          }
        }

        // Calculate centroid in world coordinates
        if (region.length > 0) {
          const sumX = region.reduce((sum, cell) => sum + gridToWorld(cell.i, cell.j).x, 0);
          const sumY = region.reduce((sum, cell) => sum + gridToWorld(cell.i, cell.j).y, 0);

          frontierRegions.push({
            cells: region,
            centroid: {
              x: sumX / region.length,
              y: sumY / region.length,
            },
            size: region.length,
          });
        }
      }
    }
  }

  return frontierRegions;
}

/**
 * Tool: Update Map with Sensor Data
 */
export const updateMap = tool({
  name: 'update_map',
  description: `Update the occupancy grid map with current sensor readings.
    - Marks cells as FREE (navigable) or OCCUPIED (obstacle)
    - Uses robot position and LIDAR scan data
    - Builds a map of explored areas over time
    Call this regularly during exploration to maintain an accurate map.`,
  parameters: z.object({
    robot_x: z.number().describe('Robot X position in meters'),
    robot_y: z.number().describe('Robot Y position in meters'),
    robot_theta: z.number().describe('Robot orientation in radians'),
    lidar_ranges: z.array(z.number()).describe('LIDAR range readings in meters'),
    lidar_angle_min: z.number().describe('Minimum LIDAR angle in radians'),
    lidar_angle_increment: z.number().describe('Angle increment between readings in radians'),
  }),
  execute: async ({ robot_x, robot_y, robot_theta, lidar_ranges, lidar_angle_min, lidar_angle_increment }) => {
    console.log('[Exploration] Updating occupancy grid map...');

    // Update robot position
    robotPosition = { x: robot_x, y: robot_y, theta: robot_theta };

    let cellsUpdated = 0;

    // Process each LIDAR reading
    for (let i = 0; i < lidar_ranges.length; i++) {
      const range = lidar_ranges[i];

      // Skip invalid readings
      if (range <= 0 || range > 50) continue;

      const angle = lidar_angle_min + i * lidar_angle_increment;
      const worldAngle = robot_theta + angle;

      // Calculate obstacle position
      const obstacleX = robot_x + range * Math.cos(worldAngle);
      const obstacleY = robot_y + range * Math.sin(worldAngle);

      // Raytrace from robot to obstacle, marking cells as FREE
      const numSteps = Math.ceil(range / MAP_CONFIG.resolution);
      for (let step = 0; step < numSteps; step++) {
        const ratio = step / numSteps;
        const rayX = robot_x + ratio * range * Math.cos(worldAngle);
        const rayY = robot_y + ratio * range * Math.sin(worldAngle);

        const gridPos = worldToGrid(rayX, rayY);
        if (gridPos) {
          if (occupancyGrid[gridPos.j][gridPos.i] === CellState.UNKNOWN) {
            exploredCellCount++;
          }
          occupancyGrid[gridPos.j][gridPos.i] = CellState.FREE;
          cellsUpdated++;
        }
      }

      // Mark obstacle cell as OCCUPIED
      const obstacleGrid = worldToGrid(obstacleX, obstacleY);
      if (obstacleGrid) {
        if (occupancyGrid[obstacleGrid.j][obstacleGrid.i] === CellState.UNKNOWN) {
          exploredCellCount++;
        }
        occupancyGrid[obstacleGrid.j][obstacleGrid.i] = CellState.OCCUPIED;
        cellsUpdated++;
      }
    }

    const totalCells = MAP_CONFIG.width * MAP_CONFIG.height;
    const explorationProgress = (exploredCellCount / totalCells) * 100;

    return {
      success: true,
      cells_updated: cellsUpdated,
      explored_cells: exploredCellCount,
      total_cells: totalCells,
      exploration_percent: explorationProgress.toFixed(1),
      message: `Map updated. ${explorationProgress.toFixed(1)}% explored (${exploredCellCount}/${totalCells} cells)`,
    };
  },
});

/**
 * Tool: Detect Frontiers
 */
export const detectFrontiers = tool({
  name: 'detect_frontiers',
  description: `Find frontier regions - boundaries between explored and unexplored areas.
    Frontiers represent potential exploration targets.
    Returns list of frontier regions sorted by size and distance.
    Use this to decide where to explore next.`,
  parameters: z.object({
    min_frontier_size: z.number().optional().describe('Minimum cells in frontier region (default: 5)'),
    max_frontiers: z.number().optional().describe('Maximum frontiers to return (default: 5)'),
  }),
  execute: async ({ min_frontier_size = 5, max_frontiers = 5 }) => {
    console.log('[Exploration] Detecting frontier regions...');

    if (!robotPosition) {
      return {
        success: false,
        error: 'Robot position unknown. Call update_map first.',
      };
    }

    // Find all frontier regions
    let frontiers = findFrontierRegions();

    // Filter by minimum size
    frontiers = frontiers.filter(f => f.size >= min_frontier_size);

    // Calculate distance from robot to each frontier
    const frontiersWithDistance = frontiers.map(frontier => {
      const dx = frontier.centroid.x - robotPosition!.x;
      const dy = frontier.centroid.y - robotPosition!.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      return {
        ...frontier,
        distance,
      };
    });

    // Sort by size (descending) then distance (ascending)
    frontiersWithDistance.sort((a, b) => {
      if (Math.abs(a.size - b.size) > 10) {
        return b.size - a.size; // Prefer larger frontiers
      }
      return a.distance - b.distance; // Prefer closer frontiers
    });

    // Limit to max_frontiers
    const topFrontiers = frontiersWithDistance.slice(0, max_frontiers);

    return {
      success: true,
      frontiers: topFrontiers.map(f => ({
        centroid: f.centroid,
        size: f.size,
        distance: f.distance.toFixed(2),
      })),
      total_frontiers: frontiers.length,
      message: `Found ${topFrontiers.length} frontier regions (${frontiers.length} total)`,
    };
  },
});

/**
 * Tool: Get Best Exploration Target
 */
export const getBestExplorationTarget = tool({
  name: 'get_best_exploration_target',
  description: `Automatically select the best frontier to explore next.
    Uses a scoring function based on:
    - Frontier size (larger = more unexplored area)
    - Distance from robot (closer = faster to reach)
    - Information gain (expected new data)
    Returns the recommended target position to navigate to.`,
  parameters: z.object({
    prefer_large: z.boolean().optional().describe('Prefer large frontiers over close ones (default: true)'),
  }),
  execute: async ({ prefer_large = true }) => {
    console.log('[Exploration] Selecting best exploration target...');

    if (!robotPosition) {
      return {
        success: false,
        error: 'Robot position unknown. Call update_map first.',
      };
    }

    // Detect frontiers
    const frontierResult = await detectFrontiers.execute({ min_frontier_size: 5, max_frontiers: 10 });

    if (!frontierResult.success || frontierResult.frontiers.length === 0) {
      return {
        success: false,
        error: 'No frontiers found. Exploration may be complete or map needs updating.',
      };
    }

    // Score each frontier
    const scoredFrontiers = frontierResult.frontiers.map((frontier: any) => {
      const sizeScore = frontier.size / 100; // Normalize size
      const distanceScore = 1 / (1 + parseFloat(frontier.distance)); // Inverse distance

      const score = prefer_large
        ? sizeScore * 2 + distanceScore  // Prefer large frontiers
        : sizeScore + distanceScore * 2; // Prefer close frontiers

      return {
        ...frontier,
        score,
      };
    });

    // Select best frontier
    scoredFrontiers.sort((a, b) => b.score - a.score);
    const best = scoredFrontiers[0];

    return {
      success: true,
      target: best.centroid,
      frontier_size: best.size,
      distance: best.distance,
      score: best.score.toFixed(2),
      alternatives: scoredFrontiers.slice(1, 3).map((f: any) => ({
        target: f.centroid,
        distance: f.distance,
        size: f.size,
      })),
      message: `Best exploration target at (${best.centroid.x.toFixed(2)}, ${best.centroid.y.toFixed(2)}), distance ${best.distance}m`,
    };
  },
});

/**
 * Tool: Get Map Summary
 */
export const getMapSummary = tool({
  name: 'get_map_summary',
  description: `Get a summary of the current exploration map.
    Returns statistics about explored/unexplored areas, obstacles, and progress.
    Use this to assess exploration completeness.`,
  parameters: z.object({}),
  execute: async () => {
    console.log('[Exploration] Generating map summary...');

    let unknownCount = 0;
    let freeCount = 0;
    let occupiedCount = 0;

    for (let j = 0; j < MAP_CONFIG.height; j++) {
      for (let i = 0; i < MAP_CONFIG.width; i++) {
        const cell = occupancyGrid[j][i];
        if (cell === CellState.UNKNOWN) unknownCount++;
        else if (cell === CellState.FREE) freeCount++;
        else if (cell === CellState.OCCUPIED) occupiedCount++;
      }
    }

    const totalCells = MAP_CONFIG.width * MAP_CONFIG.height;
    const exploredPercent = ((freeCount + occupiedCount) / totalCells) * 100;

    return {
      success: true,
      map_size: {
        width: MAP_CONFIG.width,
        height: MAP_CONFIG.height,
        resolution: MAP_CONFIG.resolution,
        total_area_m2: (MAP_CONFIG.width * MAP_CONFIG.resolution) * (MAP_CONFIG.height * MAP_CONFIG.resolution),
      },
      cells: {
        total: totalCells,
        unknown: unknownCount,
        free: freeCount,
        occupied: occupiedCount,
      },
      exploration: {
        percent: exploredPercent.toFixed(1),
        area_explored_m2: ((freeCount + occupiedCount) * MAP_CONFIG.resolution * MAP_CONFIG.resolution).toFixed(2),
      },
      robot_position: robotPosition ? {
        x: robotPosition.x.toFixed(2),
        y: robotPosition.y.toFixed(2),
        theta_deg: (robotPosition.theta * 180 / Math.PI).toFixed(1),
      } : null,
      message: `Map: ${exploredPercent.toFixed(1)}% explored, ${freeCount} free cells, ${occupiedCount} obstacles`,
    };
  },
});

/**
 * Tool: Reset Map
 */
export const resetMap = tool({
  name: 'reset_map',
  description: 'Clear the occupancy grid map and start fresh. Use when starting a new exploration session.',
  parameters: z.object({}),
  execute: async () => {
    console.log('[Exploration] Resetting map...');

    occupancyGrid = Array(MAP_CONFIG.height).fill(null).map(() =>
      Array(MAP_CONFIG.width).fill(CellState.UNKNOWN)
    );

    robotPosition = null;
    exploredCellCount = 0;

    return {
      success: true,
      message: 'Map reset. Ready for new exploration session.',
    };
  },
});

/**
 * Export all exploration tools
 */
export const explorationTools = [
  updateMap,
  detectFrontiers,
  getBestExplorationTarget,
  getMapSummary,
  resetMap,
];

// Export map access for testing/debugging
export { occupancyGrid, robotPosition, CellState, MAP_CONFIG };
