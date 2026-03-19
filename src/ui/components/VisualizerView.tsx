import type { JSX } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';

// ============================================================================
// Types & Constants
// ============================================================================

type InteractionModel = 'A' | 'B' | 'C';
type ColumnId = 'Backlog' | 'Todo' | 'In Progress' | 'Review' | 'Done';
type ViewportSize = '375x667' | '390x844' | '414x896' | '360x800';

interface MockCard {
  id: string;
  title: string;
  column: ColumnId;
  color: string;
}

interface FeedbackEntry {
  model: InteractionModel;
  tester: string;
  completionTime: number;
  misTaps: number;
  rating: number;
  notes: string;
  timestamp: string;
}

const COLUMNS: ColumnId[] = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'];

const COLUMN_COLORS: Record<ColumnId, string> = {
  'Backlog': '#9b9a97',
  'Todo': '#9b9a97',
  'In Progress': '#f7b955',
  'Review': '#9065e0',
  'Done': '#6bc950',
};

const VIEWPORTS: Record<ViewportSize, { label: string; width: number; height: number }> = {
  '375x667': { label: 'iPhone SE', width: 375, height: 667 },
  '390x844': { label: 'iPhone 14', width: 390, height: 844 },
  '414x896': { label: 'iPhone 14 Plus', width: 414, height: 896 },
  '360x800': { label: 'Android (360)', width: 360, height: 800 },
};

const INITIAL_CARDS: MockCard[] = [
  { id: 'card-1', title: 'Fix login bug', column: 'Backlog', color: '#4a9eff' },
  { id: 'card-2', title: 'Add dark mode', column: 'Backlog', color: '#6bc950' },
  { id: 'card-3', title: 'Mobile nav UX', column: 'Todo', color: '#f7b955' },
  { id: 'card-4', title: 'API rate limiting', column: 'Todo', color: '#9065e0' },
  { id: 'card-5', title: 'Kanban drag UX', column: 'In Progress', color: '#e03e3e' },
  { id: 'card-6', title: 'Export sessions', column: 'Review', color: '#4a9eff' },
  { id: 'card-7', title: 'Setup CI/CD', column: 'Done', color: '#6bc950' },
];

const MODEL_LABELS: Record<InteractionModel, string> = {
  A: 'Drag Handle D&D',
  B: 'Tap-to-Move',
  C: 'Swipe-to-Reorder',
};

const MODEL_DESCRIPTIONS: Record<InteractionModel, string> = {
  A: 'Long-press the ⠿ handle to initiate drag, then drag the card to a target column. Visual drop zones appear on drag start.',
  B: 'Tap a card to select it (highlighted), then tap a column header to move it there. Tap elsewhere to deselect.',
  C: 'Swipe a card left/right to move it one column at a time. A reorder mode button reveals vertical reordering within a column.',
};

// ============================================================================
// Model A: Drag Handle Drag-and-Drop
// ============================================================================

interface ModelAProps {
  cards: MockCard[];
  onCardsChange: (cards: MockCard[]) => void;
  onAction: (desc: string) => void;
}

