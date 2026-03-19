import { useState, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../api.js';

interface QuickAddCardProps {
  columnState: string;
  onSave: () => void;
  onCancel: () => void;
}

export function QuickAddCard({ columnState, onSave, onCancel }: QuickAddCardProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { identifier } = await api.generateIdentifier();
      await api.createIssue({
        identifier,
        title: title.trim(),
        state: columnState,
      });

      onSave();
    } catch (err) {
      console.error('Failed to create issue', err);
      alert('Failed to create issue');
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="bg-white dark:bg-[#2d2d2d] border border-blue-300 dark:border-blue-500 rounded-md p-3 shadow-md ring-2 ring-blue-100 dark:ring-blue-900/50">
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a title..."
          disabled={isSubmitting}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-[#3d3d3d] rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-500 dark:bg-[#252525] dark:text-[#e0e0e0] dark:disabled:bg-[#1f1f1f] dark:disabled:text-[#6b6b6b]"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-[#a0a0a0] bg-gray-100 dark:bg-[#3d3d3d] rounded hover:bg-gray-200 dark:hover:bg-[#4d4d4d] disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
          <span className="text-xs text-gray-400 dark:text-[#6b6b6b]">
            Enter ↵ to add · Esc to cancel
          </span>
        </div>
      </form>
    </div>
  );
}
