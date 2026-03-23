import type { JSX } from 'preact';
import type { Issue, RunningAgent, InputRequest, IssueSession } from '../types.js';
import { formatDate, classNames, formatElapsedTime, buildSessionUrl } from '../utils/helpers.js';
import { getWorkflowColor } from '../utils/workflowColor.js';
import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { api } from '../api.js';

// Label color mapping for hotkeys 1-9, 0
const LABEL_COLORS: Record<string, { name: string; bg: string; text: string }> = {
  '1': { name: 'green', bg: '#2f9e44', text: '#ffffff' },
  '2': { name: 'yellow', bg: '#f59f00', text: '#ffffff' },
  '3': { name: 'orange', bg: '#e8590c', text: '#ffffff' },
  '4': { name: 'red', bg: '#c92a2a', text: '#ffffff' },
  '5': { name: 'purple', bg: '#7048e8', text: '#ffffff' },
  '6': { name: 'blue', bg: '#1971c2', text: '#ffffff' },
  '7': { name: 'sky', bg: '#0c8599', text: '#ffffff' },
  '8': { name: 'lime', bg: '#5c940d', text: '#ffffff' },
  '9': { name: 'pink', bg: '#c2255c', text: '#ffffff' },
  '0': { name: 'black', bg: '#495057', text: '#ffffff' },
};

const LABEL_KEY_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

// Swipe threshold in pixels to trigger archive
const SWIPE_THRESHOLD = 80;
// Minimum horizontal movement to be considered a swipe (vs vertical scroll)
const SWIPE_MIN_HORIZONTAL = 10;

