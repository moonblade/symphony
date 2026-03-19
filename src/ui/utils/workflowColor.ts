/**
 * Generate a stable, visually distinct color from a workflow ID or name.
 * Uses a hash function to derive a hue, with fixed saturation and lightness
 * for consistent, visually pleasing colors.
 */

// Predefined color palette with good visual distinction and accessibility
const WORKFLOW_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#a855f7', // Purple
  '#d946ef', // Fuchsia
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green
  '#10b981', // Emerald
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#0ea5e9', // Sky
  '#3b82f6', // Blue
];

/**
 * Simple hash function for strings.
 * Returns a positive integer hash value.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a stable color for a workflow based on its ID.
 * The same workflow ID will always return the same color.
 * 
 * @param workflowId - The workflow ID (or name as fallback)
 * @returns A hex color string
 */
export function getWorkflowColor(workflowId: string | undefined | null): string {
  if (!workflowId) {
    return '#9ca3af'; // Gray for no workflow
  }
  
  const hash = hashString(workflowId);
  const colorIndex = hash % WORKFLOW_COLORS.length;
  return WORKFLOW_COLORS[colorIndex];
}

/**
 * Get a lighter version of the workflow color for backgrounds.
 * 
 * @param workflowId - The workflow ID (or name as fallback)
 * @returns A hex color string with reduced opacity (as rgba)
 */
export function getWorkflowColorLight(workflowId: string | undefined | null): string {
  const color = getWorkflowColor(workflowId);
  // Convert hex to rgba with low opacity
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.1)`;
}
