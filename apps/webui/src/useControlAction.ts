import { useCallback } from 'react';

export function useControlAction(ip) {
  const runCommand = useCallback(
    async ({ commandCode, value, targetIp }) => {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: String(targetIp ?? ip).trim(),
          commandCode,
          ...(typeof value === 'number' ? { value } : {})
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Send failed');
      }
      return data;
    },
    [ip]
  );

  return { runCommand };
}
