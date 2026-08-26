import { useState, useRef } from 'react';

export function useSearchNode(initialQuery = '') {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<any[]>([]);
  const [loadingType, setLoadingType] = useState<'initial' | 'more' | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const prevUpstreamRef = useRef('');

  const effectiveQuery = (upstreamKeyword: string) => upstreamKeyword || query.trim();

  const isLocked = (imageUrl: string | null | undefined) => !!imageUrl;

  return {
    query, setQuery,
    items, setItems,
    loadingType, setLoadingType,
    searchError, setSearchError,
    savingId, setSavingId,
    requestSeq, prevUpstreamRef,
    effectiveQuery, isLocked,
  };
}