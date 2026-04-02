import { useEffect, useRef } from 'preact/hooks';
import { createEventSource } from '../api.js';
import type { AgentLogEntry } from '../types.js';

interface UseEventSourceProps {
  onLog: (data: string) => void;
  onAgentLog: (issueId: string, entry: AgentLogEntry) => void;
  onIssuesUpdated: () => void;
  onStatusUpdated: () => void;
  onInputRequired: (request: { issueId: string; issueIdentifier: string; prompt: string; context?: string }) => void;
  onInputSubmitted: (data: { issueId: string }) => void;
  onWorkflowsUpdated: () => void;
  onSettingsUpdated: () => void;
  onCommentsUpdated?: (issueId: string) => void;
}

export function useEventSource(props: UseEventSourceProps) {
  const propsRef = useRef(props);
  
  useEffect(() => {
    propsRef.current = props;
  }, [props.onLog, props.onAgentLog, props.onIssuesUpdated, props.onStatusUpdated, props.onInputRequired, props.onInputSubmitted, props.onWorkflowsUpdated, props.onSettingsUpdated, props.onCommentsUpdated]);

  useEffect(() => {
    const eventSource = createEventSource(
      (data) => propsRef.current.onLog(data),
      (issueId, entry) => propsRef.current.onAgentLog(issueId, entry),
      () => propsRef.current.onIssuesUpdated(),
      () => propsRef.current.onStatusUpdated(),
      (req) => propsRef.current.onInputRequired(req),
      (data) => propsRef.current.onInputSubmitted(data),
      () => propsRef.current.onWorkflowsUpdated(),
      () => propsRef.current.onSettingsUpdated(),
      (issueId) => propsRef.current.onCommentsUpdated?.(issueId)
    );

    return () => {
      eventSource.close();
    };
  }, []);
}
