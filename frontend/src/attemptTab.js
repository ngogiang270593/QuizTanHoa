import { useEffect, useState } from 'react';

function storedTabId() {
  const key = 'quiz_tanhoa.attemptTab';
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, value);
  }
  return value;
}

function newTabId() {
  return globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useAttemptTab() {
  const [tabId, setTabId] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let releaseLock;
    const locks = navigator.locks;
    const initialId = storedTabId();
    if (!locks?.request) {
      setTabId(initialId);
      setReady(true);
      return undefined;
    }

    async function acquire(id) {
      let acquired = false;
      await locks.request(`quiz-tanhoa-attempt-tab-${id}`, { ifAvailable: true }, async lock => {
        if (!active || !lock) return;
        acquired = true;
        setTabId(id);
        setReady(true);
        await new Promise(resolve => {
          releaseLock = resolve;
          if (!active) resolve();
        });
      });
      if (active && !acquired) {
        const freshId = newTabId();
        sessionStorage.setItem('quiz_tanhoa.attemptTab', freshId);
        await acquire(freshId);
      }
    }

    void acquire(initialId);
    return () => { active = false; releaseLock?.(); };
  }, []);

  return { tabId, ready };
}