function ModelA({ cards, onCardsChange, onAction }: ModelAProps): JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnId | null>(null);
  const [longPressId, setLongPressId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const startLongPress = (cardId: string, x: number, y: number) => {
    touchStartPos.current = { x, y };
    longPressTimer.current = setTimeout(() => {
      setDraggingId(cardId);
      setLongPressId(null);
      onAction(`Long-press: started dragging "${cards.find(c => c.id === cardId)?.title}"`);
    }, 500);
    setLongPressId(cardId);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setLongPressId(null);
  };

  const handleTouchStart = (e: TouchEvent, cardId: string) => {
    const touch = e.touches[0];
    startLongPress(cardId, touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!draggingId) return;
    const touch = e.touches[0];
    if (ghostRef.current) {
      ghostRef.current.style.left = `${touch.clientX - 80}px`;
      ghostRef.current.style.top = `${touch.clientY - 30}px`;
    }
    // Detect which column we're hovering
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const colEl = el?.closest('[data-column]') as HTMLElement | null;
    if (colEl?.dataset?.column) {
      setDropTarget(colEl.dataset.column as ColumnId);
    }
  };

  const handleTouchEnd = () => {
    cancelLongPress();
    if (draggingId && dropTarget) {
      const card = cards.find(c => c.id === draggingId);
      if (card && card.column !== dropTarget) {
        const updated = cards.map(c => c.id === draggingId ? { ...c, column: dropTarget } : c);
        onCardsChange(updated);
        onAction(`Dropped "${card.title}" → ${dropTarget}`);
      }
    }
    setDraggingId(null);
    setDropTarget(null);
  };

  // Desktop drag support
  const handleDragStart = (e: DragEvent, cardId: string) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', cardId);
      e.dataTransfer.effectAllowed = 'move';
    }
    setDraggingId(cardId);
    onAction(`Drag started: "${cards.find(c => c.id === cardId)?.title}"`);
  };

  const handleDragOver = (e: DragEvent, col: ColumnId) => {
    e.preventDefault();
    setDropTarget(col);
  };

  const handleDrop = (e: DragEvent, col: ColumnId) => {
    e.preventDefault();
    const cardId = e.dataTransfer?.getData('text/plain') ?? draggingId;
    if (cardId) {
      const card = cards.find(c => c.id === cardId);
      if (card && card.column !== col) {
        onCardsChange(cards.map(c => c.id === cardId ? { ...c, column: col } : c));
        onAction(`Dropped "${card.title}" → ${col}`);
      }
    }
    setDraggingId(null);
    setDropTarget(null);
  };

  const draggingCard = cards.find(c => c.id === draggingId);

  return (
    <div class="relative">
      {/* Instructions */}
      <div class="viz-hint">
        <strong>Model A:</strong> Desktop: drag the ⠿ handle. Mobile: long-press (0.5s) then drag to target column.
      </div>

      {/* Ghost for mobile drag (absolute positioned in parent) */}
      {draggingId && (
        <div
          ref={ghostRef}
          class="viz-drag-ghost"
          style={{ left: '50%', top: '40px' }}
        >
          {draggingCard?.title ?? ''}
        </div>
      )}

      <div class="viz-columns">
        {COLUMNS.map(col => {
          const colCards = cards.filter(c => c.column === col);
          const isDropTarget = dropTarget === col && draggingId != null;
          return (
            <div
              key={col}
              data-column={col}
              class={`viz-column ${isDropTarget ? 'viz-column--drop-target' : ''}`}
              onDragOver={(e) => handleDragOver(e as unknown as DragEvent, col)}
              onDrop={(e) => handleDrop(e as unknown as DragEvent, col)}
            >
              <div class="viz-column-header">
                <span class="viz-column-dot" style={{ background: COLUMN_COLORS[col] }} />
                <span class="viz-column-title">{col}</span>
                <span class="viz-column-count">{colCards.length}</span>
              </div>
              <div class="viz-cards">
                {colCards.map(card => (
                  <div
                    key={card.id}
                    class={`viz-card ${draggingId === card.id ? 'viz-card--dragging' : ''} ${longPressId === card.id ? 'viz-card--long-pressing' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as DragEvent, card.id)}
                    onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                    onTouchStart={(e) => handleTouchStart(e as unknown as TouchEvent, card.id)}
                    onTouchMove={(e) => handleTouchMove(e as unknown as TouchEvent)}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={cancelLongPress}
                    style={{ borderLeftColor: card.color }}
                  >
                    <span class="viz-drag-handle" aria-label="Drag handle">⠿</span>
                    <span class="viz-card-title">{card.title}</span>
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div class={`viz-empty-drop ${isDropTarget ? 'viz-empty-drop--active' : ''}`}>
                    {isDropTarget ? 'Drop here' : 'No cards'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Model B: Tap-to-Move with Contextual Actions
// ============================================================================

interface ModelBProps {
  cards: MockCard[];
  onCardsChange: (cards: MockCard[]) => void;
  onAction: (desc: string) => void;
}

function ModelB({ cards, onCardsChange, onAction }: ModelBProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleCardTap = (cardId: string) => {
    if (selectedId === cardId) {
      setSelectedId(null);
      onAction(`Deselected card`);
    } else {
      setSelectedId(cardId);
      const card = cards.find(c => c.id === cardId);
      onAction(`Selected "${card?.title}" — now tap a column to move it`);
    }
  };

  const handleColumnTap = (col: ColumnId) => {
    if (!selectedId) return;
    const card = cards.find(c => c.id === selectedId);
    if (card && card.column !== col) {
      onCardsChange(cards.map(c => c.id === selectedId ? { ...c, column: col } : c));
      onAction(`Moved "${card.title}" → ${col}`);
    } else if (card) {
      onAction(`"${card.title}" is already in ${col}`);
    }
    setSelectedId(null);
  };

  const selectedCard = cards.find(c => c.id === selectedId);

  return (
    <div>
      <div class="viz-hint">
        <strong>Model B:</strong> Tap a card to select it, then tap a column header to move it there. Tap the card again or elsewhere to deselect.
      </div>

      {selectedCard && (
        <div class="viz-selection-bar">
          Moving: <strong>{selectedCard.title}</strong> — tap a column below
        </div>
      )}

      <div class="viz-columns">
        {COLUMNS.map(col => {
          const colCards = cards.filter(c => c.column === col);
          const isMovingTarget = selectedId != null;
          return (
            <div key={col} class="viz-column">
              <button
                class={`viz-column-header viz-column-header--tappable ${isMovingTarget ? 'viz-column-header--target' : ''}`}
                onClick={() => handleColumnTap(col)}
                disabled={!isMovingTarget}
              >
                <span class="viz-column-dot" style={{ background: COLUMN_COLORS[col] }} />
                <span class="viz-column-title">{col}</span>
                <span class="viz-column-count">{colCards.length}</span>
                {isMovingTarget && <span class="viz-column-move-hint">→</span>}
              </button>
              <div
                class="viz-cards"
                onClick={() => { if (!selectedId) return; /* tapping empty area deselects */ }}
              >
                {colCards.map(card => (
                  <div
                    key={card.id}
                    class={`viz-card viz-card--tappable ${selectedId === card.id ? 'viz-card--selected' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleCardTap(card.id); }}
                    style={{ borderLeftColor: card.color }}
                  >
                    <span class="viz-card-title">{card.title}</span>
                    {selectedId === card.id && <span class="viz-card-check">✓</span>}
                  </div>
                ))}
                {colCards.length === 0 && (
                  <div class="viz-empty-drop">No cards</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Model C: Swipe-to-Reorder
// ============================================================================

interface ModelCProps {
  cards: MockCard[];
  onCardsChange: (cards: MockCard[]) => void;
  onAction: (desc: string) => void;
}

function ModelC({ cards, onCardsChange, onAction }: ModelCProps): JSX.Element {
  const [reorderMode, setReorderMode] = useState(false);
  const [activeCol, setActiveCol] = useState<ColumnId>('Todo');
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartX = useRef(0);
  const swipeStartTime = useRef(0);
  const SWIPE_THRESHOLD = 60;

  const colCards = cards.filter(c => c.column === activeCol);
  const colIndex = COLUMNS.indexOf(activeCol);

  const handleTouchStart = (e: TouchEvent, cardId: string) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartTime.current = Date.now();
    setSwipingId(cardId);
    setSwipeX(0);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!swipingId) return;
    const dx = e.touches[0].clientX - swipeStartX.current;
    setSwipeX(dx);
  };

  const handleTouchEnd = (cardId: string) => {
    const dx = swipeX;
    setSwipingId(null);
    setSwipeX(0);

    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const currentIdx = COLUMNS.indexOf(card.column);
    let targetIdx = currentIdx;
    if (dx > 0 && currentIdx < COLUMNS.length - 1) targetIdx = currentIdx + 1;
    if (dx < 0 && currentIdx > 0) targetIdx = currentIdx - 1;

    if (targetIdx !== currentIdx) {
      const newCol = COLUMNS[targetIdx];
      onCardsChange(cards.map(c => c.id === cardId ? { ...c, column: newCol } : c));
      onAction(`Swiped "${card.title}" ${dx > 0 ? 'right' : 'left'} → ${newCol}`);
    }
  };

  // Desktop click swipe simulation
  const handleSwipeButton = (cardId: string, direction: 'left' | 'right') => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const currentIdx = COLUMNS.indexOf(card.column);
    const targetIdx = direction === 'right' ? currentIdx + 1 : currentIdx - 1;
    if (targetIdx < 0 || targetIdx >= COLUMNS.length) return;
    const newCol = COLUMNS[targetIdx];
    onCardsChange(cards.map(c => c.id === cardId ? { ...c, column: newCol } : c));
    onAction(`Swiped "${card.title}" ${direction} → ${newCol}`);
  };

  const moveCardUp = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const colCardIds = cards.filter(c => c.column === card.column).map(c => c.id);
    const idx = colCardIds.indexOf(cardId);
    if (idx <= 0) return;
    const updated = [...cards];
    const aIdx = updated.findIndex(c => c.id === colCardIds[idx - 1]);
    const bIdx = updated.findIndex(c => c.id === cardId);
    [updated[aIdx], updated[bIdx]] = [updated[bIdx], updated[aIdx]];
    onCardsChange(updated);
    onAction(`Reordered "${card.title}" up`);
  };

  const moveCardDown = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const colCardIds = cards.filter(c => c.column === card.column).map(c => c.id);
    const idx = colCardIds.indexOf(cardId);
    if (idx >= colCardIds.length - 1) return;
    const updated = [...cards];
    const aIdx = updated.findIndex(c => c.id === colCardIds[idx + 1]);
    const bIdx = updated.findIndex(c => c.id === cardId);
    [updated[aIdx], updated[bIdx]] = [updated[bIdx], updated[aIdx]];
    onCardsChange(updated);
    onAction(`Reordered "${card.title}" down`);
  };

  return (
    <div>
      <div class="viz-hint">
        <strong>Model C:</strong> Swipe cards left/right to move columns. Enable Reorder Mode to drag cards up/down within a column.
      </div>

      {/* Column Switcher */}
      <div class="viz-col-switcher">
        <button
          class="viz-col-nav-btn"
          disabled={colIndex === 0}
          onClick={() => setActiveCol(COLUMNS[colIndex - 1])}
        >
          ‹
        </button>
        <div class="viz-col-tabs">
          {COLUMNS.map(col => (
            <button
              key={col}
              class={`viz-col-tab ${activeCol === col ? 'viz-col-tab--active' : ''}`}
              style={activeCol === col ? { borderBottomColor: COLUMN_COLORS[col] } : {}}
              onClick={() => setActiveCol(col)}
            >
              {col}
              <span class="viz-col-tab-count">{cards.filter(c => c.column === col).length}</span>
            </button>
          ))}
        </div>
        <button
          class="viz-col-nav-btn"
          disabled={colIndex === COLUMNS.length - 1}
          onClick={() => setActiveCol(COLUMNS[colIndex + 1])}
        >
          ›
        </button>
      </div>

      {/* Reorder Mode Toggle */}
      <div class="viz-reorder-bar">
        <label class="viz-reorder-label">
          <input
            type="checkbox"
            checked={reorderMode}
            onChange={() => {
              setReorderMode(r => !r);
              onAction(reorderMode ? 'Exited reorder mode' : 'Entered reorder mode');
            }}
          />
          Reorder Mode
        </label>
        {reorderMode && (
          <span class="viz-reorder-hint">Use ↑↓ buttons to reorder cards within this column</span>
        )}
      </div>

      {/* Card List for Active Column */}
      <div class="viz-single-column">
        {colCards.length === 0 && (
          <div class="viz-empty-drop">No cards in {activeCol}</div>
        )}
        {colCards.map(card => {
          const isSwiping = swipingId === card.id;
          const translateX = isSwiping ? Math.max(-100, Math.min(100, swipeX)) : 0;
          const opacity = isSwiping ? Math.max(0.5, 1 - Math.abs(swipeX) / 200) : 1;
          const swipeRight = translateX > SWIPE_THRESHOLD;
          const swipeLeft = translateX < -SWIPE_THRESHOLD;
          return (
            <div
              key={card.id}
              class={`viz-swipe-card-wrapper ${swipeRight ? 'viz-swipe-card--will-move-right' : ''} ${swipeLeft ? 'viz-swipe-card--will-move-left' : ''}`}
            >
              {/* Swipe direction indicators */}
              {COLUMNS.indexOf(card.column) > 0 && (
                <div class={`viz-swipe-indicator viz-swipe-indicator--left ${swipeLeft ? 'viz-swipe-indicator--active' : ''}`}>
                  ← {COLUMNS[COLUMNS.indexOf(card.column) - 1]}
                </div>
              )}
              {COLUMNS.indexOf(card.column) < COLUMNS.length - 1 && (
                <div class={`viz-swipe-indicator viz-swipe-indicator--right ${swipeRight ? 'viz-swipe-indicator--active' : ''}`}>
                  {COLUMNS[COLUMNS.indexOf(card.column) + 1]} →
                </div>
              )}

              <div
                class="viz-card viz-swipe-card"
                style={{
                  borderLeftColor: card.color,
                  transform: `translateX(${translateX}px)`,
                  opacity,
                  transition: isSwiping ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
                }}
                onTouchStart={(e) => handleTouchStart(e as unknown as TouchEvent, card.id)}
                onTouchMove={(e) => handleTouchMove(e as unknown as TouchEvent)}
                onTouchEnd={() => handleTouchEnd(card.id)}
                onTouchCancel={() => { setSwipingId(null); setSwipeX(0); }}
              >
                <span class="viz-card-title">{card.title}</span>

                <div class="viz-swipe-actions">
                  {/* Desktop swipe simulation buttons */}
                  <button
                    class="viz-swipe-btn"
                    disabled={COLUMNS.indexOf(card.column) === 0}
                    onClick={() => handleSwipeButton(card.id, 'left')}
                    title="Move to previous column"
                  >←</button>
                  <button
                    class="viz-swipe-btn"
                    disabled={COLUMNS.indexOf(card.column) === COLUMNS.length - 1}
                    onClick={() => handleSwipeButton(card.id, 'right')}
                    title="Move to next column"
                  >→</button>

                  {/* Reorder buttons */}
                  {reorderMode && (
                    <>
                      <button
                        class="viz-swipe-btn viz-reorder-btn"
                        onClick={() => moveCardUp(card.id)}
                        disabled={colCards.indexOf(card) === 0}
                        title="Move up"
                      >↑</button>
                      <button
                        class="viz-swipe-btn viz-reorder-btn"
                        onClick={() => moveCardDown(card.id)}
                        disabled={colCards.indexOf(card) === colCards.length - 1}
                        title="Move down"
                      >↓</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Feedback Panel
// ============================================================================

interface FeedbackPanelProps {
  model: InteractionModel;
  onSubmit: (entry: FeedbackEntry) => void;
}

function FeedbackPanel({ model, onSubmit }: FeedbackPanelProps): JSX.Element {
  const [tester, setTester] = useState('');
  const [completionTime, setCompletionTime] = useState('');
  const [misTaps, setMisTaps] = useState('');
  const [rating, setRating] = useState(3);
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!tester.trim()) return;
    onSubmit({
      model,
      tester: tester.trim(),
      completionTime: Number(completionTime) || 0,
      misTaps: Number(misTaps) || 0,
      rating,
      notes: notes.trim(),
      timestamp: new Date().toISOString(),
    });
    setTester('');
    setCompletionTime('');
    setMisTaps('');
    setRating(3);
    setNotes('');
  };

  return (
    <form class="viz-feedback-form" onSubmit={handleSubmit}>
      <h4 class="viz-feedback-title">Log Tester Feedback — Model {model}: {MODEL_LABELS[model]}</h4>
      <div class="viz-feedback-row">
        <label class="viz-feedback-label">
          Tester name
          <input
            class="viz-feedback-input"
            type="text"
            placeholder="e.g. Alice"
            value={tester}
            onInput={(e) => setTester((e.target as HTMLInputElement).value)}
            required
          />
        </label>
        <label class="viz-feedback-label">
          Task time (s)
          <input
            class="viz-feedback-input"
            type="number"
            placeholder="e.g. 12"
            value={completionTime}
            onInput={(e) => setCompletionTime((e.target as HTMLInputElement).value)}
            min="0"
          />
        </label>
        <label class="viz-feedback-label">
          Mis-taps
          <input
            class="viz-feedback-input"
            type="number"
            placeholder="e.g. 2"
            value={misTaps}
            onInput={(e) => setMisTaps((e.target as HTMLInputElement).value)}
            min="0"
          />
        </label>
      </div>
      <div class="viz-feedback-row">
        <label class="viz-feedback-label">
          Rating (1–5)
          <div class="viz-rating">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                class={`viz-rating-star ${rating >= n ? 'viz-rating-star--active' : ''}`}
                onClick={() => setRating(n)}
                aria-label={`Rate ${n} stars`}
              >
                ★
              </button>
            ))}
          </div>
        </label>
      </div>
      <label class="viz-feedback-label">
        Notes
        <textarea
          class="viz-feedback-input viz-feedback-textarea"
          placeholder="Qualitative observations..."
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          rows={3}
        />
      </label>
      <button type="submit" class="viz-feedback-submit">Submit Feedback</button>
    </form>
  );
}

// ============================================================================
// Results Summary
// ============================================================================

function ResultsSummary({ entries }: { entries: FeedbackEntry[] }): JSX.Element {
  if (entries.length === 0) {
    return (
      <div class="viz-results-empty">
        No feedback recorded yet. Use the form above to log tester observations.
      </div>
    );
  }

  const models: InteractionModel[] = ['A', 'B', 'C'];
  const stats = models.map(model => {
    const subset = entries.filter(e => e.model === model);
    if (subset.length === 0) return { model, count: 0, avgTime: 0, avgMisTaps: 0, avgRating: 0 };
    const avgTime = subset.reduce((s, e) => s + e.completionTime, 0) / subset.length;
    const avgMisTaps = subset.reduce((s, e) => s + e.misTaps, 0) / subset.length;
    const avgRating = subset.reduce((s, e) => s + e.rating, 0) / subset.length;
    return { model, count: subset.length, avgTime, avgMisTaps, avgRating };
  });

  const bestByRating = stats.reduce((a, b) => (b.avgRating > a.avgRating ? b : a), stats[0]);
  const bestByTime = stats.filter(s => s.count > 0).reduce(
    (a, b) => (b.avgTime < a.avgTime && b.avgTime > 0 ? b : a),
    stats.filter(s => s.count > 0)[0] ?? stats[0]
  );

  return (
    <div class="viz-results">
      <h4 class="viz-results-title">Aggregate Results</h4>
      <div class="viz-results-grid">
        {stats.map(s => (
          <div key={s.model} class={`viz-stat-card ${s.model === bestByRating.model ? 'viz-stat-card--winner' : ''}`}>
            <div class="viz-stat-model">Model {s.model}</div>
            <div class="viz-stat-name">{MODEL_LABELS[s.model]}</div>
            <div class="viz-stat-row"><span>Testers:</span><strong>{s.count}</strong></div>
            <div class="viz-stat-row"><span>Avg time:</span><strong>{s.avgTime > 0 ? `${s.avgTime.toFixed(1)}s` : '—'}</strong></div>
            <div class="viz-stat-row"><span>Avg mis-taps:</span><strong>{s.count > 0 ? s.avgMisTaps.toFixed(1) : '—'}</strong></div>
            <div class="viz-stat-row"><span>Avg rating:</span><strong>{s.count > 0 ? `${s.avgRating.toFixed(1)} / 5` : '—'}</strong></div>
            {s.model === bestByRating.model && s.count > 0 && (
              <div class="viz-stat-badge">⭐ Highest Rated</div>
            )}
            {s.model === bestByTime.model && s.count > 0 && s.avgTime > 0 && (
              <div class="viz-stat-badge viz-stat-badge--time">⚡ Fastest</div>
            )}
          </div>
        ))}
      </div>

      <h4 class="viz-results-title" style={{ marginTop: '1rem' }}>Individual Entries</h4>
      <div class="viz-entries">
        {entries.map((e, i) => (
          <div key={i} class="viz-entry">
            <span class="viz-entry-model">Model {e.model}</span>
            <span class="viz-entry-tester">{e.tester}</span>
            <span class="viz-entry-time">{e.completionTime}s</span>
            <span class="viz-entry-mistaps">{e.misTaps} mis-taps</span>
            <span class="viz-entry-rating">{'★'.repeat(e.rating)}{'☆'.repeat(5 - e.rating)}</span>
            {e.notes && <span class="viz-entry-notes">{e.notes}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Visualizer View
// ============================================================================

export function VisualizerView(): JSX.Element {
  const [activeModel, setActiveModel] = useState<InteractionModel>('A');
  const [viewport, setViewport] = useState<ViewportSize>('390x844');
  const [cards, setCards] = useState<MockCard[]>(INITIAL_CARDS);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [tab, setTab] = useState<'prototype' | 'feedback' | 'results'>('prototype');
  const logRef = useRef<HTMLDivElement>(null);

  const logAction = useCallback((desc: string) => {
    setActionLog(prev => {
      const ts = new Date().toLocaleTimeString();
      return [`[${ts}] ${desc}`, ...prev].slice(0, 50);
    });
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [actionLog]);

  const handleResetCards = () => {
    setCards(INITIAL_CARDS);
    logAction('Board reset to initial state');
  };

  const handleFeedbackSubmit = (entry: FeedbackEntry) => {
    setFeedbackEntries(prev => [...prev, entry]);
    setTab('results');
    logAction(`Feedback recorded for Model ${entry.model} by ${entry.tester}`);
  };

  const vp = VIEWPORTS[viewport];

  return (
    <div class="viz-root">
      {/* Page Header */}
      <div class="viz-page-header">
        <div class="viz-page-header-inner">
          <div>
            <h2 class="viz-page-title">Mobile Kanban UX Visualizer</h2>
            <p class="viz-page-subtitle">
              Prototype and compare 3 mobile interaction models before final implementation.
            </p>
          </div>
          <button class="viz-reset-btn" onClick={handleResetCards}>
            ↺ Reset Board
          </button>
        </div>
      </div>

      <div class="viz-layout">
        {/* Left: Model Selector + Viewport Controls */}
        <aside class="viz-sidebar">
          <section class="viz-section">
            <h3 class="viz-section-title">Interaction Model</h3>
            {(['A', 'B', 'C'] as InteractionModel[]).map(m => (
              <button
                key={m}
                class={`viz-model-btn ${activeModel === m ? 'viz-model-btn--active' : ''}`}
                onClick={() => { setActiveModel(m); logAction(`Switched to Model ${m}: ${MODEL_LABELS[m]}`); }}
              >
                <span class="viz-model-label">Model {m}</span>
                <span class="viz-model-name">{MODEL_LABELS[m]}</span>
                <span class="viz-model-desc">{MODEL_DESCRIPTIONS[m]}</span>
              </button>
            ))}
          </section>

          <section class="viz-section">
            <h3 class="viz-section-title">Viewport</h3>
            <select
              class="viz-select"
              value={viewport}
              onChange={(e) => setViewport((e.target as HTMLSelectElement).value as ViewportSize)}
            >
              {Object.entries(VIEWPORTS).map(([key, v]) => (
                <option key={key} value={key}>{v.label} ({v.width}×{v.height})</option>
              ))}
            </select>
            <p class="viz-viewport-hint">{vp.width}×{vp.height}px simulated frame below</p>
          </section>

          <section class="viz-section">
            <h3 class="viz-section-title">Action Log</h3>
            <div class="viz-action-log" ref={logRef}>
              {actionLog.length === 0 && (
                <span class="viz-action-empty">Interact with the board to see actions here.</span>
              )}
              {actionLog.map((entry, i) => (
                <div key={i} class="viz-action-entry">{entry}</div>
              ))}
            </div>
          </section>
        </aside>

        {/* Center: Mobile Frame + Prototype */}
        <main class="viz-main">
          {/* Tab bar */}
          <div class="viz-tab-bar">
            {(['prototype', 'feedback', 'results'] as const).map(t => (
              <button
                key={t}
                class={`viz-tab ${tab === t ? 'viz-tab--active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'prototype' && '📱 Prototype'}
                {t === 'feedback' && '📋 Log Feedback'}
                {t === 'results' && `📊 Results (${feedbackEntries.length})`}
              </button>
            ))}
          </div>

          {tab === 'prototype' && (
            <div class="viz-frame-wrapper">
              <div
                class="viz-mobile-frame"
                style={{ width: Math.min(vp.width, 500), maxHeight: Math.min(vp.height, 700) }}
              >
                {/* Simulated mobile status bar */}
                <div class="viz-status-bar">
                  <span>9:41</span>
                  <span class="viz-status-icons">▮▮▮ ●●●●</span>
                </div>

                {/* Simulated app bar */}
                <div class="viz-app-bar">
                  <span>🎵 Symphony</span>
                  <span class="viz-model-badge">Model {activeModel}</span>
                </div>

                {/* Prototype content */}
                <div class="viz-proto-content">
                  {activeModel === 'A' && (
                    <ModelA cards={cards} onCardsChange={setCards} onAction={logAction} />
                  )}
                  {activeModel === 'B' && (
                    <ModelB cards={cards} onCardsChange={setCards} onAction={logAction} />
                  )}
                  {activeModel === 'C' && (
                    <ModelC cards={cards} onCardsChange={setCards} onAction={logAction} />
                  )}
                </div>
              </div>
              <p class="viz-frame-caption">
                Simulating {vp.label} ({vp.width}×{vp.height}) · Model {activeModel}: {MODEL_LABELS[activeModel]}
              </p>
            </div>
          )}

          {tab === 'feedback' && (
            <div class="viz-feedback-wrapper">
              <FeedbackPanel model={activeModel} onSubmit={handleFeedbackSubmit} />
            </div>
          )}

          {tab === 'results' && (
            <div class="viz-results-wrapper">
              <ResultsSummary entries={feedbackEntries} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
