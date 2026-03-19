import { useState, useEffect } from 'preact/hooks';
import type { InputRequest } from '../types.js';
import { api } from '../api.js';

interface InputRequestModalProps {
  request: InputRequest;
  onClose: () => void;
  onSubmitted: () => void;
}

function parseOptions(context?: string): string[] {
  if (!context) return [];
  try {
    const parsed: unknown = JSON.parse(context);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (typeof parsed === 'object' && parsed !== null && 'options' in parsed) {
      const opts = (parsed as { options: unknown }).options;
      if (Array.isArray(opts)) return opts.map(String);
    }
  } catch {
    // not JSON, ignore
  }
  return [];
}

export function InputRequestModal({ request, onClose, onSubmitted }: InputRequestModalProps) {
  const [selectedOption, setSelectedOption] = useState('');
  const [customText, setCustomText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const options = parseOptions(request.context);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    // Use custom text if provided, otherwise use selected option
    const input = customText.trim() || selectedOption;
    if (!input) return;

    setIsSubmitting(true);
    try {
      await api.submitAgentInput(request.issueId, input);
      onSubmitted();
    } catch (err) {
      console.error('Failed to submit input:', (err as Error).message);
      alert('Failed to submit input');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col">
        <div className="p-6 border-b border-gray-200 bg-yellow-50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Input Required</h2>
            <span className="text-sm text-gray-500">{request.issueIdentifier}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-6">
            <p className="text-gray-800 whitespace-pre-wrap">{request.prompt}</p>
          </div>

          <form id="input-form" onSubmit={handleSubmit} className="space-y-4">
            {options.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Select an option</label>
                {options.map((opt, i) => (
                  <label key={i} className="flex items-center gap-3 p-3 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="agent-input-option"
                      value={opt}
                      checked={selectedOption === opt}
                      onChange={() => { setSelectedOption(opt); setCustomText(''); }}
                      className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-800">{opt}</span>
                  </label>
                ))}
                <label className="flex items-center gap-3 p-3 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="agent-input-option"
                    value=""
                    checked={selectedOption === '' && customText.length > 0}
                    onChange={() => setSelectedOption('')}
                    className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500 italic">Custom response...</span>
                </label>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {options.length > 0 ? 'Or type a custom response' : 'Your response'}
              </label>
              <textarea
                value={customText}
                onInput={(e) => { setCustomText(e.currentTarget.value); setSelectedOption(''); }}
                placeholder="Type your response here..."
                className="w-full p-3 border border-gray-300 rounded-md h-24 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y text-sm"
              />
            </div>
          </form>
        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="input-form"
            disabled={isSubmitting || (!selectedOption && !customText.trim())}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