function sortLabels(labels: string[]): string[] {
  const orderedNames = LABEL_KEY_ORDER.map((k) => LABEL_COLORS[k].name);
  return [...labels].sort((a, b) => {
    const ai = orderedNames.indexOf(a);
    const bi = orderedNames.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// Get color info for a label name
function getLabelColor(labelName: string): { bg: string; text: string } | null {
  for (const color of Object.values(LABEL_COLORS)) {
    if (color.name === labelName) {
      return { bg: color.bg, text: color.text };
    }
  }
  return null;
}

interface KanbanCardProps {
  issue: Issue;
  runningAgent?: RunningAgent;
  pendingInput?: InputRequest;
  workflowBadgeMode?: 'border';
  workflowColorOverride?: string | null;
  isSelected?: boolean;
  isDone?: boolean;
  onClick: () => void;
  onArchive: () => void;
}

declare global {
  interface Window {
    opencodePort?: string;
  }
}

function SessionLink({ session }: { session: IssueSession }) {
  const handleClick = (e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    const urlPath = session.worktreeRoot ?? session.workspacePath;
    if (window.opencodePort && session.sessionId && urlPath) {
      window.open(
        buildSessionUrl(window.opencodePort, urlPath, session.sessionId),
        '_blank'
      );
    }
  };

  const label = session.workflowName ?? session.workflowId ?? 'Session';

  return (
    <span
      class="text-gray-500 dark:text-[#a0a0a0] hover:text-blue-600 cursor-pointer truncate max-w-[80px]"
      onClick={handleClick}
      title={label}
    >
      {label}
    </span>
  );
}

export function KanbanCard({ issue, runningAgent, pendingInput, workflowBadgeMode = 'border', workflowColorOverride, isSelected = false, isDone = false, onClick, onArchive }: KanbanCardProps) {
  const [elapsed, setElapsed] = useState<string>('');
  const [isHovered, setIsHovered] = useState(false);

  // Swipe state
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeActive = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  
  const workflowColor = workflowColorOverride || getWorkflowColor(issue.workflowId);

  useEffect(() => {
    if (!isHovered) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      
      if (e.key === 'c') {
        e.preventDefault();
        onArchive();
        return;
      }
      
      const labelColor = LABEL_COLORS[e.key];
      if (labelColor) {
        e.preventDefault();
        const currentLabels = issue.labels ?? [];
        const hasLabel = currentLabels.includes(labelColor.name);
        const newLabels = hasLabel
          ? currentLabels.filter((l) => l !== labelColor.name)
          : [...currentLabels, labelColor.name];
        api.updateIssue(issue.id, { labels: newLabels }).catch(console.error);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHovered, onArchive, issue.id, issue.labels]);

  useEffect(() => {
    if (!runningAgent) {
      setElapsed('');
      return;
    }
    
    setElapsed(formatElapsedTime(runningAgent.startedAt));
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(runningAgent.startedAt));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [runningAgent]);

  const handleDragStart = (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', issue.id);
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  // Touch event handlers for swipe-to-archive (only on Done cards)
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isDone) return;
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    swipeActive.current = false;
  }, [isDone]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDone) return;
    const touch = e.touches[0];
    const deltaX = touchStartX.current - touch.clientX; // positive = swipe left
    const deltaY = Math.abs(touch.clientY - touchStartY.current);

    // Require more horizontal movement than vertical to start swipe
    if (!swipeActive.current) {
      if (deltaX > SWIPE_MIN_HORIZONTAL && deltaX > deltaY) {
        swipeActive.current = true;
        setIsSwiping(true);
      } else if (deltaY > SWIPE_MIN_HORIZONTAL) {
        // Vertical scroll — don't capture
        return;
      } else {
        return;
      }
    }

    if (swipeActive.current && deltaX > 0) {
      // Prevent page scroll while swiping horizontally
      e.preventDefault();
      setSwipeOffset(Math.min(deltaX, SWIPE_THRESHOLD * 1.5));
    }
  }, [isDone]);

  const handleTouchEnd = useCallback(async () => {
    if (!isDone || !swipeActive.current) {
      setIsSwiping(false);
      setSwipeOffset(0);
      swipeActive.current = false;
      return;
    }

    swipeActive.current = false;

    if (swipeOffset >= SWIPE_THRESHOLD) {
      // Animate out fully, then call onArchive
      setIsArchiving(true);
      setSwipeOffset(300);
      // Short delay to let animation play before removing from DOM
      setTimeout(() => {
        onArchive();
      }, 250);
    } else {
      // Snap back
      setIsSwiping(false);
      setSwipeOffset(0);
    }
  }, [isDone, swipeOffset, onArchive]);

  // Attach passive:false touch listeners via ref so we can call preventDefault on touchmove
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !isDone) return;

    card.addEventListener('touchstart', handleTouchStart, { passive: true });
    card.addEventListener('touchmove', handleTouchMove, { passive: false });
    card.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      card.removeEventListener('touchstart', handleTouchStart);
      card.removeEventListener('touchmove', handleTouchMove);
      card.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDone, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Swipe progress 0..1 relative to threshold
  const swipeProgress = Math.min(swipeOffset / SWIPE_THRESHOLD, 1);
  const isSwipeReady = swipeProgress >= 1;

  return (
    <div class="swipe-card-wrapper" style={{ overflow: isDone ? 'hidden' : undefined, borderRadius: '6px', position: 'relative' }}>
      {/* Archive reveal layer (shown behind card as it slides left) */}
      {isDone && (
        <div
          class="swipe-archive-reveal"
          style={{
            opacity: swipeProgress,
            backgroundColor: isSwipeReady ? '#c92a2a' : '#e03e3e',
          }}
        >
          <svg
            class="swipe-archive-icon"
            style={{ transform: `scale(${0.8 + swipeProgress * 0.4})` }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          <span class="swipe-archive-label">{isSwipeReady ? 'Archive' : 'Swipe to archive'}</span>
        </div>
      )}

      {/* Card content — translates left as user swipes */}
      <div
        ref={cardRef}
        draggable
        onDragStart={handleDragStart}
        onClick={isSwiping ? undefined : onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        class={classNames(
          'bg-white dark:bg-[#252525] border border-gray-200 dark:border-[#3d3d3d] rounded-md p-3 shadow-sm cursor-pointer hover:shadow-md relative',
          pendingInput && 'border-yellow-400 ring-1 ring-yellow-100 dark:border-yellow-500 dark:ring-yellow-900',
          isSelected && 'ring-2 ring-gray-400 dark:ring-gray-500 border-gray-400 dark:border-gray-500',
          isArchiving ? 'swipe-archiving' : (isSwiping ? 'swipe-active' : 'transition-shadow')
        )}
        style={{
          ...(workflowBadgeMode === 'border' && issue.workflowId ? {
            borderLeftWidth: '3px',
            borderLeftColor: workflowColor,
          } : {}),
          ...(swipeOffset > 0 ? {
            transform: `translateX(-${swipeOffset}px)`,
            transition: isArchiving ? 'transform 0.25s ease-out' : 'none',
          } : {}),
        }}
      >
        <div class="flex justify-between items-start mb-2">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-medium text-gray-500 dark:text-[#a0a0a0]">{issue.identifier}</span>
          </div>
          <span class="text-xs text-gray-400 dark:text-[#808080]">{formatDate(issue.lastModified ?? issue.created)}</span>
        </div>
        
        <h4 class="text-sm font-medium text-gray-900 dark:text-[#e0e0e0] mb-2 leading-snug">{issue.title}</h4>
        
        {issue.labels && issue.labels.length > 0 && (
          <div class="flex flex-wrap gap-1 mb-2">
            {sortLabels(issue.labels).map((label) => {
              const color = getLabelColor(label);
              return color ? (
                <span
                  key={label}
                  class="label-bar"
                  style={{ backgroundColor: color.bg }}
                  title={label}
                />
              ) : null;
            })}
          </div>
        )}
        
        {(runningAgent || pendingInput) && (
          <div class="mt-3 pt-2 border-t border-gray-100 dark:border-[#3d3d3d] flex items-center justify-between text-xs">
            {runningAgent && !pendingInput && (
              <div class="flex items-center text-blue-600">
                <span class="relative flex h-2 w-2 mr-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span>Running {elapsed}</span>
              </div>
            )}
            
            {pendingInput && (
              <div class="flex items-center text-yellow-600 font-medium">
                <span class="relative flex h-2 w-2 mr-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                </span>
                <span>Input Required</span>
              </div>
            )}

            {runningAgent?.sessionId && runningAgent?.workspacePath && (
              <div 
                class="text-blue-500 hover:text-blue-700 font-medium cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  const sessionId = runningAgent.sessionId;
                  const urlPath = runningAgent.worktreeRoot ?? runningAgent.workspacePath;
                  if (window.opencodePort && sessionId && urlPath) {
                    window.open(buildSessionUrl(window.opencodePort, urlPath, sessionId), '_blank');
                  }
                }}
              >
                Session ↗
              </div>
            )}
          </div>
        )}

        {!runningAgent && issue.sessions && issue.sessions.length > 0 && (
          <div class="mt-2 pt-2 border-t border-gray-100 dark:border-[#3d3d3d] flex items-center gap-2 text-xs flex-wrap">
            <span class="text-gray-400 dark:text-[#808080]">Sessions:</span>
            {issue.sessions.slice(0, 3).map((session) => (
              <SessionLink key={session.id} session={session} />
            ))}
            {issue.sessions.length > 3 && (
              <span class="text-gray-400 dark:text-[#808080]">+{issue.sessions.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
