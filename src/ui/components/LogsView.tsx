import { useRef, useEffect, useState } from 'preact/hooks';
import { generateListKey } from '../utils/helpers.js';

interface LogsViewProps {
  logs: string[];
}

const SENSITIVE_PATTERN = /(password|pwd|authToken|apiKey|accessToken|jwt|secret|secretKey|privateKey|encryptionKey|sessionToken)[\s:=]*[^\s]*/gi;

function sanitizeLogContent(content: string): string {
  return content.replace(SENSITIVE_PATTERN, '$1=[REDACTED]');
}

export function LogsView({ logs }: LogsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (containerRef.current && isExpanded) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const getLogClass = (line: string) => {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('error')) return 'log-error';
    if (lowerLine.includes('warn')) return 'log-warn';
    if (lowerLine.includes('info')) return 'log-info';
    if (lowerLine.includes('debug')) return 'log-debug';
    return '';
  };

  return (
    <div className="logs-container">
      <div className="logs-header" onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer' }}>
        <h2 className="logs-title">System Logs</h2>
        <button className="btn btn-secondary btn-sm">
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div
          ref={containerRef}
          className="logs expanded"
        >
          {logs.length === 0 ? (
            <div className="log-line log-debug" style={{ fontStyle: 'italic' }}>No logs available</div>
          ) : (
            logs.map((log, i) => (
              <div key={generateListKey(log, i, 'log')} className={`log-line ${getLogClass(log)}`}>
                {sanitizeLogContent(log)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
